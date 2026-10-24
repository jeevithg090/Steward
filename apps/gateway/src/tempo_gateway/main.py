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
from tempo_adapters.factory import NotConfigured, build_adapters, chat_client
from tempo_adapters.rail import rail_port
from tempo_adapters.settings import Settings
from tempo_adapters.telemetry import (
    configure_logging,
    configure_tracing,
    quiet_server_logs,
    trace_url,
)
from tempo_core.rules import RulePackRegistry
from tempo_gateway.app import create_app
from tempo_gateway.events import EventBus, PublishingRepo
from tempo_gateway.memory import Memory, build_memory
from tempo_gateway.mesh import Mesh, WebPushSender
from tempo_gateway.missions import MissionService
from tempo_missions.clawback_rail import ClawbackDeps
from tempo_missions.court import ConsensusCourt
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo

REPO = Path(__file__).resolve().parents[4]


def build_service(settings: Settings) -> tuple[MissionService, EventBus]:
    """Replay mode uses recorded rail data, an in-memory store and the simulated operator, so
    the whole mission runs with no keys and no network."""
    service, bus, _ = build_services(settings)
    return service, bus


def build_services(settings: Settings) -> tuple[MissionService, EventBus, Memory]:
    """The missions and Tempo Memory, sharing one Postgres engine when DATABASE_URL is set."""
    bus = EventBus()
    engine = (
        make_engine(settings.database_url.get_secret_value()) if settings.database_url else None
    )

    def clock() -> datetime:
        return datetime.now(tz=UTC)

    deps = ClawbackDeps(
        court=_court(settings),
        repo=PublishingRepo(SqlRepo(engine) if engine is not None else InMemoryRepo(), bus),
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
    return service, bus, build_memory(settings, engine)


def _court(settings: Settings) -> ConsensusCourt | None:
    """Replay jurors in replay mode (labelled simulated); otherwise only the deployment mode's own
    model: three Cortex models in cloud-standard, or three jurors on the private model."""
    if settings.tempo_mode == "replay":
        return ConsensusCourt(replay_jurors(REPO / "fixtures" / "court" / "replay.yaml"))
    adapters = build_adapters(settings)
    if adapters.model.kind != "cortex":
        try:
            client = chat_client(settings, adapters)
        except NotConfigured:
            return None
        return ConsensusCourt(
            [CortexJuror(client, name=f"{adapters.model.kind}-{i}") for i in (1, 2, 3)]
        )
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
    quiet_server_logs()  # no query strings (tokens, user ids) in server logs
    configure_tracing(settings)  # exports to Langfuse when its keys are set
    service, bus, memory = build_services(settings)
    return create_app(
        service, settings, bus, memory=memory, mesh=build_mesh(settings),
        scheduler_interval_s=scheduler_interval_s,
    )  # fmt: skip


def build_mesh(settings: Settings) -> Mesh:
    push = None
    if settings.vapid_private_key and settings.vapid_subject:
        push = WebPushSender(settings.vapid_private_key.get_secret_value(), settings.vapid_subject)
    origins = [o.strip() for o in settings.web_origins.split(",") if o.strip()]
    return Mesh(
        rp_id=settings.mesh_rp_id, origins=origins, path=Path(settings.mesh_file), push=push
    )


def run() -> None:
    uvicorn.run(build(scheduler_interval_s=30.0), host="127.0.0.1", port=8000, access_log=False)
