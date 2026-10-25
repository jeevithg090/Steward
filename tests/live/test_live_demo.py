"""Acceptance tests for the live GPU demo (plan.md §13, docs/gpu-demo.md): every feature, for real,
through the public tunnel to the Gateway, with our own model on the RunPod GPU.

    make live-demo            # first: the GPU warm, the tunnel, the Vercel site, the Gateway
    make live-test            # these tests, the Playwright spec on the live site, then a clean Gateway

They read the run from ../.tempo-live (live.json, token, .env); without a live run they skip.
Each run uses its own test users, so Margaret's demo data is untouched (make live-test restarts
the Gateway afterwards anyway). A real model words things differently each time, so these check
structure and facts, never exact sentences; the amounts must be exact, because the rules set them.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import secrets
import time
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from tempo_gateway.chat import CANNED, small_talk_ok

ROOT = Path(__file__).resolve().parents[2]
LIVE = Path(os.environ.get("TEMPO_LIVE_DIR", ROOT.parent / ".tempo-live"))
VISION = ROOT / "fixtures" / "vision"
SLOW = 300.0  # a cold Serverless worker loads the model before it answers
LATE_TRAIN = "My 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40"
MISSED_VISIT = "The Broadbandly engineer never came on 19 October"
HMRC = (
    "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim"
)
GENUINE = "Your HSBC one-time passcode is 482913. Never share this code with anyone. Call 159."

if not (LIVE / "live.json").exists() or not (LIVE / "token").exists():
    pytest.skip(
        f"no live demo running ({LIVE}/live.json): run make live-demo", allow_module_level=True
    )

RUN: dict[str, Any] = json.loads((LIVE / "live.json").read_text())
TOKEN = (LIVE / "token").read_text().strip()
ENV = dict(line.split("=", 1) for line in (LIVE / ".env").read_text().splitlines() if "=" in line)
TUNNEL: str = RUN["tunnel"]
SITE: str = RUN["site"]
AUTH = {"Authorization": f"Bearer {TOKEN}"}
# Which AI the running Gateway uses: our own model on the GPU, or Gemini and OpenRouter.
try:
    DEPLOY: str = httpx.get(f"{TUNNEL}/health", timeout=60).json()["deploy"]
except (httpx.HTTPError, ValueError, KeyError):  # stopped, or mid-restart: skip, never fail
    pytest.skip(f"the live demo at {TUNNEL} isn't answering", allow_module_level=True)
ON_GPU = DEPLOY == "cloud-gpu"
needs_gpu = pytest.mark.skipif(not ON_GPU, reason=f"the live demo runs {DEPLOY}, not the GPU")


def user() -> str:
    return f"u_live_{secrets.token_hex(3)}"


@pytest.fixture(scope="module")
def gw() -> Iterator[httpx.Client]:
    """The Gateway through its public tunnel: the same path the Vercel site takes."""
    with httpx.Client(base_url=TUNNEL, headers=AUTH, timeout=SLOW) as client:
        yield client


@pytest.fixture(scope="module")
def runpod() -> Iterator[httpx.Client]:
    if "RUNPOD_ENDPOINT_ID" not in ENV:
        pytest.skip("no RunPod endpoint in ../.tempo-live/.env")
    endpoint = ENV["RUNPOD_ENDPOINT_ID"]
    headers = {"Authorization": f"Bearer {ENV['RUNPOD_API_KEY']}"}
    with httpx.Client(
        base_url=f"https://api.runpod.ai/v2/{endpoint}", headers=headers, timeout=SLOW
    ) as client:
        yield client


def chat(gw: httpx.Client, text: str, user_id: str, **extra: Any) -> dict[str, Any]:
    r = gw.post(
        "/chat", json={"user_id": user_id, "display_name": "Live Test", "text": text, **extra}
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def photo(name: str) -> str:
    return base64.b64encode((VISION / name).read_bytes()).decode()


# --- The infrastructure: the GPU, the tunnel, the Gateway's honesty -----------------------------


@needs_gpu
def test_the_gpu_endpoint_has_a_worker_and_serves_tempo_private(runpod: httpx.Client) -> None:
    workers = runpod.get("/health").json()["workers"]
    assert workers["ready"] + workers["idle"] + workers["running"] >= 1, workers
    assert workers["unhealthy"] == 0, workers
    models = runpod.get("/openai/v1/models").json()
    assert "tempo-private" in [m["id"] for m in models["data"]], models


@needs_gpu
def test_the_gpu_honours_a_json_schema(runpod: httpx.Client) -> None:
    """The jurors and the photo reader rely on vLLM holding the model to a schema."""
    schema = {
        "type": "object",
        "properties": {"eligible": {"type": "boolean"}, "confidence": {"type": "number"}},
        "required": ["eligible", "confidence"],
    }
    r = runpod.post("/openai/v1/chat/completions", json={
        "model": "tempo-private", "temperature": 0, "max_tokens": 60,
        # The rule in plain words, as the jurors get it (rule_in_words): to "the rule pays from 15
        # minutes" alone, Qwen2.5-VL-7B answered not eligible every time (25 Oct 2026).
        "messages": [{"role": "user", "content": "Rule: a traveller is eligible for compensation "
                      "when their train arrives 15 minutes or more late. Fact: the train arrived "
                      "38 minutes late. Is the traveller eligible? Answer as JSON."}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "v", "schema": schema}},
    })  # fmt: skip
    assert r.status_code == 200, r.text
    answer = json.loads(r.json()["choices"][0]["message"]["content"])
    assert answer["eligible"] is True and 0 <= answer["confidence"] <= 1


def test_health_through_the_tunnel_names_the_model_and_what_is_still_recorded(
    gw: httpx.Client,
) -> None:
    health = gw.get("/health").json()
    assert health["deploy"] in ("cloud-gpu", "cloud-apis")
    assert health["simulated"] == ["company", "rail data"]
    kind = "runpod-vllm" if ON_GPU else "apis"
    assert health["model"]["kind"] == kind and health["chat"]["llm"] == kind
    if "brain" in health["chat"]:  # a language model holds the conversation (plan.md §16)
        assert health["chat"]["brain"].startswith("nvidia:"), health["chat"]
        assert "nvidia" in health["third_parties"]
    assert health["model"]["answering"] is not False, (
        f"the model is not answering: {health['model']}"
    )


def test_only_the_live_site_may_call_the_gateway_from_a_browser(gw: httpx.Client) -> None:
    preflight = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    }
    ours = gw.options("/chat", headers={"Origin": SITE, **preflight})
    assert ours.headers.get("access-control-allow-origin") == SITE
    theirs = gw.options("/chat", headers={"Origin": "https://evil.example", **preflight})
    assert "access-control-allow-origin" not in theirs.headers


def test_the_bearer_is_required() -> None:
    assert httpx.get(f"{TUNNEL}/missions", timeout=30).status_code == 401


def test_live_events_reach_a_browser_through_the_tunnel(gw: httpx.Client) -> None:
    import websockets

    async def listen() -> dict[str, Any]:
        url = TUNNEL.replace("https://", "wss://") + f"/events?token={TOKEN}"
        async with websockets.connect(url, open_timeout=30) as socket:
            await asyncio.to_thread(chat, gw, "help", user())
            while True:
                event = json.loads(await asyncio.wait_for(socket.recv(), timeout=30))
                if event.get("type") == "chat_turn":
                    return event

    event = asyncio.run(listen())
    assert event["intent"] == "help"


# --- The model: small talk, the Consensus Court, reading photos ---------------------------------


def test_small_talk_is_a_sentence_from_our_model_within_the_word_rules(gw: httpx.Client) -> None:
    reply = chat(gw, "hello there, how are you today?", user())
    assert reply["intent"] == "smalltalk"
    assert reply["reply"] != CANNED["smalltalk"], "the canned line: the model did not answer"
    assert small_talk_ok(reply["reply"]) == reply["reply"]


def test_the_three_jurors_vote_on_our_gpu_and_the_rules_set_the_amount(gw: httpx.Client) -> None:
    started = time.monotonic()
    reply = chat(gw, LATE_TRAIN, user())
    seconds = time.monotonic() - started
    assert reply["ask"]["amount_gbp"] == "14.20"  # the rule pack, never the model
    court = reply["mission"]["court"]
    assert court["absent"] == [], f"a juror timed out or answered badly: {court}"
    jurors = sorted(v["juror"] for v in court["verdicts"])
    if ON_GPU:
        assert jurors == ["runpod-vllm-1", "runpod-vllm-2", "runpod-vllm-3"]
    else:  # three different hosted models (Gemini, and OpenRouter when one is seated)
        assert len(set(jurors)) == 3 and any(j.startswith("gemini") for j in jurors), jurors
    assert court["eligible"] is True and court["outcome"] in ("proceed", "proceed_flagged")
    assert all(v["verdict"]["rule_id"] for v in court["verdicts"])
    print(f"\nthree jurors ({DEPLOY}): {seconds:.1f} s; agreement {court['agreement_rate']:.0%}")


def test_yes_files_the_claim_and_the_money_arrives(gw: httpx.Client) -> None:
    before = Decimal(gw.get("/ledger").json()["gbp_recovered"])
    who = user()
    ask = chat(gw, LATE_TRAIN, who)["ask"]
    answered = gw.post(f"/approvals/{ask['request_id']}", json={"approved": True}).json()
    assert answered["state"] in ("running", "waiting", "completed", "verified"), answered
    mission_id = answered["id"]
    for _ in range(30):
        gw.post("/scheduler/tick")
        view = gw.get(f"/missions/{mission_id}").json()
        if view["state"] == "verified":
            break
        time.sleep(2)
    assert view["state"] == "verified", view
    assert view["outcome"]["amount_gbp"] == "14.20"
    after = Decimal(gw.get("/ledger").json()["gbp_recovered"])
    assert after - before >= Decimal("14.20")


def test_the_same_journey_is_never_claimed_twice(gw: httpx.Client) -> None:
    who = user()
    first = chat(gw, LATE_TRAIN, who)
    again = chat(gw, LATE_TRAIN, who)
    assert again["mission"]["id"] == first["mission"]["id"]
    assert again["reply"].startswith("I'm already on this one.")


def test_a_profile_that_may_not_claim_refuses_before_anything_starts(gw: httpx.Client) -> None:
    reply = chat(gw, LATE_TRAIN, user(), profile_id="read-it-to-me")
    assert reply["mission"] is None and reply["ask"] is None
    assert reply["reply"].startswith("Your profile, Read It To Me, doesn't let me")


def test_our_model_reads_the_engineers_card(gw: httpx.Client) -> None:
    r = gw.post("/missions/ofcom/read", json={
        "image_b64": photo("missed_visit_card.png"), "filename": "card.png",
        "user_id": user(), "display_name": "Live Test",
    })  # fmt: skip
    assert r.status_code == 200, r.text
    read = r.json()
    facts = {f["key"]: f for f in read["facts"]}
    assert all(f["source"].endswith("#vision") for f in read["facts"])
    assert "broadbandly" in str(facts["operator"]["value"]).lower(), facts
    if facts["event_date"]["value"] == "2026-10-19":
        # Read right: it starts the claim, or still asks one question if it was unsure.
        assert read.get("mission") or read["question"], read
    else:
        # Read wrong: Tempo must not trust it. It reads the date back and starts nothing.
        assert read["fact_key"] == "event_date" and read["question"], read
        assert not read.get("mission"), read


@pytest.mark.parametrize(
    ("image", "sender", "direction", "amount"),
    [
        ("thames_water_overpayment.png", "thames", "owed_to_you", "23.40"),
        ("council_tax_reminder.png", "oxford", "you_owe", "112.00"),
    ],
)
def test_our_model_reads_a_letter_and_the_code_explains_it(
    gw: httpx.Client, image: str, sender: str, direction: str, amount: str
) -> None:
    r = gw.post("/letters/read", json={"image_b64": photo(image), "filename": image,
                                        "user_id": user()})  # fmt: skip
    assert r.status_code == 200, r.text
    reading = r.json()
    assert sender in reading["sender"].lower(), reading
    assert reading["money"]["direction"] == direction, reading
    assert reading["money"]["amount_gbp"] == amount, reading
    assert reading["reading_text"], reading


# --- Everything else, on the same live Gateway ---------------------------------------------------


def test_scam_shield_speaks_on_a_trick_and_stays_quiet_on_a_real_code(gw: httpx.Client) -> None:
    trick = gw.post("/scam/check", json={"text": HMRC}).json()
    assert trick["zone"] == "warn" and trick["level"] == "likely_scam"
    real = gw.post("/scam/check", json={"text": GENUINE}).json()
    assert real["zone"] != "warn"


def test_scam_shield_warns_in_hindi(gw: httpx.Client) -> None:
    said = chat(gw, f"Is this a scam? {HMRC}", user(), language="hi")["say"]
    assert any(ord(c) > 0x900 for c in said), said  # Devanagari


def test_memory_remembers_only_what_was_said_and_forgets_on_request(gw: httpx.Client) -> None:
    who = user()
    seeded = gw.post("/demo/memory", json={"user_id": who, "said": ["I prefer phone updates."],
                                           "confirm_readbacks": True})  # fmt: skip
    assert seeded.status_code == 200, seeded.text
    recalled = chat(gw, "What do you remember about me?", who)
    assert any("phone" in m["text"].lower() for m in recalled["memories"] or []), recalled
    chat(gw, "forget that I prefer phone updates", who)
    again = chat(gw, "What do you remember about me?", who)
    assert not any("phone" in m["text"].lower() for m in again["memories"] or []), again


def test_the_entitlement_check_screens_and_never_decides(gw: httpx.Client) -> None:
    answers = {
        "age": 78, "couple": False, "weekly_income_gbp": "180.00", "savings_gbp": "2000",
        "benefits": [], "needs_care_day": True, "needs_care_night": False, "care_months": 8,
        "terminally_ill": False, "has_broadband_or_phone": True,
    }  # fmt: skip
    result = gw.post("/entitlement/screen", json=answers).json()
    benefits = {f["benefit"] for f in result["flags"]}
    assert "Pension Credit" in benefits and "Attendance Allowance" in benefits, result
    assert "not a decision" in json.dumps(result).lower()


def test_tempo_speaks_with_its_real_voice(gw: httpx.Client) -> None:
    if not gw.get("/voice/tts").json()["configured"]:
        pytest.skip("no ELEVENLABS_API_KEY in ../.tempo-live/.env")
    for voice in ("default", "low"):
        audio = gw.post("/voice/tts", json={"text": "Hello. I'm Tempo.", "voice": voice})
        assert audio.status_code == 200, audio.text
        assert audio.headers["content-type"] == "audio/mpeg" and len(audio.content) > 5_000


def test_each_caller_is_spoken_to_the_way_they_asked(gw: httpx.Client) -> None:
    dilip = gw.get("/voice/profile", params={"user_id": "u_dilip"}).json()
    assert dilip["profile"]["language"] == "hi" and dilip["adjusted"]
    joan = gw.get("/voice/profile", params={"user_id": "u_joan"}).json()
    assert joan["profile"]["voice"] == "low" and joan["profile"]["prefers_text"]


def test_profiles_and_skills_are_served_and_a_share_code_round_trips(gw: httpx.Client) -> None:
    assert len(gw.get("/profiles").json()["profiles"]) == 7
    assert len(gw.get("/skills").json()["skills"]) == 7
    code = gw.get("/profiles/commuter/share").json()["code"]
    assert gw.post("/profiles/import", json={"code": code}).json()["id"] == "commuter"
    assert gw.post("/profiles/import", json={"code": "tp1.not-a-profile"}).status_code == 422


def test_the_privacy_proof_names_every_outside_ai_company(gw: httpx.Client) -> None:
    proof = gw.get("/privacy", params={"user_id": "u_margaret"}).json()
    health = gw.get("/health").json()
    assert proof["mode"] == DEPLOY and proof["third_parties"] == health["third_parties"]
    assert ("gemini" in proof["third_parties"]) is (not ON_GPU)
    assert "elevenlabs" in proof["third_parties"]


def test_stop_stops_everything(gw: httpx.Client) -> None:
    who = user()
    started = chat(gw, MISSED_VISIT, who)
    assert started["mission"] and started["mission"]["state"] == "awaiting_consent", started
    stopped = chat(gw, "STOP", who)
    assert stopped["intent"] == "stop"
    view = gw.get(f"/missions/{started['mission']['id']}").json()
    assert view["state"] in ("declined", "failed_safe"), view
