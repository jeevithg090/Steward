"""POST /chat on a Gateway built by `build()` in replay mode (plan.md §4.1): one sentence starts
Margaret's claim, one question when the fare is missing, YES answers the ask, the HMRC text warns,
memory and the ledger answer, STOP stops, and the refusals a bad request earns.

Phase 2 (plan.md §12.2): a profile that can't claim is refused before anything starts; a person
with a passkey confirms on their device, never with a typed yes; a journey with no recording
fails safe in plain words with the demo journey as a chip; and the chips that come with replies.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.chat import LATE_TRAIN, SUGGESTIONS
from tempo_gateway.main import build

from ..helpers.webauthn import SoftAuthenticator

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
DOORS = list(SUGGESTIONS["doors"])
EARLIER = "my 07:58 Oxford to Paddington was 64 minutes late on 22 October 2026, ticket £28.40"
SEEDED = {  # scripts/seed.py's Margaret: the same journey as WITH_FARE, started by the API
    "user_id": USER, "display_name": "Margaret", "origin_crs": "OXF", "destination_crs": "PAD",
    "travel_date": "2026-10-23", "departure": "08:12", "fare_gbp": "28.40",
}  # fmt: skip
REPR = ("datetime", "('", "['", "{'")


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
    assert asked["suggestions"] == ["£28.40"]  # the recorded demo journey's fare, as a chip
    assert gateway.get("/missions", headers=AUTH).json() == []  # nothing started, nothing guessed

    answered = chat(gateway, "28.40", slots=asked["slots"])

    assert answered["mission"]["state"] == "awaiting_consent"
    assert answered["ask"]["amount_gbp"] == "14.20"
    assert answered["suggestions"] is None


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
    assert paid["suggestions"] == ["What do you remember about me?", "Am I owed anything?"]


def test_stop_stops_every_mission_of_this_person(gateway: TestClient) -> None:
    first = chat(gateway, WITH_FARE)["mission"]["id"]
    second = chat(gateway, EARLIER)["mission"]["id"]  # another journey: the same one isn't new
    assert first != second

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
    assert helped["suggestions"] == hello["suggestions"] == DOORS
    assert owed["suggestions"] is None


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


# --- phase 2: profiles, passkeys, plain fail-safes, chips --------------------------------------


def test_a_profile_that_cannot_claim_is_refused_before_anything_starts(gateway: TestClient) -> None:
    reply = chat(gateway, WITH_FARE, profile_id="read-it-to-me")

    assert reply["intent"] == "rail_delay"
    assert reply["mission"] is None and reply["ask"] is None and reply["needs"] is None
    assert (
        reply["reply"]
        == reply["say"]
        == (
            "Your profile, Read It To Me, doesn't let me file a claim or accept cash, so I haven't "
            "started. Choose another profile if you want me to file a claim."
        )
    )
    assert reply["actions"] == [{"label": "Show my profiles", "href": "#/profiles"}]
    assert reply["suggestions"] == ["Show me my profiles"]
    assert reply["slots"]["fare_gbp"] == "28.40"  # the facts stay, for another profile to use
    assert gateway.get("/missions", headers=AUTH).json() == []
    assert chat(gateway, "Show me my profiles")["intent"] == "profiles"


def test_the_refusal_comes_before_any_question(gateway: TestClient) -> None:
    reply = chat(gateway, MARGARET, profile_id="read-it-to-me")  # the fare is still missing

    assert reply["needs"] is None and reply["mission"] is None
    assert reply["reply"].startswith("Your profile, Read It To Me, doesn't let me file a claim")


def test_the_commuter_cannot_start_a_broadband_claim(gateway: TestClient) -> None:
    visit = "the Broadbandly engineer never came on 19 October 2026"

    refused = chat(gateway, visit, profile_id="commuter")
    allowed = chat(gateway, visit, profile_id="take-your-time")

    assert refused["intent"] == "missed_visit" and refused["mission"] is None
    assert refused["reply"] == (
        "Your profile, The Commuter, doesn't let me phone the company, so I haven't started. "
        "Choose another profile if you want me to phone the company."
    )
    assert allowed["mission"]["profile_id"] == "take-your-time"


def test_above_the_profiles_limit_the_ask_says_so_and_yes_still_files(gateway: TestClient) -> None:
    pricey = f"{MARGARET}, the ticket was £600"  # half of it is £300, over the Commuter's £250

    asked = chat(gateway, pricey, profile_id="commuter")
    yes = chat(gateway, "yes")

    assert asked["ask"]["amount_gbp"] == "300.00"
    assert asked["reply"].endswith(
        "This is above your profile's limit of £250.00, so I'm asking you first."
    )
    assert yes["mission"]["state"] == "waiting"


def add_passkey(client: TestClient) -> None:
    """Margaret's phone, with a passkey (a software authenticator, as in test_mesh.py)."""
    r = client.post(
        "/mesh/devices", headers=AUTH,
        json={"user_id": USER, "name": "Margaret's iPhone",
              "capabilities": ["approve.biometric", "notifications.show"]},
    )  # fmt: skip
    assert r.status_code == 201, r.text
    device = {"X-Tempo-Device": r.json()["token"]}
    started = client.post("/mesh/devices/me/passkey/options", headers=device).json()
    credential = SoftAuthenticator().create(started["options"])
    done = client.post(
        "/mesh/devices/me/passkey", headers=device,
        json={"challenge_id": started["challenge_id"], "credential": credential},
    )  # fmt: skip
    assert done.status_code == 200 and done.json()["passkey"] is True, done.text


