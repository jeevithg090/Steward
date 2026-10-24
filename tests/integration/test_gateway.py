"""The Gateway end to end in replay mode: REST, voice tools, SMS, post-call webhooks, WebSocket."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from twilio.request_validator import RequestValidator

from tempo_adapters.settings import Settings
from tempo_gateway.app import VOICE_TOOLS, create_app
from tempo_gateway.main import build_service

TOKEN = "mission-control-token"
VOICE = "voice-secret"
TWILIO = "twilio-auth-token"
HOOK = "post-call-secret"
PHONE = "+15550100123"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
MISSION = {
    "user_id": "u_margaret",
    "display_name": "Margaret",
    "phone": PHONE,
    "origin_crs": "OXF",
    "destination_crs": "PAD",
    "travel_date": "2026-10-23",
    "departure": "08:12",
    "fare_gbp": "28.40",
}


@pytest.fixture
def gateway(tmp_path: Path) -> Any:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        tempo_mode="replay",
        tempo_api_token=TOKEN,
        voice_tool_secret=VOICE,
        twilio_auth_token=TWILIO,
        elevenlabs_webhook_secret=HOOK,
        public_url="https://tempo.example.test",
        checkpoint_dir=str(tmp_path / "checkpoints"),
        payment_check_after_s=0,  # the Watchdog checks straight away
    )
    service, bus = build_service(settings)
    client = TestClient(create_app(service, settings, bus))
    client.service = service  # type: ignore[attr-defined]
    return client


def sms(client: TestClient, body: str, sid: str, *, signature: str | None = None) -> Any:
    form = {"From": PHONE, "Body": body, "MessageSid": sid}
    url = "https://tempo.example.test/sms/inbound"
    signature = signature or RequestValidator(TWILIO).compute_signature(url, form)
    return client.post("/sms/inbound", data=form, headers={"X-Twilio-Signature": signature})


def claims(client: TestClient) -> int:
    calls: int = client.service.deps.claims.calls  # type: ignore[attr-defined]
    return calls


def test_web_routes_need_the_bearer_token(gateway: TestClient) -> None:
    assert gateway.post("/missions", json=MISSION).status_code == 401
    assert gateway.post("/scheduler/tick").status_code == 401
    assert (
        gateway.post(
            "/missions", json=MISSION, headers={"Authorization": "Bearer nope"}
        ).status_code
        == 401
    )
    health = gateway.get("/health").json()
    assert (health["mode"], health["simulated"]) == (
        "replay", ["company", "rail data", "jurors", "vision"],
    )  # fmt: skip
    assert gateway.get("/missions").status_code == 401
    assert gateway.get("/ledger").status_code == 401


def test_create_mission_returns_id_and_streams_events(gateway: TestClient) -> None:
    with gateway.websocket_connect(f"/events?token={TOKEN}") as live:
        created = gateway.post("/missions", json=MISSION, headers=AUTH)
        events = [live.receive_json() for _ in range(6)]

    assert created.status_code == 201
    view = created.json()
    assert view["id"].startswith("m_")
    assert view["state"] == "awaiting_consent"
    assert view["ask"]["amount_gbp"] == "14.20"
    assert [e["type"] for e in events] == [
        "mission_created",
        *["state_changed"] * 4,
        "consent_requested",
    ]
    assert [e["to"] for e in events if e["type"] == "state_changed"] == [
        "understood", "planned", "appraised", "awaiting_consent",
    ]  # fmt: skip


def test_a_web_approval_finishes_the_mission_once(gateway: TestClient) -> None:
    view = gateway.post("/missions", json=MISSION, headers=AUTH).json()
    request_id = view["ask"]["request_id"]

    filed = gateway.post(f"/approvals/{request_id}", json={"approved": True}, headers=AUTH)
    again = gateway.post(f"/approvals/{request_id}", json={"approved": True}, headers=AUTH)
    fired = gateway.post("/scheduler/tick", headers=AUTH).json()["fired"]
    done = gateway.get(f"/missions/{view['id']}", headers=AUTH).json()

    assert filed.json()["state"] == "waiting"
    assert filed.json()["message"].startswith("Claim filed. I'll check the payment has arrived")
    assert again.status_code == 404  # a second delivery changes nothing
    assert fired == [view["id"]]
    assert done["state"] == "verified"
    assert done["outcome"]["amount_gbp"] == "14.20"
    assert claims(gateway) == 1
    assert [t["to"] for t in done["timeline"]][-3:] == ["running", "completed", "verified"]


def test_an_unknown_mission_is_404(gateway: TestClient) -> None:
    assert gateway.get("/missions/m_nope", headers=AUTH).status_code == 404


def test_voice_tool_rejects_missing_secret(gateway: TestClient) -> None:
    assert gateway.post("/voice/tools/create_mission", json=MISSION).status_code == 401
    bad = gateway.post(
        "/voice/tools/create_mission", json=MISSION, headers={"X-Tempo-Voice-Secret": "x"}
    )
    assert bad.status_code == 401
    unknown = gateway.post(
        "/voice/tools/move_money", json={}, headers={"X-Tempo-Voice-Secret": VOICE}
    )
    assert unknown.status_code == 404


def test_a_mission_can_be_created_and_approved_by_voice(gateway: TestClient) -> None:
    voice = {"X-Tempo-Voice-Secret": VOICE}

    created = gateway.post("/voice/tools/create_mission", json=MISSION, headers=voice).json()
    answered = gateway.post(
        "/voice/tools/record_consent",
        json={"mission_id": created["mission_id"], "approved": True, "conversation_id": "conv_1"},
        headers=voice,
    ).json()

    assert "Shall I claim £14.20 for you?" in created["say"]
    assert answered["state"] == "waiting"
    assert answered["say"].startswith("Claim filed.")


def test_every_voice_tool_has_a_route(gateway: TestClient) -> None:
    for name in VOICE_TOOLS:
        response = gateway.post(
            f"/voice/tools/{name}",
            json={"mission_id": "m_x"},
            headers={"X-Tempo-Voice-Secret": VOICE},
        )
        assert "no voice tool" not in response.text, name
        assert response.status_code < 500, (name, response.text)


def test_twilio_signature_invalid_rejected(gateway: TestClient) -> None:
    assert sms(gateway, "YES", "SM1", signature="forged").status_code == 403


def test_sms_yes_resolves_pending_request(gateway: TestClient) -> None:
    gateway.post("/missions", json=MISSION, headers=AUTH)

    reply = sms(gateway, "yes please", "SM2")

    assert reply.headers["content-type"].startswith("application/xml")
    assert "Tempo: Claim filed." in reply.text
    assert claims(gateway) == 1


def test_sms_stop_revokes_consent_and_kills_mission(gateway: TestClient) -> None:
    view = gateway.post("/missions", json=MISSION, headers=AUTH).json()

    reply = sms(gateway, "STOP", "SM3")

    assert "stopped" in reply.text
    after = gateway.get(f"/missions/{view['id']}", headers=AUTH).json()
    assert after["state"] == "declined"
    assert claims(gateway) == 0
    events = gateway.service.deps.repo._inner.consent_events  # type: ignore[attr-defined]
    assert [e.kind.value for e in events] == ["revoke"]


def test_webhook_idempotency_duplicate_delivery_processed_once(gateway: TestClient) -> None:
    gateway.post("/missions", json=MISSION, headers=AUTH)

    first = sms(gateway, "YES", "SM4")
    retry = sms(gateway, "YES", "SM4")  # Twilio retries the same message

    assert "<Message>" in first.text
    assert "<Message>" not in retry.text
    assert claims(gateway) == 1


def test_sms_help_and_unknown_numbers_get_instructions(gateway: TestClient) -> None:
    assert "reply YES to approve" in sms(gateway, "HELP", "SM5").text


def signed_post_call(client: TestClient, payload: dict[str, Any], *, secret: str = HOOK) -> Any:
    body = json.dumps(payload).encode()
    t = str(int(time.time()))
    digest = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return client.post(
        "/voice/post-call",
        content=body,
        headers={"ElevenLabs-Signature": f"t={t},v0={digest}", "Content-Type": "application/json"},
    )


def test_post_call_webhook_checks_its_signature(gateway: TestClient) -> None:
    payload = {"type": "post_call_transcription", "data": {"conversation_id": "conv_9"}}

    assert signed_post_call(gateway, payload).status_code == 200
    assert signed_post_call(gateway, payload, secret="wrong").status_code == 401
    assert gateway.post("/voice/post-call", json=payload).status_code == 401


def test_ws_rejects_a_bad_token(gateway: TestClient) -> None:
    with (
        pytest.raises(WebSocketDisconnect),
        gateway.websocket_connect("/events?token=nope") as live,
    ):
        live.receive_json()


def test_ws_event_latency_under_200ms_local(gateway: TestClient) -> None:
    with gateway.websocket_connect(f"/events?token={TOKEN}") as live:
        start = time.perf_counter()
        gateway.post("/missions", json=MISSION, headers=AUTH)
        live.receive_json()  # mission_created
        first_change = live.receive_json()
        elapsed_ms = (time.perf_counter() - start) * 1000

    assert first_change["type"] == "state_changed"
    assert elapsed_ms < 200


def test_a_restarted_gateway_recovers_the_pending_question(
    gateway: TestClient, tmp_path: Path
) -> None:
    view = gateway.post("/missions", json=MISSION, headers=AUTH).json()
    old = gateway.service  # type: ignore[attr-defined]
    restarted = type(old)(
        old.deps, old._checkpoints, old._bus
    )  # same database, fresh process state

    waiting = asyncio.run(restarted.recover())
    request_id = restarted.pending_for(view["id"])

    assert waiting == [view["id"]]
    assert request_id == view["ask"]["request_id"]  # the same question, not a new one


def test_stall_event_reaches_dashboard_under_200ms(gateway: TestClient) -> None:
    voice = {"X-Tempo-Voice-Secret": VOICE}
    with gateway.websocket_connect(f"/events?token={TOKEN}") as live:
        start = time.perf_counter()
        gateway.post(
            "/voice/tools/log_stall",
            json={"mission_id": "m_1", "category": "made_up", "quote": "Please continue to hold."},
            headers=voice,
        )
        event = live.receive_json()
        elapsed_ms = (time.perf_counter() - start) * 1000

    assert event["type"] == "log_stall"
    assert event["category"] == "hold_extension"  # the rules overrule the model's label
    assert event["counter"].startswith("Log the minutes")
    assert elapsed_ms < 200


def test_the_dashboard_lists_missions_and_the_ledger(gateway: TestClient) -> None:
    view = gateway.post("/missions", json=MISSION, headers=AUTH).json()
    trace = view["ask"]["proof_trace"]
    gateway.post(f"/approvals/{view['ask']['request_id']}", json={"approved": True}, headers=AUTH)
    gateway.post("/scheduler/tick", headers=AUTH)

    missions = gateway.get("/missions", headers=AUTH).json()
    ledger = gateway.get("/ledger", headers=AUTH).json()

    assert trace["amount_gbp"] == "14.20"
    assert trace["steps"][0]["citation_url"].startswith("https://")
    assert [m["id"] for m in missions] == [view["id"]]
    assert ledger == {"minutes_returned": "20", "hours_returned": "0.3", "gbp_recovered": "14.20"}


def test_cors_allows_mission_control_only(gateway: TestClient) -> None:
    ok = gateway.options(
        "/missions",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    other = gateway.options(
        "/missions",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )

    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in other.headers


def test_the_ledger_shows_pounds_to_the_penny_even_when_empty(gateway: TestClient) -> None:
    assert gateway.get("/ledger", headers=AUTH).json()["gbp_recovered"] == "0.00"


def test_in_replay_the_consensus_court_sits_and_its_votes_are_shown(gateway: TestClient) -> None:
    view = gateway.post("/missions", json=MISSION, headers=AUTH).json()

    court = view["court"]
    assert court["outcome"] == "proceed"
    assert [v["juror"] for v in court["verdicts"]] == [
        "claude-sonnet-5-5",
        "openai-gpt-5-mini",
        "llama4-maverick",
    ]
    assert (
        view["ask"]["proof_trace"]["steps"][-1]["explanation"]
        == "Consensus Court: 3/3 jurors agreed that this is eligible"
    )
    assert view["ask"]["amount_gbp"] == "14.20"  # the court never changes the amount
