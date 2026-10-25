"""Scam Shield through the Gateway (docs/scam-shield.md §5.3): every door, the same verdict.

REST with the registers, the lists and the sandbox; the SMS CHECK and TEACH words; the voice
agent's check_message tool; the Shield log and feedback. All in replay mode, with no keys.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from tempo_adapters.settings import Settings
from tempo_gateway.main import build

TOKEN, VOICE, TWILIO = "t", "voice-secret", "tw"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
VOICE_HEADERS = {"X-Tempo-Voice-Secret": VOICE}
PUBLIC = "https://tempo.example.test"
HMRC = (
    "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim"
)
PARCEL = "Your parcel is waiting. Track it: rb.gy/4k2q"
GREY = "Here is the link you asked for: rb.gy/4k2q"
GENUINE = "Your HSBC one-time passcode is 482913. Never share this code with anyone. Call 159."


@pytest.fixture
def gateway(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True, tempo_api_token=TOKEN,
        twilio_auth_token=TWILIO, voice_tool_secret=VOICE, public_url=PUBLIC,
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"),
    )  # fmt: skip
    with TestClient(build(settings)) as client:
        yield client


def check(client: TestClient, text: str, **extra: Any) -> dict[str, Any]:
    r = client.post("/scam/check", headers=AUTH, json={"text": text, **extra})
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def sms(client: TestClient, body: str, sid: str, sender: str = "+15550100777") -> str:
    form = {"From": sender, "Body": body, "MessageSid": sid}
    signature = RequestValidator(TWILIO).compute_signature(f"{PUBLIC}/sms/inbound", form)
    return client.post("/sms/inbound", data=form, headers={"X-Twilio-Signature": signature}).text


def test_a_clone_firm_is_flagged_and_labelled_simulated_in_replay(gateway: TestClient) -> None:
    r = check(
        gateway, "We've spotted fraud. Move your savings to a safe account today.",
        firm="Barclays Wealth Desk", phone="020 7946 0000",
    )  # fmt: skip

    assert r["level"] == "likely_scam" and r["zone"] == "warn" and r["simulated"] is True
    assert r["reasons"][0] == "the FCA warns about Barclays Wealth Desk"
    assert r["say"].startswith(
        "Do not touch that message. It is a trick trying to take your money."
    )


def test_the_look_alike_link_speaks_now_with_its_reasons(gateway: TestClient) -> None:
    r = check(gateway, HMRC)

    assert (r["level"], r["zone"], r["held"]) == ("likely_scam", "warn", False)
    assert r["links"][0]["host"] == "hmrc-refunds-gov.uk"
    assert "brand_lookalike:hmrc" in r["links"][0]["findings"]
    assert "scam_official_pretext" in r["rules"] and "scam_urgency" in r["rules"]
    assert r["confidence"] is not None and 0 <= r["confidence"] <= 1
    assert "Why:" in r["say"] and "Ring the firm on a number you already know." in r["say"]
    assert r["model"]["version"] and r["alert_id"].startswith("sa_")


def test_the_grey_zone_is_held_and_the_sandbox_settles_it(gateway: TestClient) -> None:
    r = check(gateway, GREY)

    assert r["held"] is True and r["zone"] == "warn" and r["level"] == "likely_scam"
    assert "the link quietly moves you on to evri-redelivery.co" in r["why"]
    assert "the page behind the link asks for card details" in r["why"]


def test_a_genuine_bank_code_stays_quiet_and_never_becomes_safe(gateway: TestClient) -> None:
    r = check(gateway, GENUINE)

    assert r["zone"] == "quiet" and r["level"] in ("no_flags", "caution")
    assert "safe" not in r["level"]
    assert r["say"].startswith(("No warning signs found", "Take care"))


def test_the_warning_comes_in_the_callers_language(gateway: TestClient) -> None:
    hindi = check(gateway, HMRC, language="hi")
    welsh = check(gateway, HMRC, language="cy")

    assert hindi["say"].startswith("उस मैसेज को मत छुएँ।") and "Why:" not in hindi["say"]
    parcel = check(gateway, PARCEL)
    assert (
        parcel["level"] == "likely_scam" and parcel["held"] is False
    )  # family + short link + model
    assert welsh["say"].startswith("Peidiwch â chyffwrdd")


def test_the_shield_log_counts_without_keeping_a_word_of_the_message(gateway: TestClient) -> None:
    check(gateway, HMRC, user_id="u_margaret")
    check(gateway, GREY, user_id="u_margaret")
    check(gateway, GENUINE, user_id="u_margaret")

    status = gateway.get("/scam/shield", params={"user_id": "u_margaret"}, headers=AUTH).json()

    assert status["today"] == {"checked": 3, "held": 1, "warned": 2}
    assert [a["zone"] for a in status["recent"]] == ["quiet", "warn", "warn"]
    assert status["model"]["metrics"]["auc"] > 0.98
    assert set(status["feeds"]) == {"openphish", "urlhaus"}
    kept = str(status)
    assert "482913" not in kept and "248.20" not in kept and "Claim within" not in kept
    assert "hmrc-refunds-gov.uk" in kept  # a link host may leave; the words around it never do


def test_feedback_is_recorded_against_the_alert_and_nothing_else(gateway: TestClient) -> None:
    alert = check(gateway, HMRC)["alert_id"]

    r = gateway.post("/scam/feedback", headers=AUTH, json={"alert_id": alert, "label": "real"})
    missing = gateway.post(
        "/scam/feedback", headers=AUTH, json={"alert_id": "sa_000000000000", "label": "scam"}
    )

    assert r.status_code == 200 and r.json()["label"] == "real"
    assert missing.status_code == 404


def test_sms_check_answers_in_plain_words_and_teach_keeps_the_text_only_on_request(
    gateway: TestClient,
) -> None:
    reply = sms(gateway, "CHECK Your account is locked, send the one-time code now", "SM1")
    taught = sms(gateway, "TEACH", "SM2")
    again = sms(gateway, "TEACH", "SM3")
    forgot = sms(gateway, "FORGET TEACH", "SM4")

    assert "Do not touch that message" in reply and "it asks for a code, PIN or password" in reply
    assert "Thank you" in taught and "one" in taught
    assert "nothing" in again.casefold()
    assert "forgotten" in forgot.casefold()


def test_the_voice_agent_gets_the_same_words_to_say(gateway: TestClient) -> None:
    r = gateway.post(
        "/voice/tools/check_message", headers=VOICE_HEADERS,
        json={"text": HMRC, "sender": "HMRC", "phone": "+15550100123"},
    )  # fmt: skip

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["level"] == "likely_scam" and body["zone"] == "warn"
    assert body["say"].startswith("Do not touch that message.")


def test_a_message_too_long_or_a_bad_language_is_refused(gateway: TestClient) -> None:
    too_long = gateway.post("/scam/check", headers=AUTH, json={"text": "x" * 2001})
    bad_lang = gateway.post("/scam/check", headers=AUTH, json={"text": "hi", "language": "english"})
    no_auth = gateway.post("/scam/check", json={"text": "hi"})

    assert (too_long.status_code, bad_lang.status_code, no_auth.status_code) == (422, 422, 401)
