"""Rail data adapters: HSP and Realtime Trains (live), and recorded journeys (replay)."""

from __future__ import annotations

from pathlib import Path

import httpx

from tempo_adapters.rail._http import TIMEOUT
from tempo_adapters.rail.hsp import HspSource
from tempo_adapters.rail.live import LiveRail
from tempo_adapters.rail.replay import ReplayRail
from tempo_adapters.rail.rtt import RttSource
from tempo_adapters.settings import Settings
from tempo_ports.rail import RailDataPort

REPO = Path(__file__).resolve().parents[5]
REPLAY_DIR = REPO / "fixtures" / "rail" / "replay"

__all__ = ["HspSource", "LiveRail", "ReplayRail", "RttSource", "rail_port"]


def rail_port(
    settings: Settings, http: httpx.AsyncClient | None = None, replay_dir: Path = REPLAY_DIR
) -> RailDataPort:
    """The rail port for this mode: recorded journeys in replay, HSP then RTT in live."""
    if settings.tempo_mode == "replay":
        return ReplayRail.from_directory(replay_dir)
    http = http or httpx.AsyncClient(timeout=TIMEOUT)
    sources: list[tuple[str, RailDataPort]] = []
    if settings.hsp_base_url and (settings.hsp_api_key or settings.hsp_pass):
        sources.append(
            (
                "hsp",
                HspSource(
                    http,
                    base_url=settings.hsp_base_url,
                    api_key=settings.hsp_api_key.get_secret_value()
                    if settings.hsp_api_key
                    else None,
                    basic_auth=(settings.hsp_user or "", settings.hsp_pass.get_secret_value())
                    if settings.hsp_pass and not settings.hsp_api_key
                    else None,
                ),
            )
        )
    if settings.rtt_token:
        sources.append(
            (
                "rtt",
                RttSource(
                    http,
                    base_url=settings.rtt_base_url,
                    token=settings.rtt_token.get_secret_value(),
                ),
            )
        )
    return LiveRail(sources)