def test_with_a_passkey_a_typed_yes_answers_nothing(gateway: TestClient) -> None:
    add_passkey(gateway)
    started = chat(gateway, WITH_FARE)
    mission_id, request_id = started["mission"]["id"], started["ask"]["request_id"]

    yes = chat(gateway, "yes")
    no = chat(gateway, "no")

    for reply in (yes, no):
        assert reply["reply"] == "Please confirm with Face ID or your fingerprint on this device."
        assert reply["ask"]["request_id"] == request_id  # echoed, for the web to sign
        assert reply["mission"]["state"] == "awaiting_consent"
    after = gateway.get(f"/missions/{mission_id}", headers=AUTH).json()
    assert after["state"] == "awaiting_consent" and after["ask"]["request_id"] == request_id
    bearer = gateway.post(f"/approvals/{request_id}", headers=AUTH, json={"approved": True})
    assert bearer.status_code == 403  # the same rule /approvals already kept


def test_a_journey_with_no_recording_fails_safe_in_plain_words(gateway: TestClient) -> None:
    reply = chat(
        gateway, "my 08:12 Oxford to Paddington was late on 24 October 2026, it cost £28.40"
    )

    assert reply["intent"] == "rail_delay"
    assert reply["mission"]["state"] in ("declined", "failed_safe")
    assert (
        reply["reply"]
        == reply["say"]
        == (
            "I couldn't find the 08:12 from Oxford to Paddington on 24 October in the rail records. "
            "This demo only has trains from 22 and 23 October."
        )
    )
    assert reply["suggestions"] == [LATE_TRAIN]
    for said in (reply["reply"], reply["mission"]["message"]):
        assert not any(bit in said for bit in REPR), said  # no Python repr, ever
    assert reply["mission"]["message"] == (
        "I couldn't find that train in the rail records (no recorded journey for the 08:12 from "
        "Oxford to Paddington on 24 October 2026)."
    )

    fixed = chat(gateway, "it was on 23 October", slots=reply["slots"])  # the date, corrected
    chip = chat(gateway, LATE_TRAIN)  # the same journey again: the same mission, not a new one

    assert fixed["intent"] == "rail_delay" and fixed["mission"]["state"] == "awaiting_consent"
    assert chip["mission"]["id"] == fixed["mission"]["id"]
    assert chip["mission"]["state"] == "awaiting_consent" and chip["ask"]["amount_gbp"] == "14.20"


# --- never the same claim twice ------------------------------------------------------------------


def missions(client: TestClient) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = client.get("/missions", headers=AUTH).json()
    return found


