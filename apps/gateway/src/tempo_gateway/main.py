"""Run the Gateway: `uv run tempo-gateway` (replay mode unless TEMPO_MODE=live)."""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI

from tempo_adapters import bank_holidays
from tempo_adapters.cortex import (
    CortexJuror,
    PatTokenProvider,
    cortex_client,
    juror_models,
    replay_jurors,
)
from tempo_adapters.db import SqlRepo, make_engine
from tempo_adapters.db.vault import SqlVaultStore
from tempo_adapters.elevenlabs import load_greetings
from tempo_adapters.factory import NotConfigured, build_adapters, chat_client
from tempo_adapters.rail import rail_port
from tempo_adapters.scam import (
    LiveSandbox,
    Registers,
    ReplaySandbox,
    ThreatFeeds,
    WarningList,
    registers_from_fixtures,
)
from tempo_adapters.settings import Settings
from tempo_adapters.telemetry import (
    configure_logging,
    configure_tracing,
    quiet_server_logs,
    trace_url,
)
from tempo_adapters.vision import GeminiVision, ReplayVision
from tempo_core.entitlement import Figures
from tempo_core.hazard import load_hazards
from tempo_core.profiles import ProfileCatalog
from tempo_core.rules import RulePackRegistry
from tempo_core.scam_model import ScamModel
from tempo_core.scam_voice import load_warnings
from tempo_core.signals import SignalSpec, load_signals
from tempo_crypto.vault import MemoryVaultStore, VaultStore
from tempo_gateway.app import create_app
from tempo_gateway.clock import DemoClock
from tempo_gateway.events import EventBus, PublishingRepo
from tempo_gateway.mandates import MandateService, gateway_key
from tempo_gateway.memory import Memory, build_memory
from tempo_gateway.mesh import Mesh, WebPushSender
from tempo_gateway.missions import MissionService
from tempo_gateway.shield import ShieldService
from tempo_missions.clawback_rail import ClawbackDeps
from tempo_missions.court import ConsensusCourt
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo
from tempo_ports.vision import VisionPort

# Rule packs and replay fixtures: the repository, or TEMPO_HOME in the container image.
REPO = Path(os.environ.get("TEMPO_HOME") or Path(__file__).resolve().parents[4])


def HOLIDAYS() -> frozenset[date]:
    return bank_holidays.from_file(REPO / "fixtures" / "govuk" / "bank-holidays.json")


def build_service(settings: Settings) -> tuple[MissionService, EventBus]:
    """Replay mode uses recorded rail data, an in-memory store and the simulated operator, so
    the whole mission runs with no keys and no network."""
    service, bus, _ = build_services(settings)
    return service, bus


def build_services(settings: Settings) -> tuple[MissionService, EventBus, Memory]:
    """The missions and Tempo Memory, sharing one Postgres engine when DATABASE_URL is set."""
    service, bus, memory, _ = _build(settings)
    return service, bus, memory


def _build(settings: Settings) -> tuple[MissionService, EventBus, Memory, VaultStore]:
    bus = EventBus()
    engine = (
        make_engine(settings.database_url.get_secret_value()) if settings.database_url else None
    )
    clock = DemoClock()  # the real time, until a demo moves it (TEMPO_DEMO=1 only)
    credited: set[str] = set()

    async def credit_arrived(mission_id: str) -> bool:
        return mission_id in credited  # (check) live: read the next bill, or open banking

    deps = ClawbackDeps(
        court=_court(settings),
        repo=PublishingRepo(SqlRepo(engine) if engine is not None else InMemoryRepo(), bus),
        rail=rail_port(settings),
        rules=RulePackRegistry.from_directory(REPO / "skills"),
        claims=SimulatedClaims(pays_after=timedelta(0), clock=clock),
        clock=clock,
        payment_check_after=timedelta(seconds=settings.payment_check_after_s),
        hazards=load_hazards(REPO / "skills" / "rights-decay" / "hazards"),
        holidays=HOLIDAYS(),
        credit_arrived=credit_arrived,
    )
    service = MissionService(
        deps,
        Path(settings.checkpoint_dir),
        bus,
        trace_link=lambda trace_id: trace_url(settings, trace_id),
    )
    service.credited = credited
    vault: VaultStore = SqlVaultStore(engine) if engine is not None else MemoryVaultStore()
    return service, bus, build_memory(settings, engine), vault


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
    service, bus, memory, vault = _build(settings)
    registers, simulated = build_registers(settings)
    signals = _signals()
    shield = build_shield(settings, bus, service.deps.clock, registers, simulated, signals)
    seed = settings.mandate_signing_key
    mandates = MandateService(
        service.deps.repo, service.deps.clock, public_url=settings.public_url,
        signing_key=gateway_key(seed.get_secret_value() if seed else None),
    )  # fmt: skip
    return create_app(
        service, settings, bus, memory=memory, mesh=build_mesh(settings, service.deps.clock),
        vault=vault,
        registers=registers, registers_simulated=simulated,
        holidays=HOLIDAYS(),
        entitlement=Figures.from_file(REPO / "skills" / "entitlement-check" / "figures.yaml"),
        signals=signals, shield=shield,
        transparency=REPO / "deploy" / "transparency", scheduler_interval_s=scheduler_interval_s,
        mandates=mandates, vision=build_vision(settings),
        greetings=load_greetings(REPO / "voice" / "greetings.yaml"),
        profiles=ProfileCatalog.load(REPO / "profiles", REPO / "skills"),
    )  # fmt: skip


