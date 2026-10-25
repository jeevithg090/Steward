"""One rule for yes on every door (docs/security.md): once a person has a passkey, only the passkey
says yes. The chat and `/approvals` already kept it; SMS `YES` and the voice tool `record_consent`
now keep it too. They answer nothing, say so in plain words and wake the device that can sign.
A no and a STOP are still taken on every door, because ending a claim binds nobody.

The passkey is a software authenticator (tests/helpers/webauthn.py), so the signed yes at the end
is a real WebAuthn assertion that py_webauthn verifies.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app, signed_yes_needed
from tempo_gateway.main import build_services
from tempo_gateway.mesh import SYNC_PAYLOAD, Mesh

from ..helpers.webauthn import SoftAuthenticator

TOKEN, VOICE, TWILIO = "mc-token", "voice-secret", "twilio-token"
ORIGIN, PUBLIC = "http://localhost:3000", "https://tempo.example.test"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SPEAK = {"X-Tempo-Voice-Secret": VOICE}
PHONE = "+15550100123"
USER = "u_margaret"
ENDPOINT = "https://push.example/phone"
MISSION = {
    "user_id": USER, "display_name": "Margaret", "phone": PHONE, "origin_crs": "OXF",
    "destination_crs": "PAD", "travel_date": "2026-10-23", "departure": "08:12",
    "fare_gbp": "28.40",
}  # fmt: skip


class FakePush:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send(self, subscription: dict[str, Any], payload: str) -> bool:
        self.sent.append((subscription["endpoint"], payload))
        return True


@pytest.fixture
def push() -> FakePush:
    return FakePush()


@pytest.fixture
def gateway(tmp_path: Path, push: FakePush) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN, web_origins=ORIGIN,
        voice_tool_secret=VOICE, twilio_auth_token=TWILIO, public_url=PUBLIC,
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=3600,
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    mesh = Mesh(rp_id="localhost", origins=[ORIGIN], path=tmp_path / "mesh.json", push=push)
    with TestClient(create_app(service, settings, bus, memory=memory, mesh=mesh)) as client:
        client.service = service  # type: ignore[attr-defined]
        yield client


def phone_with(
    client: TestClient, *, passkey: bool = True, push: bool = True
) -> tuple[dict[str, str], SoftAuthenticator]:
    """Margaret's phone: it can approve, and (by default) has Face ID and takes pushes."""
    made = client.post(
        "/mesh/devices", headers=AUTH,
        json={"user_id": USER, "name": "Margaret's iPhone",
              "capabilities": ["approve.biometric", "notifications.show"]},
    )  # fmt: skip
    assert made.status_code == 201, made.text
    me, face_id = {"X-Tempo-Device": made.json()["token"]}, SoftAuthenticator()
    if passkey:
        started = client.post("/mesh/devices/me/passkey/options", headers=me).json()
        body = {"challenge_id": started["challenge_id"], "credential": face_id.create(
            started["options"])}  # fmt: skip
        assert client.post("/mesh/devices/me/passkey", json=body, headers=me).status_code == 200
    if push:
        client.put("/mesh/devices/me/push", json={"endpoint": ENDPOINT, "keys": {}}, headers=me)
    return me, face_id


def started(client: TestClient, push: FakePush | None = None) -> tuple[str, str]:
    """Margaret's claim, waiting for her yes. With `push`, waits for the consent push to land."""
    view = client.post("/missions", json=MISSION, headers=AUTH).json()
    for _ in range(100):  # the consent push goes out in the background
        if push is None or push.sent:
            break
        time.sleep(0.01)
    return view["id"], view["ask"]["request_id"]


def sms(client: TestClient, body: str, sid: str) -> str:
    form = {"From": PHONE, "Body": body, "MessageSid": sid}
    signature = RequestValidator(TWILIO).compute_signature(f"{PUBLIC}/sms/inbound", form)
    r = client.post("/sms/inbound", data=form, headers={"X-Twilio-Signature": signature})
    assert r.status_code == 200, r.text
    return r.text


def spoken(client: TestClient, mission_id: str, approved: bool) -> dict[str, Any]:
    r = client.post(
        "/voice/tools/record_consent", headers=SPEAK,
        json={"mission_id": mission_id, "approved": approved, "conversation_id": "conv_1"},
    )  # fmt: skip
    assert r.status_code == 200, r.text
    said: dict[str, Any] = r.json()
    return said