def test_the_same_journey_after_the_seed_is_the_seeded_mission(gateway: TestClient) -> None:
    seeded = gateway.post("/missions", json=SEEDED, headers=AUTH)
    assert seeded.status_code == 201

    reply = chat(gateway, WITH_FARE)
    again = gateway.post("/missions", json={**SEEDED, "departure": "0812"}, headers=AUTH)

    assert reply["mission"]["id"] == seeded.json()["id"]
    assert reply["reply"] == reply["say"] == "I'm already on this one. It needs your OK."
    assert reply["ask"]["request_id"] == seeded.json()["ask"]["request_id"]
    assert reply["actions"] == [
        {"label": "Open Mission Control", "href": f"#/missions/{seeded.json()['id']}"}
    ]
    assert again.status_code == 200 and again.json()["id"] == seeded.json()["id"]  # idempotent
    assert [m["id"] for m in missions(gateway)] == [seeded.json()["id"]]


def test_while_the_money_is_awaited_the_same_journey_says_so(gateway: TestClient) -> None:
    started = chat(gateway, WITH_FARE)
    chat(gateway, "yes")

    reply = chat(gateway, WITH_FARE)

    assert reply["mission"]["id"] == started["mission"]["id"]
    assert reply["mission"]["state"] == "waiting" and reply["ask"] is None
    assert reply["reply"] == "I'm already on this one. I'm waiting for the money."


def test_once_paid_the_same_journey_is_already_claimed_and_paid_once(gateway: TestClient) -> None:
    started = chat(gateway, WITH_FARE)
    chat(gateway, "yes")
    gateway.post("/scheduler/tick", headers=AUTH)  # the Watchdog checks at once; GWR has paid
    paid = gateway.get(f"/missions/{started['mission']['id']}", headers=AUTH).json()
    assert paid["state"] == "verified"

    reply = chat(gateway, WITH_FARE)
    api = gateway.post("/missions", json=SEEDED, headers=AUTH)

    assert reply["mission"]["id"] == started["mission"]["id"]
    assert reply["reply"] == f"I already claimed this one. {paid['message']}"
    assert reply["suggestions"] == ["How much have you got back for me?"]
    assert api.status_code == 200 and api.json()["id"] == started["mission"]["id"]
    assert len(missions(gateway)) == 1
    assert gateway.get("/ledger", headers=AUTH).json()["gbp_recovered"] == "14.20"  # paid once


def test_after_a_decline_the_same_journey_starts_afresh(gateway: TestClient) -> None:
    first = chat(gateway, WITH_FARE)
    chat(gateway, "no")

    again = chat(gateway, WITH_FARE)

    assert again["mission"]["id"] != first["mission"]["id"]
    assert again["mission"]["state"] == "awaiting_consent" and again["ask"] is not None
    assert len(missions(gateway)) == 2


def test_the_same_missed_visit_is_the_same_mission_whatever_the_case(gateway: TestClient) -> None:
    visit = {"user_id": USER, "display_name": "Margaret", "operator": " broadbandly ",
             "event_date": "2026-10-19"}  # fmt: skip
    seeded = gateway.post("/missions/ofcom", json=visit, headers=AUTH)

    reply = chat(gateway, "the Broadbandly engineer never came on 19 October 2026")
    api = gateway.post("/missions/ofcom", json={**visit, "operator": "BROADBANDLY"}, headers=AUTH)
    other_day = chat(gateway, "the Broadbandly engineer never came on 12 October 2026")

    assert seeded.status_code == 201
    assert reply["intent"] == "missed_visit" and reply["mission"]["id"] == seeded.json()["id"]
    assert reply["reply"].startswith("I'm already on this one.")
    assert api.status_code == 200 and api.json()["id"] == seeded.json()["id"]
    assert other_day["mission"]["id"] != seeded.json()["id"]


def test_a_waiting_claim_still_carries_its_amount(gateway: TestClient) -> None:
    """After the yes the ask is gone, but the view keeps the asked amount (Mission Control's card)."""
    started = gateway.post("/missions", json=SEEDED, headers=AUTH).json()
    asked = started["ask"]["amount_gbp"]
    answered = gateway.post(
        f"/approvals/{started['ask']['request_id']}", json={"approved": True}, headers=AUTH
    ).json()
    assert answered["ask"] is None
    assert answered["amount_gbp"] == asked == "14.20"
