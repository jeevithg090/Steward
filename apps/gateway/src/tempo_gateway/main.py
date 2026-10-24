"""Run the Gateway: `uv run tempo-gateway` (replay mode unless TEMPO_MODE=live)."""

from __future__ import annotations

from pathlib import Path

import uvicorn
from fastapi import FastAPI

from tempo_adapters.rail import rail_port
from tempo_adapters.settings import Settings
from tempo_core.rules import RulePackRegistry
from tempo_gateway.app import create_app
from tempo_gateway.events import EventBus, PublishingRepo
from tempo_gateway.missions import MissionService
from tempo_missions.clawback_rail import ClawbackDeps
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo

REPO = Path(__file__).resolve().parents[4]


def build_service(settings: Settings) -> tuple[MissionService, EventBus]:
    """Replay mode uses recorded rail data, an in-memory store and the simulated operator, so
    the whole mission runs with no keys and no network."""
    bus = EventBus()
    deps = ClawbackDeps(
        repo=PublishingRepo(InMemoryRepo(), bus),
        rail=rail_port(settings),
        rules=RulePackRegistry.from_directory(REPO / "skills" / "clawback-uk-rail"),
        claims=SimulatedClaims(),
    )
    return MissionService(deps, Path(settings.checkpoint_dir), bus), bus


def build(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    service, bus = build_service(settings)
    return create_app(service, settings, bus)


def run() -> None:
    uvicorn.run(build(), host="127.0.0.1", port=8000)
