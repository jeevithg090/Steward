"""Replay rail data: recorded journeys, no network. TEMPO_MODE=replay for demos and CI."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from tempo_adapters.rail._http import hhmm
from tempo_core.delays import LONDON
from tempo_core.errors import ServiceNotFound
from tempo_core.intent import station_name
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
            raise ServiceNotFound(_unrecorded(key)) from None


def _unrecorded(key: Key) -> str:
    """Plain words, never the lookup key's repr: Mission Control and the chat show this message
    inside "I couldn't find that train in the rail records (…)"."""
    origin, destination, day, departure = key
    return (
        f"no recorded journey for the {departure[:2]}:{departure[2:]} from "
        f"{station_name(origin)} to {station_name(destination)} on {day:%-d %B %Y}"
    )
