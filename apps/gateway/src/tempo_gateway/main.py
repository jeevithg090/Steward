"""Run the Gateway: `uv run tempo-gateway` (replay mode unless TEMPO_MODE=live)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from tempo_adapters.cortex import (
    CortexJuror,
    PatTokenProvider,
    cortex_client,
    juror_models,
    replay_jurors,
)
from tempo_adapters.db import SqlRepo, make_engine
from tempo_adapters.rail import rail_port
from tempo_adapters.settings import Settings
from tempo_adapters.telemetry import configure_logging, configure_tracing, trace_url
from tempo_core.rules import RulePackRegistry
from tempo_gateway.app import create_app
from tempo_gateway.events import EventBus, PublishingRepo
from tempo_gateway.missions import MissionService
from tempo_missions.clawback_rail import ClawbackDeps
from tempo_missions.court import ConsensusCourt
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo
from tempo_ports.repo import RepoPort

REPO = Path(__file__).resolve().parents[4]


def build_service(settings: Settings) -> tuple[MissionService, EventBus]:
    """Replay mode uses recorded rail data, an in-memory store and the simulated operator, so
    the whole mission runs with no keys and no network."""
    bus = EventBus()

    def clock() -> datetime:
        return datetime.now(tz=UTC)

    deps = ClawbackDeps(
        court=_court(settings),
        repo=PublishingRepo(_repo(settings), bus),
        rail=rail_port(settings),
        rules=RulePackRegistry.from_directory(REPO / "skills" / "clawback-uk-rail"),
        claims=SimulatedClaims(pays_after=timedelta(0), clock=clock),
        clock=clock,
        payment_check_after=timedelta(seconds=settings.payment_check_after_s),
    )
    service = MissionService(
        deps,
        Path(settings.checkpoint_dir),
        bus,
        trace_link=lambda trace_id: trace_url(settings, trace_id),
    )
    return service, bus


def _repo(settings: Settings) -> RepoPort:
    """Postgres when DATABASE_URL is set (missions survive restarts), else in memory."""
    if settings.database_url is not None:
        return SqlRepo(make_engine(settings.database_url.get_secret_value()))
    return InMemoryRepo()


def _court(settings: Settings) -> ConsensusCourt | None:
    """Replay jurors in replay mode (labelled simulated); Cortex jurors when Snowflake is set up."""
    if settings.tempo_mode == "replay":
        return ConsensusCourt(replay_jurors(REPO / "fixtures" / "court" / "replay.yaml"))
    if settings.snowflake_account and settings.snowflake_pat:
        tokens = PatTokenProvider(lambda: settings.snowflake_pat)
        account = settings.snowflake_account
        return ConsensusCourt(
            [
                CortexJuror(cortex_client(m, account=account, tokens=tokens), name=m)
                for m in juror_models()
            ]
        )
    return None


def build(
    settings: Settings | None = None, *, scheduler_interval_s: float | None = None
) -> FastAPI:
    settings = settings or Settings()
    configure_logging()
    configure_tracing(settings)  # exports to Langfuse when its keys are set
    service, bus = build_service(settings)
    return create_app(service, settings, bus, scheduler_interval_s=scheduler_interval_s)


def run() -> None:
    uvicorn.run(build(scheduler_interval_s=30.0), host="127.0.0.1", port=8000)
