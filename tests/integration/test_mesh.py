"""Tempo Mesh v0 (S5.2): pairing, passkey-signed approvals, push with no content, fan-out.

A software authenticator (tests/helpers/webauthn.py: an ES256 key, as a phone's secure element
would hold) produces real WebAuthn registrations and assertions, so py_webauthn verifies genuine
signatures.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.main import build_services
from tempo_gateway.mesh import SYNC_PAYLOAD, Mesh

from ..helpers.webauthn import SoftAuthenticator, b64

TOKEN = "mc-token"
ORIGIN = "http://localhost:3000"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
USER = "u_margaret"
MISSION = {
    "user_id": USER, "display_name": "Margaret", "origin_crs": "OXF", "destination_crs": "PAD",
    "travel_date": "2026-10-23", "departure": "08:12", "fare_gbp": "28.40",
}  # fmt: skip


class FakePush:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send(self, subscription: dict[str, Any], payload: str) -> bool:
        self.sent.append((subscription["endpoint"], payload))
        return True


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def push() -> FakePush:
    return FakePush()


@pytest.fixture
def gateway(tmp_path: Path, clock: Clock, push: FakePush) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN, web_origins=ORIGIN,
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=0,
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    mesh = Mesh(
        rp_id="localhost", origins=[ORIGIN], path=tmp_path / "mesh.json", push=push, clock=clock
    )
    with TestClient(create_app(service, settings, bus, memory=memory, mesh=mesh)) as client:
        client.mesh = mesh  # type: ignore[attr-defined]
        yield client


def as_device(token: str) -> dict[str, str]:
    return {"X-Tempo-Device": token}


def first_device(client: TestClient, name: str = "Margaret's iPhone", **extra: Any) -> str:
    caps = extra.get("capabilities", ["approve.biometric", "notifications.show"])
    r = client.post(
        "/mesh/devices", json={"user_id": USER, "name": name, "capabilities": caps}, headers=AUTH
    )
    assert r.status_code == 201, r.text
    token: str = r.json()["token"]
    return token


def add_passkey(client: TestClient, token: str, authenticator: SoftAuthenticator) -> None:
    started = client.post("/mesh/devices/me/passkey/options", headers=as_device(token)).json()
    credential = authenticator.create(started["options"])
    r = client.post(
        "/mesh/devices/me/passkey",
        json={"challenge_id": started["challenge_id"], "credential": credential},
        headers=as_device(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["passkey"] is True


def waiting_request(client: TestClient) -> str:
    view = client.post("/missions", json=MISSION, headers=AUTH).json()
    request_id: str = view["ask"]["request_id"]
    return request_id


def sign(
    client: TestClient,
    token: str,
    authenticator: SoftAuthenticator,
    request_id: str,
    approved: bool = True,
    **kw: Any,
) -> tuple[str, dict[str, Any]]:
    started = client.post(
        f"/mesh/approvals/{request_id}/options",
        json={"approved": approved},
        headers=as_device(token),
    )
    assert started.status_code == 200, started.text
    body = started.json()
    return body["challenge_id"], authenticator.get(body["options"], **kw)


def test_a_passkey_is_asked_for_as_es256_only(gateway: TestClient) -> None:
    """A mandate's key is "webauthn-es256": an EdDSA passkey would sign mandates nobody can check."""
    token = first_device(gateway)
    started = gateway.post("/mesh/devices/me/passkey/options", headers=as_device(token)).json()

    assert started["options"]["pubKeyCredParams"] == [{"type": "public-key", "alg": -7}]


def test_pairing_shows_the_same_code_on_both_devices(gateway: TestClient, clock: Clock) -> None:
    phone = first_device(gateway)
    pairing = gateway.post("/mesh/pairings", headers=as_device(phone)).json()
    pairing_id, secret = pairing["link"].split("#pair=")[1].split(".")

    claimed = gateway.post(
        f"/mesh/pairings/{pairing_id}/claim", json={"secret": secret, "name": "Laptop"}
    ).json()
    laptop = claimed["token"]
    before = gateway.get("/mesh/devices", headers=as_device(laptop))
    status = gateway.get(f"/mesh/pairings/{pairing_id}", headers=as_device(phone)).json()
    confirmed = gateway.post(f"/mesh/pairings/{pairing_id}/confirm", headers=as_device(phone))

    assert pairing["qr_svg"].startswith("<svg")
    assert status == {"claimed": True, "code": claimed["code"], "device_name": "Laptop"}
    assert len(claimed["code"]) == 6 and claimed["code"].isdigit()
    assert before.status_code == 403  # not until the codes are confirmed to match
    assert confirmed.status_code == 200
    assert {d["name"] for d in gateway.get("/mesh/devices", headers=as_device(laptop)).json()} == {
        "Margaret's iPhone",
        "Laptop",
    }


