"""The canary test (S8.5): a marker planted in a name, a call transcript and a text message
must not appear in any log line or exported span.

Scope, honestly: the database and mission checkpoints still hold names and memories in plain
text until the Vault (S8.3) is wired into them with key release (S8.4); this test covers
logs and traces, which leave the machine.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import time
from pathlib import Path

import pytest
import structlog
from fastapi.testclient import TestClient
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from twilio.request_validator import RequestValidator

from tempo_adapters.settings import Settings
from tempo_adapters.telemetry import configure_logging, configure_tracing, quiet_server_logs
from tempo_gateway.app import create_app
from tempo_gateway.main import build_services

CANARY = "ZEBRA-CANARY-7731"
SPANS = InMemorySpanExporter()
configure_tracing(Settings(_env_file=None), exporter=SPANS)  # type: ignore[call-arg]


def test_canary_never_logged(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    out = io.StringIO()
    configure_logging(out)
    quiet_server_logs()
    caplog.set_level(logging.DEBUG)
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token="t", twilio_auth_token="tw",
        elevenlabs_webhook_secret="hook", elevenlabs_agent_inbound_id="inbound",
        public_url="https://tempo.example.test", checkpoint_dir=str(tmp_path / "cp"),
        payment_check_after_s=0,
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    auth = {"Authorization": "Bearer t"}
    try:
        with TestClient(create_app(service, settings, bus, memory=memory)) as gw:
            view = gw.post("/missions", headers=auth, json={
                "user_id": "u_canary", "display_name": f"Margaret {CANARY}", "phone": "+15550100999",
                "origin_crs": "OXF", "destination_crs": "PAD", "travel_date": "2026-10-23",
                "departure": "08:12", "fare_gbp": "28.40",
            }).json()  # fmt: skip
            gw.post(
                f"/approvals/{view['ask']['request_id']}", json={"approved": True}, headers=auth
            )
            gw.post("/scheduler/tick", headers=auth)
            call = json.dumps({"data": {
                "agent_id": "inbound", "conversation_id": "c1",
                "transcript": [{"role": "user", "message": f"I prefer {CANARY} updates."}],
                "conversation_initiation_client_data": {"dynamic_variables": {"caller_id": "u_canary"}},
            }}).encode()  # fmt: skip
            t = str(int(time.time()))
            sig = hmac.new(b"hook", f"{t}.".encode() + call, hashlib.sha256).hexdigest()
            gw.post("/voice/post-call", content=call,
                    headers={"ElevenLabs-Signature": f"t={t},v0={sig}", "Content-Type": "application/json"})  # fmt: skip
            form = {"From": "+15550100999", "Body": f"FORGET {CANARY}", "MessageSid": "SM1"}
            signature = RequestValidator("tw").compute_signature(
                "https://tempo.example.test/sms/inbound", form
            )
            gw.post("/sms/inbound", data=form, headers={"X-Twilio-Signature": signature})
    finally:
        structlog.reset_defaults()

    spans = SPANS.get_finished_spans()
    exported = json.dumps([
        {"attributes": dict(s.attributes or {}), "events": [dict(e.attributes or {}) for e in s.events], "name": s.name}
        for s in spans
    ], default=str)  # fmt: skip
    assert spans  # the mission was traced
    assert CANARY not in out.getvalue()
    assert CANARY not in caplog.text
    assert CANARY not in exported