def state(client: TestClient, mission_id: str) -> str:
    found: str = client.get(f"/missions/{mission_id}", headers=AUTH).json()["state"]
    return found


def claims(client: TestClient) -> int:
    calls: int = client.service.deps.claims.calls  # type: ignore[attr-defined]
    return calls


def test_with_a_passkey_sms_yes_answers_nothing_and_wakes_the_phone(
    gateway: TestClient, push: FakePush
) -> None:
    phone_with(gateway)
    mission_id, request_id = started(gateway, push)
    before = len(push.sent)

    reply = sms(gateway, "YES", "SM1")

    assert f"<Message>{signed_yes_needed('sms', reminded=True)}</Message>" in reply
    assert push.sent[before:] == [(ENDPOINT, SYNC_PAYLOAD)]  # "sync", nothing more
    assert state(gateway, mission_id) == "awaiting_consent"
    ask = gateway.get(f"/missions/{mission_id}", headers=AUTH).json()["ask"]
    assert ask["request_id"] == request_id  # still waiting, for the passkey
    assert claims(gateway) == 0


def test_with_a_passkey_a_spoken_yes_answers_nothing_and_the_passkey_still_can(
    gateway: TestClient, push: FakePush
) -> None:
    me, face_id = phone_with(gateway)
    mission_id, request_id = started(gateway, push)

    said = spoken(gateway, mission_id, approved=True)
    options = gateway.post(
        f"/mesh/approvals/{request_id}/options", json={"approved": True}, headers=me
    ).json()
    signed = gateway.post(
        f"/mesh/approvals/{request_id}", headers=me,
        json={"challenge_id": options["challenge_id"],
              "credential": face_id.get(options["options"])},
    )  # fmt: skip

    assert said == {
        "mission_id": mission_id, "state": "awaiting_consent",
        "say": signed_yes_needed("voice", reminded=True),
    }  # fmt: skip
    assert signed.status_code == 200, signed.text
    assert signed.json()["state"] == "waiting"  # Face ID said yes: the claim is filed
    assert claims(gateway) == 1


def test_with_no_device_to_wake_the_words_promise_no_reminder(gateway: TestClient) -> None:
    phone_with(gateway, push=False)
    mission_id, _ = started(gateway)

    reply = sms(gateway, "yes please", "SM1")
    said = spoken(gateway, mission_id, approved=True)

    assert "reminder" not in reply and "Face ID" in reply
    assert said["say"] == signed_yes_needed("voice", reminded=False)
    assert state(gateway, mission_id) == "awaiting_consent"


def test_with_a_passkey_no_is_still_taken_by_text(gateway: TestClient) -> None:
    phone_with(gateway)
    mission_id, _ = started(gateway)

    reply = sms(gateway, "NO", "SM1")

    assert "Tempo: Stopped" in reply
    assert state(gateway, mission_id) == "declined"
    assert claims(gateway) == 0


def test_with_a_passkey_no_is_still_taken_by_phone(gateway: TestClient) -> None:
    phone_with(gateway)
    mission_id, _ = started(gateway)

    said = spoken(gateway, mission_id, approved=False)

    assert said["state"] == "declined"
    assert claims(gateway) == 0


def test_with_a_passkey_a_bearer_no_is_taken_and_a_bearer_yes_is_not(gateway: TestClient) -> None:
    phone_with(gateway)
    _, request_id = started(gateway)

    yes = gateway.post(f"/approvals/{request_id}", headers=AUTH, json={"approved": True})
    no = gateway.post(f"/approvals/{request_id}", headers=AUTH, json={"approved": False})

    assert yes.status_code == 403
    assert no.status_code == 200 and no.json()["state"] == "declined"
    assert claims(gateway) == 0


def test_with_a_passkey_stop_by_text_still_stops_everything(gateway: TestClient) -> None:
    phone_with(gateway)
    mission_id, _ = started(gateway)

    reply = sms(gateway, "STOP", "SM1")

    assert "stopped" in reply
    assert state(gateway, mission_id) == "declined"


def test_a_device_without_a_passkey_changes_nothing(gateway: TestClient) -> None:
    """The rule keys on the passkey, not on having a device: until Face ID is added, a yes by
    text or by phone is still the person's answer."""
    phone_with(gateway, passkey=False)
    by_text, _ = started(gateway)

    reply = sms(gateway, "YES", "SM1")

    assert "Tempo: Claim filed." in reply
    assert state(gateway, by_text) == "waiting"
    assert claims(gateway) == 1