def _signals() -> dict[str, SignalSpec]:
    """Every skill's on-device signal filters (skills/*/signals.yaml)."""
    return {s.id: s for p in sorted(REPO.glob("skills/*/signals.yaml")) for s in load_signals(p)}


def build_shield(
    settings: Settings,
    bus: EventBus,
    clock: Callable[[], datetime],
    registers: Registers | None,
    registers_simulated: bool,
    signals: dict[str, SignalSpec],
) -> ShieldService:
    """Scam Shield (docs/scam-shield.md): the shipped text model, the one `scam_text` signal, the
    cached phishing lists, the spoken warnings, and a link sandbox that is live only when asked
    (SCAM_SANDBOX=live, or TEMPO_MODE=live) and otherwise answers from recordings."""
    live = settings.scam_sandbox == "live" or (
        settings.scam_sandbox is None and settings.tempo_mode == "live"
    )
    sandbox = (
        LiveSandbox(httpx.AsyncClient())
        if live
        else ReplaySandbox(REPO / "fixtures" / "scam" / "sandbox")
    )
    feeds_dir = (
        Path(settings.scam_feeds_dir)
        if settings.scam_feeds_dir
        else REPO / "fixtures" / "scam" / "feeds"
    )
    model_path = REPO / "skills" / "scam-shield" / "model.json"
    return ShieldService(
        model=ScamModel.load(model_path) if model_path.exists() else None,
        spec=signals.get("scam_text"), registers=registers, registers_simulated=registers_simulated,
        feeds=ThreatFeeds.from_directory(feeds_dir), sandbox=sandbox, sandbox_simulated=not live,
        warnings=load_warnings(REPO / "voice" / "warnings.yaml"), bus=bus, clock=clock,
    )  # fmt: skip


def build_vision(settings: Settings) -> VisionPort:
    """Gemini reads photos in live mode with a key; otherwise recorded readings (labelled)."""
    key = settings.gemini_api_key
    if settings.tempo_mode == "live" and key:
        return GeminiVision(
            httpx.AsyncClient(), api_key=key.get_secret_value(), model=settings.gemini_model
        )
    return ReplayVision(REPO / "fixtures" / "vision")


def build_registers(settings: Settings) -> tuple[Registers, bool]:
    """Scam Shield's registers: live when keys are set and not replaying; else recorded."""
    live_keys = settings.companies_house_api_key or (
        settings.fca_api_email and settings.fca_api_key
    )
    if settings.tempo_mode == "live" and live_keys:
        key = settings.companies_house_api_key
        fca = settings.fca_api_key
        warnings = WarningList.from_file(REPO / "fixtures" / "scam" / "fca_warning_list.json")
        registers = Registers(
            httpx.AsyncClient(), warning_list=warnings,
            companies_house_key=key.get_secret_value() if key else None,
            fca_email=settings.fca_api_email, fca_key=fca.get_secret_value() if fca else None,
        )  # fmt: skip
        return registers, False
    return registers_from_fixtures(REPO / "fixtures" / "scam", today=datetime.now(UTC).date()), True


def build_mesh(settings: Settings, clock: Callable[[], datetime] | None = None) -> Mesh:
    push = None
    if settings.vapid_private_key and settings.vapid_subject:
        push = WebPushSender(settings.vapid_private_key.get_secret_value(), settings.vapid_subject)
    origins = [o.strip() for o in settings.web_origins.split(",") if o.strip()]
    return Mesh(
        rp_id=settings.mesh_rp_id,
        origins=origins,
        path=Path(settings.mesh_file),
        push=push,
        clock=clock or (lambda: datetime.now(UTC)),
    )


def run() -> None:
    uvicorn.run(build(scheduler_interval_s=30.0), host="127.0.0.1", port=8000, access_log=False)
