"""Replay rail data: recorded journeys, no network. TEMPO_MODE=replay for demos and CI."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from tempo_adapters.rail._http import hhmm
from tempo_core.delays import LONDON
from tempo_core.errors import ServiceNotFound
from tempo_ports.rail import ServiceDelay

Key = tuple[str, str, date, str]


class ReplayRail:
    def __init__(self, journeys: list[ServiceDelay]) -> None:
        self._by_key: dict[Key, ServiceDelay] = {}
        for journey in journeys:
            departure = journey.scheduled_departure.astimezone(LONDON)
            key = (
                journey.origin_crs,
                journey.destination_crs,
                departure.date(),
                departure.strftime("%H%M"),
            )
            self._by_key[key] = journey

    @classmethod
    def from_directory(cls, directory: Path) -> ReplayRail:
        return cls(
            [
                ServiceDelay.model_validate_json(p.read_text())
                for p in sorted(directory.glob("*.json"))
            ]
        )

    async def service_delay(
        self, origin_crs: str, destination_crs: str, day: date, scheduled_departure: str
    ) -> ServiceDelay:
        key = (origin_crs, destination_crs, day, hhmm(scheduled_departure))
        try:
            return self._by_key[key]
        except KeyError:
            raise ServiceNotFound(f"no recorded journey for {key}") from None
