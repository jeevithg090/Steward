"""Scam Shield through the Gateway (S7.3): REST with the registers, and SMS CHECK."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from tempo_adapters.settings import Settings
from tempo_gateway.main import build


def gateway(tmp_path: Path) -> TestClient:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token="t", twilio_auth_token="tw",
        public_url="https://tempo.example.test", checkpoint_dir=str(tmp_path / "cp"),
        mesh_file=str(tmp_path / "mesh.json"),
    )  # fmt: skip
    return TestClient(build(settings))


def test_a_clone_firm_is_flagged_and_labelled_simulated_in_replay(tmp_path: Path) -> None:
    client = gateway(tmp_path)

    r = client.post("/scam/check", headers={"Authorization": "Bearer t"}, json={
        "text": "We've spotted fraud. Move your savings to a safe account today.",
        "firm": "Barclays Wealth Desk", "phone": "020 7946 0000",
    }).json()  # fmt: skip

    assert r["level"] == "likely_scam" and r["simulated"] is True
    assert r["reasons"][0] == "the FCA warns about Barclays Wealth Desk"


def test_sms_check_answers_in_plain_words(tmp_path: Path) -> None:
    client = gateway(tmp_path)
    form = {
        "From": "+15550100777",
        "Body": "CHECK Your account is locked, send the one-time code now",
        "MessageSid": "SM9",
    }
    signature = RequestValidator("tw").compute_signature(
        "https://tempo.example.test/sms/inbound", form
    )

    reply = client.post("/sms/inbound", data=form, headers={"X-Twilio-Signature": signature}).text

    assert "Tempo: this looks like a scam (it asks for a code or password" in reply
    assert "never one from the message" in reply
