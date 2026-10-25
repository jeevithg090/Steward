"""POST /chat on a Gateway built by `build()` in replay mode (plan.md §4.1): one sentence starts
Margaret's claim, one question when the fare is missing, YES answers the ask, the HMRC text warns,
memory and the ledger answer, STOP stops, and the refusals a bad request earns."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build

TOKEN = "mission-control-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
USER = "u_margaret"
MARGARET = "my 08:12 Oxford to Paddington was 38 minutes late on 23 October 2026"
WITH_FARE = f"{MARGARET}, the ticket was £28.40"
HMRC = (
    "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim"
)
SAID = ["I prefer phone updates.", "I commute from Oxford to Paddington."]


@pytest.fixture
def gateway(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.chdir(tmp_path)  # no .env, no checkpoints in the repo
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True, tempo_api_token=TOKEN,
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"),
        payment_check_after_s=0,
    )  # fmt: skip
    with TestClient(build(settings)) as client:
        yield client


def chat(client: TestClient, text: str, **extra: Any) -> dict[str, Any]:
    r = client.post(
        "/chat",
        headers=AUTH,
        json={"user_id": USER, "display_name": "Margaret", "text": text, **extra},
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def test_one_sentence_starts_margarets_claim_and_asks_once(gateway: TestClient) -> None:
    reply = chat(gateway, WITH_FARE)

    assert reply["intent"] == "rail_delay"
    assert reply["mission"]["state"] == "awaiting_consent"
    assert reply["ask"]["amount_gbp"] == "14.20"
    assert reply["ask"]["request_id"] == reply["mission"]["ask"]["request_id"]
    assert reply["reply"] == reply["mission"]["ask"]["summary"] == reply["say"]
    assert reply["needs"] is None and reply["slots"] == {}  # the flow is done; nothing to echo
    assert reply["actions"] == [
        {"label": "Open Mission Control", "href": f"#/missions/{reply['mission']['id']}"}
    ]
    assert reply["simulated"] == gateway.get("/health").json()["simulated"]


def test_a_missing_fare_is_one_question_and_the_answer_completes_it(gateway: TestClient) -> None:
    asked = chat(gateway, MARGARET)

    assert asked["intent"] == "rail_delay" and asked["mission"] is None and asked["ask"] is None
    assert asked["needs"] == [{"field": "fare_gbp", "question": "What did the ticket cost?"}]
    assert asked["reply"] == (
        "Your 08:12 from Oxford to Paddington on 23 October. What did the ticket cost?"
    )
    assert {k: v for k, v in asked["slots"].items() if v} == {
        "origin_crs": "OXF", "destination_crs": "PAD", "travel_date": "2026-10-23",
        "departure": "08:12", "delay_minutes": "38",
    }  # fmt: skip
    assert gateway.get("/missions", headers=AUTH).json() == []  # nothing started, nothing guessed

    answered = chat(gateway, "28.40", slots=asked["slots"])

    assert answered["mission"]["state"] == "awaiting_consent"
    assert answered["ask"]["amount_gbp"] == "14.20"


def test_yes_answers_the_pending_ask_and_the_mission_leaves_awaiting_consent(
    gateway: TestClient,
) -> None:
    started = chat(gateway, WITH_FARE)

    yes = chat(gateway, "yes")
    again = chat(gateway, "yes")

    assert yes["intent"] == "approve" and yes["mission"]["id"] == started["mission"]["id"]
    assert yes["mission"]["state"] == "waiting"
    assert yes["reply"].startswith("Claim filed. I'll check the payment has arrived")
    assert again["reply"] == "Nothing is waiting for your answer."
    assert again["mission"] is None


def test_no_declines_and_a_sentence_without_a_pending_ask_is_not_an_answer(
    gateway: TestClient,
) -> None:
    chat(gateway, WITH_FARE)

    no = chat(gateway, "no, leave it")

    assert no["intent"] == "decline" and no["mission"]["state"] == "declined"
    assert no["reply"] == "Stopped: you said no. Nothing was sent."
    assert chat(gateway, "no, leave it")["reply"] == "Nothing is waiting for your answer."


def test_the_hmrc_text_returns_a_warning_verdict(gateway: TestClient) -> None:
    reply = chat(gateway, HMRC)

    assert reply["intent"] == "scam_check"
    assert reply["verdict"]["zone"] == "warn" and reply["verdict"]["level"] == "likely_scam"
    assert reply["reply"] == reply["verdict"]["say"] == reply["say"]
    assert reply["reply"].startswith("Do not touch that message.")
    assert reply["mission"] is None and reply["actions"] == [
        {"label": "Open Scam Shield", "href": "#/shield"}
    ]
    log = gateway.get("/scam/shield", params={"user_id": USER}, headers=AUTH).json()
    assert log["recent"][0]["source"] == "web" and "248.20" not in str(log)


def test_what_do_you_remember_returns_the_seeded_memories(gateway: TestClient) -> None:
    seeded = gateway.post("/demo/memory", json={"user_id": USER, "said": SAID}, headers=AUTH)
    assert seeded.status_code == 200, seeded.text

    reply = chat(gateway, "what do you remember")
    forgot = chat(gateway, "forget phone updates")
    after = chat(gateway, "what do you remember about me")

    assert reply["intent"] == "memory_recall"
    assert reply["reply"].startswith("Here's what I remember: ")
    assert {m["text"] for m in reply["memories"]} == {
        "prefers phone updates", "commutes Oxford to Paddington"
    }  # fmt: skip
    assert all(m["source"] == "you said, by voice" for m in reply["memories"])
    assert forgot["intent"] == "memory_forget"
    assert forgot["reply"] == (
        "Done. I've forgotten: prefers phone updates. It's gone from all your devices."
    )
    assert [m["text"] for m in after["memories"]] == ["commutes Oxford to Paddington"]


def test_how_much_have_you_got_back_is_the_ledger(gateway: TestClient) -> None:
    empty = chat(gateway, "how much have you got back")
    chat(gateway, WITH_FARE)
    chat(gateway, "yes")
    gateway.post("/scheduler/tick", headers=AUTH)  # the Watchdog checks at once; GWR has paid

    paid = chat(gateway, "how much have you got back")

    assert empty["intent"] == "ledger" and empty["ledger"]["gbp_recovered"] == "0.00"
    assert empty["reply"] == "Nothing yet. When a claim is paid, it shows here."
    assert paid["ledger"] == gateway.get("/ledger", headers=AUTH).json()
    assert paid["ledger"]["gbp_recovered"] == "14.20"
    assert paid["reply"] == "So far Tempo has got back £14.20 and 20 minutes of your time."


def test_stop_stops_every_mission_of_this_person(gateway: TestClient) -> None:
    first = chat(gateway, WITH_FARE)["mission"]["id"]
    second = chat(gateway, WITH_FARE)["mission"]["id"]

    stopped = chat(gateway, "STOP")

    assert stopped["intent"] == "stop"
    assert stopped["reply"] == "Stopped. Nothing more will be sent."
    states = {m["id"]: m["state"] for m in gateway.get("/missions", headers=AUTH).json()}
    assert states[first] == states[second] == "declined"
    assert chat(gateway, "yes")["reply"] == "Nothing is waiting for your answer."


def test_a_missed_visit_is_planned_from_one_sentence(gateway: TestClient) -> None:
    asked = chat(gateway, "the engineer never came")
    reply = chat(gateway, "the Broadbandly engineer never came on 19 October 2026")

    assert asked["needs"] == [{"field": "operator", "question": "Which company was it?"}]
    assert reply["intent"] == "missed_visit"
    assert reply["mission"]["skill_id"] == "clawback.ofcom-missed-appointment"
    assert reply["mission"]["state"] == "awaiting_consent" and reply["ask"] is not None
    assert reply["mission"]["plan"]["action_today"] in ("wait", "ofcom.complaint")


def test_the_other_doors_answer_in_plain_words_with_a_link(gateway: TestClient) -> None:
    owed = chat(gateway, "am I owed anything")
    profiles = chat(gateway, "which profiles do you have")
    letter = chat(gateway, "I've got a letter I don't understand")
    helped = chat(gateway, "")
    hello = chat(gateway, "hello")

    assert owed["intent"] == "entitlement"
    assert owed["actions"] == [{"label": "Answer ten questions", "href": "#/owed"}]
    assert profiles["intent"] == "profiles" and "The Commuter" in profiles["reply"]
    assert profiles["actions"] == [{"label": "Open Profiles", "href": "#/profiles"}]
    assert letter["intent"] == "letter" and letter["actions"][0]["href"] == "#/read"
    assert letter["reply"] == "Show me the letter: tap the camera button and I'll read it to you."
    assert helped["intent"] == "help" and helped["reply"].startswith("I'm Tempo.")
    assert hello["intent"] == "smalltalk"  # replay: the canned line, never a model
    assert hello["reply"].startswith("I'm Tempo. I win back money and time you're owed.")
    assert gateway.get("/health").json()["chat"] == {"llm": "replay"}


def test_refusals_unknown_profile_too_long_bad_body_and_no_bearer(gateway: TestClient) -> None:
    unknown = gateway.post(
        "/chat", headers=AUTH,
        json={"user_id": USER, "display_name": "Margaret", "text": WITH_FARE, "profile_id": "nobody"},
    )  # fmt: skip
    known = gateway.post(
        "/chat", headers=AUTH,
        json={"user_id": USER, "display_name": "Margaret", "text": WITH_FARE,
              "profile_id": "commuter"},
    )  # fmt: skip
    too_long = gateway.post("/chat", headers=AUTH, json={"user_id": USER, "text": "x" * 2001})
    extra = gateway.post("/chat", headers=AUTH, json={"user_id": USER, "text": "hi", "phone": "1"})
    no_auth = gateway.post("/chat", json={"user_id": USER, "text": "hi"})

    assert unknown.status_code == 422
    assert unknown.json() == {"detail": "no profile called 'nobody' is installed"}
    assert known.status_code == 200 and known.json()["mission"]["profile_id"] == "commuter"
    assert too_long.status_code == 422
    assert extra.status_code == 422  # extra="forbid"
    assert no_auth.status_code == 401
    assert gateway.get("/missions", headers=AUTH).json()[0]["id"] == known.json()["mission"]["id"]


def test_the_bus_hears_the_intent_and_never_the_text(gateway: TestClient) -> None:
    with gateway.websocket_connect(f"/events?token={TOKEN}") as live:
        chat(gateway, "what do you remember")
        event = live.receive_json()

    assert event == {"type": "chat_turn", "intent": "memory_recall", "user_id": USER}