def test_a_pairing_link_is_one_time_and_expires(gateway: TestClient, clock: Clock) -> None:
    phone = first_device(gateway)
    link = gateway.post("/mesh/pairings", headers=as_device(phone)).json()["link"]
    pairing_id, secret = link.split("#pair=")[1].split(".")

    wrong = gateway.post(
        f"/mesh/pairings/{pairing_id}/claim", json={"secret": "guess", "name": "X"}
    )
    first = gateway.post(
        f"/mesh/pairings/{pairing_id}/claim", json={"secret": secret, "name": "Laptop"}
    )
    again = gateway.post(
        f"/mesh/pairings/{pairing_id}/claim", json={"secret": secret, "name": "Thief"}
    )
    late = gateway.post("/mesh/pairings", headers=as_device(phone)).json()["link"]
    clock.now += timedelta(minutes=3)
    late_id, late_secret = late.split("#pair=")[1].split(".")
    expired = gateway.post(
        f"/mesh/pairings/{late_id}/claim", json={"secret": late_secret, "name": "Laptop"}
    )

    assert [wrong.status_code, first.status_code, again.status_code, expired.status_code] == [
        401,
        200,
        409,
        410,
    ]


def test_passkey_approval_files_the_claim(gateway: TestClient) -> None:
    phone, face_id = first_device(gateway), SoftAuthenticator()
    add_passkey(gateway, phone, face_id)
    request_id = waiting_request(gateway)

    challenge_id, credential = sign(gateway, phone, face_id, request_id)
    r = gateway.post(
        f"/mesh/approvals/{request_id}",
        json={"challenge_id": challenge_id, "credential": credential},
        headers=as_device(phone),
    )

    assert r.status_code == 200, r.text
    assert r.json()["ask"] is None
    assert r.json()["state"] in {"waiting", "verified"}


def test_unsigned_or_replayed_approval_rejected(gateway: TestClient) -> None:
    phone, face_id = first_device(gateway), SoftAuthenticator()
    add_passkey(gateway, phone, face_id)
    request_id = waiting_request(gateway)

    unsigned = gateway.post(f"/approvals/{request_id}", json={"approved": True}, headers=AUTH)
    challenge_id, forged = sign(gateway, phone, face_id, request_id, tamper=True)
    tampered = gateway.post(
        f"/mesh/approvals/{request_id}",
        json={"challenge_id": challenge_id, "credential": forged},
        headers=as_device(phone),
    )
    challenge_id, credential = sign(gateway, phone, face_id, request_id)
    good = gateway.post(
        f"/mesh/approvals/{request_id}",
        json={"challenge_id": challenge_id, "credential": credential},
        headers=as_device(phone),
    )
    replayed = gateway.post(
        f"/mesh/approvals/{request_id}",
        json={"challenge_id": challenge_id, "credential": credential},
        headers=as_device(phone),
    )

    assert unsigned.status_code == 403  # a passkey exists: a bearer token isn't enough
    assert tampered.status_code == 401
    assert good.status_code == 200
    assert replayed.status_code == 409


def test_a_signed_no_cannot_become_a_yes(gateway: TestClient) -> None:
    phone, face_id = first_device(gateway), SoftAuthenticator()
    add_passkey(gateway, phone, face_id)
    request_id = waiting_request(gateway)

    challenge_id, credential = sign(gateway, phone, face_id, request_id, approved=False)
    r = gateway.post(
        f"/mesh/approvals/{request_id}",
        json={"challenge_id": challenge_id, "credential": credential},
        headers=as_device(phone),
    )

    assert r.json()["state"] == "declined"  # the answer was fixed when the challenge was made


def test_approval_on_device_a_dismisses_prompt_on_device_b(gateway: TestClient) -> None:
    phone, face_id = first_device(gateway), SoftAuthenticator()
    laptop, touch_id = first_device(gateway, "Laptop"), SoftAuthenticator()
    add_passkey(gateway, phone, face_id)
    add_passkey(gateway, laptop, touch_id)
    request_id = waiting_request(gateway)
    laptop_challenge, laptop_signed = sign(gateway, laptop, touch_id, request_id)

    with (
        gateway.websocket_connect(f"/events?token={TOKEN}") as screen_a,
        gateway.websocket_connect(f"/events?token={TOKEN}") as screen_b,
    ):
        challenge_id, credential = sign(gateway, phone, face_id, request_id)
        started = time.perf_counter()
        gateway.post(
            f"/mesh/approvals/{request_id}",
            json={"challenge_id": challenge_id, "credential": credential},
            headers=as_device(phone),
        )
        seen_b = _next_state_change(screen_b)
        elapsed = time.perf_counter() - started
        seen_a = _next_state_change(screen_a)

    late = gateway.post(
        f"/mesh/approvals/{request_id}",
        json={"challenge_id": laptop_challenge, "credential": laptop_signed},
        headers=as_device(laptop),
    )
    (mission,) = gateway.get("/missions", headers=AUTH).json()
    assert seen_a["from"] == seen_b["from"] == "awaiting_consent"
    assert mission["ask"] is None  # the prompt is gone on every screen
    assert late.status_code == 409 and "another device" in late.json()["detail"]
    assert elapsed < 0.5, f"cross-device approval took {elapsed * 1000:.0f} ms"


