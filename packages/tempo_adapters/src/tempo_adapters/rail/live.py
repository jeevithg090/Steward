"""Live rail data: HSP (the official record) first, Realtime Trains when HSP can't answer."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

import structlog

from tempo_core.errors import RailDataUnavailable, ServiceNotFound
from tempo_ports.rail import RailDataPort, ServiceDelay

log = structlog.get_logger(__name__)


class LiveRail:
    def __init__(self, sources: Sequence[tuple[str, RailDataPort]]) -> None:
        if not sources:
            raise ValueError("LiveRail needs at least one source")
        self._sources = tuple(sources)

    async def service_delay(
        self, origin_crs: str, destination_crs: str, day: date, scheduled_departure: str
    ) -> ServiceDelay:
        failures: list[Exception] = []
        for name, source in self._sources:
            try:
                return await source.service_delay(
                    origin_crs, destination_crs, day, scheduled_departure
                )
            except (RailDataUnavailable, ServiceNotFound) as exc:
                log.warning("rail_source_failed", source=name, error_code=type(exc).__name__)
                failures.append(exc)
        if all(isinstance(f, ServiceNotFound) for f in failures):
            raise ServiceNotFound("; ".join(map(str, failures)))
        raise RailDataUnavailable("; ".join(map(str, failures)))
