"""Observability (S6.2): every mission step is a span carrying the mission id; logs are safe."""

from __future__ import annotations

import base64
import io
import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import structlog
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from tempo_adapters.rail import ReplayRail
from tempo_adapters.settings import Settings
from tempo_adapters.telemetry import (
    MISSION_ATTRIBUTE,
    configure_logging,
    configure_tracing,
    langfuse_exporter,
    langfuse_otlp,
    mission_context,
    trace_url,
)
from tempo_core.rules import RulePackRegistry
from tempo_gateway.events import EventBus
from tempo_gateway.missions import MissionService, StartMission
from tempo_missions.clawback_rail import ClawbackDeps
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo

ROOT = Path(__file__).resolve().parents[2]
EXPORTER = InMemorySpanExporter()
configure_tracing(Settings(_env_file=None), exporter=EXPORTER)  # type: ignore[call-arg]


def service(tmp: Path) -> MissionService:
    deps = ClawbackDeps(
        repo=InMemoryRepo(),
        rail=ReplayRail.from_directory(ROOT / "fixtures" / "rail" / "replay"),
        rules=RulePackRegistry.from_directory(ROOT / "skills" / "clawback-uk-rail"),
        claims=SimulatedClaims(),
    )
    return MissionService(deps, tmp, EventBus(), trace_link=lambda t: f"https://lf.test/trace/{t}")


async def test_every_workflow_step_has_span(tmp_path: Path) -> None:
    EXPORTER.clear()
    svc = service(tmp_path)

    view = await svc.start(
        StartMission(user_id="u", display_name="M", origin_crs="OXF", destination_crs="PAD",
                     travel_date="2026-10-23", departure="08:12", fare_gbp=Decimal("28.40"))
    )  # fmt: skip

    spans = EXPORTER.get_finished_spans()
    steps = {
        s.name.removeprefix("executor.process ")
        for s in spans
        if s.name.startswith("executor.process")
    }
    assert steps == {"intake", "rights", "court", "arbiter", "consent"}
    assert all((s.attributes or {}).get(MISSION_ATTRIBUTE) == view.id for s in spans)
    root = next(s for s in spans if s.name == "tempo.mission.start")
    assert len({s.context.trace_id for s in spans}) == 1  # one trace for the whole operation
    assert view.trace_url == f"https://lf.test/trace/{format(root.context.trace_id, '032x')}"


def test_logs_have_trace_id_and_no_pii() -> None:
    from opentelemetry import trace

    out = io.StringIO()
    configure_logging(out)
    try:
        with mission_context("m_1"), trace.get_tracer("t").start_as_current_span("work"):
            structlog.get_logger().info(
                "claim_filed",
                state="completed",
                latency_ms=12,
                phone="07700 900123",
                name="Margaret",
            )
    finally:
        structlog.reset_defaults()

    line = json.loads(out.getvalue())
    assert line["event"] == "claim_filed"
    assert line["mission_id"] == "m_1"
    assert len(line["trace_id"]) == 32
    assert "phone" not in line and "name" not in line
    assert "07700" not in out.getvalue()


def test_langfuse_gets_traces_only_when_configured() -> None:
    assert langfuse_exporter(Settings(_env_file=None)) is None  # type: ignore[call-arg]
    configured = Settings(  # type: ignore[call-arg]
        _env_file=None,
        langfuse_host="https://cloud.langfuse.com",
        langfuse_public_key="pk-lf-1",
        langfuse_secret_key="sk-lf-1",
    )

    target = langfuse_otlp(configured)

    assert target is not None
    endpoint, headers = target
    assert endpoint == "https://cloud.langfuse.com/api/public/otel/v1/traces"
    assert base64.b64decode(headers["Authorization"].removeprefix("Basic ")) == b"pk-lf-1:sk-lf-1"
    assert langfuse_exporter(configured) is not None
    assert trace_url(configured, "abc") == "https://cloud.langfuse.com/trace/abc"
    assert datetime.now(tz=UTC)  # keep imports honest