def _next_state_change(socket: Any) -> dict[str, Any]:
    while True:
        event: dict[str, Any] = socket.receive_json()
        if event["type"] == "state_changed":
            return event


def test_push_payload_contains_no_mission_details(gateway: TestClient, push: FakePush) -> None:
    phone = first_device(gateway)
    gateway.put(
        "/mesh/devices/me/push",
        json={"endpoint": "https://push.example/phone", "keys": {}},
        headers=as_device(phone),
    )

    waiting_request(gateway)
    for _ in range(50):  # the push goes out in the background
        if push.sent:
            break
        time.sleep(0.01)

    assert push.sent == [("https://push.example/phone", SYNC_PAYLOAD)]
    assert json.loads(SYNC_PAYLOAD) == {"type": "sync"}  # no name, amount, mission or company


def test_the_router_picks_the_most_recently_used_device_that_can_approve(
    gateway: TestClient, clock: Clock
) -> None:
    mesh: Mesh = gateway.mesh  # type: ignore[attr-defined]
    old = first_device(gateway, "Old iPad")
    phone = first_device(gateway, "iPhone")
    watch = first_device(gateway, "Kitchen display", capabilities=["notifications.show"])
    for token in (old, phone, watch):
        gateway.put(
            "/mesh/devices/me/push",
            json={"endpoint": f"https://push.example/{token[:6]}"},
            headers=as_device(token),
        )
    clock.now += timedelta(minutes=1)
    gateway.get("/mesh/devices", headers=as_device(phone))  # the phone is used now
    clock.now += timedelta(minutes=1)
    gateway.get("/mesh/devices", headers=as_device(watch))  # newest, but can't approve

    chosen = mesh.route(USER)

    assert chosen is not None and chosen.name == "iPhone"


def test_a_lost_phone_is_removed_from_another_device(gateway: TestClient) -> None:
    phone = first_device(gateway)
    laptop = first_device(gateway, "Laptop")
    phone_id = next(
        d["id"]
        for d in gateway.get("/mesh/devices", headers=as_device(laptop)).json()
        if d["name"] == "Margaret's iPhone"
    )

    assert gateway.delete(f"/mesh/devices/{phone_id}", headers=as_device(laptop)).status_code == 200
    assert gateway.get("/mesh/devices", headers=as_device(phone)).status_code == 401


def test_devices_and_passkeys_survive_a_restart(gateway: TestClient, tmp_path: Path) -> None:
    phone, face_id = first_device(gateway), SoftAuthenticator()
    add_passkey(gateway, phone, face_id)

    reloaded = Mesh(rp_id="localhost", origins=[ORIGIN], path=tmp_path / "mesh.json")
    saved = (tmp_path / "mesh.json").read_text()

    device = reloaded.device_for_token(phone)
    assert device is not None and device.credential_id == b64(face_id.credential_id)
    assert phone not in saved  # only a hash of the device token is stored


def test_a_phone_that_reads_notifications_sends_only_declared_fields(
    tmp_path: Path, push: FakePush
) -> None:
    from tempo_core.signals import load_signals

    root = Path(__file__).resolve().parents[2]
    signals = {s.id: s for s in load_signals(root / "skills" / "clawback-uk-rail" / "signals.yaml")}
    settings = Settings(_env_file=None, tempo_mode="replay", tempo_api_token=TOKEN, web_origins=ORIGIN,  # type: ignore[call-arg]
                        checkpoint_dir=str(tmp_path / "cp2"))  # fmt: skip
    service, bus, memory = build_services(settings)
    mesh = Mesh(rp_id="localhost", origins=[ORIGIN], push=push)
    client = TestClient(
        create_app(service, settings, bus, memory=memory, mesh=mesh, signals=signals)
    )
    iphone = first_device(client, "iPhone")
    client.put(
        "/mesh/devices/me/push",
        json={"endpoint": "https://push.example/iphone"},
        headers=as_device(iphone),
    )
    nothing = first_device(client, "Nothing Phone", capabilities=["notifications.read"])
    laptop = first_device(client, "Laptop", capabilities=["notifications.show"])
    seen = {
        "signal_id": "rail_delay_notification",
        "fields": {"service_time": "08:12", "delay_minutes": "34"},
    }

    accepted = client.post("/mesh/signals", json=seen, headers=as_device(nothing))
    leaky = client.post("/mesh/signals", headers=as_device(nothing),
                        json=seen | {"fields": seen["fields"] | {"text": "Your 08:12 from Oxford..."}})  # fmt: skip
    not_a_reader = client.post("/mesh/signals", json=seen, headers=as_device(laptop))
    unknown = client.post(
        "/mesh/signals", json=seen | {"signal_id": "bank_texts"}, headers=as_device(nothing)
    )

    assert accepted.json() == {
        "accepted": True,
        "routed_to": "iPhone",
    }  # the phone that can approve
    assert push.sent == [("https://push.example/iphone", SYNC_PAYLOAD)]
    assert (leaky.status_code, not_a_reader.status_code, unknown.status_code) == (422, 403, 404)
