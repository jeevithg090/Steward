"""Realtime Trains next-generation API (https://data.rtt.io), bearer-token auth.

Times come back as ISO 8601 instants with offsets, so no wall-clock guessing is needed.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx

from tempo_adapters.rail._http import hhmm, send
from tempo_core.delays import LONDON, delay_minutes
from tempo_core.errors import ServiceNotFound
from tempo_ports.rail import ServiceDelay

SEARCH_WINDOW_MIN = 10


class RttSource:
    def __init__(self, http: httpx.AsyncClient, *, base_url: str, token: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    async def service_delay(
        self, origin_crs: str, destination_crs: str, day: date, scheduled_departure: str
    ) -> ServiceDelay:
        departure = hhmm(scheduled_departure)
        line_up = await self._get(
            "/gb-nr/location",
            {
                "code": origin_crs,
                "filterTo": destination_crs,
                "timeFrom": f"{day.isoformat()}T{departure[:2]}:{departure[2:]}:00",
                "timeWindow": str(SEARCH_WINDOW_MIN),
            },
        )
        meta = _matching_service(line_up, departure)
        detail = await self._get(
            "/gb-nr/service", {"identity": meta["identity"], "departureDate": meta["departureDate"]}
        )
        return _parse_service(detail, meta, origin_crs, destination_crs)

    async def _get(self, path: str, params: dict[str, str]) -> Any:
        request = self._http.build_request(
            "GET", f"{self._base}{path}", params=params, headers=self._headers
        )
        return await send(self._http, request, f"RTT {path}")


def _local_hhmm(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(LONDON).strftime("%H%M")


def _matching_service(line_up: Any, departure: str) -> dict[str, Any]:
    for service in line_up.get("services") or []:
        planned = ((service.get("temporalData") or {}).get("departure") or {}).get(
            "scheduleAdvertised"
        )
        if planned and _local_hhmm(planned) == departure:
            meta: dict[str, Any] = service["scheduleMetadata"]
            return meta
    raise ServiceNotFound(f"RTT has no service departing at {departure}")


def _calls_at(location: dict[str, Any], crs: str) -> bool:
    return crs in ((location.get("location") or {}).get("shortCodes") or [])


def _parse_service(
    detail: Any, meta: dict[str, Any], origin: str, destination: str
) -> ServiceDelay:
    locations = detail["service"]["locations"]
    start = next((loc for loc in locations if _calls_at(loc, origin)), None)
    stop = next((loc for loc in locations if _calls_at(loc, destination)), None)
    if start is None or stop is None:
        raise ServiceNotFound(f"RTT service {meta['identity']} does not run {origin}→{destination}")
    departure = start["temporalData"]["departure"]
    arrival = stop["temporalData"].get("arrival") or {}
    scheduled = datetime.fromisoformat(arrival["scheduleAdvertised"])
    actual = (
        datetime.fromisoformat(arrival["realtimeActual"]) if arrival.get("realtimeActual") else None
    )
    cancelled = stop["temporalData"].get("displayAs") == "CANCELLED"
    unique = meta.get("uniqueIdentity") or f"gb-nr:{meta['identity']}:{meta['departureDate']}"
    return ServiceDelay(
        service_id=unique,
        operator_code=(meta.get("operator") or {}).get("code", "?"),
        origin_crs=origin,
        destination_crs=destination,
        scheduled_departure=datetime.fromisoformat(departure["scheduleAdvertised"]),
        scheduled_arrival=scheduled,
        actual_arrival=None if cancelled else actual,
        cancelled=cancelled,
        delay_minutes=None if cancelled or actual is None else delay_minutes(scheduled, actual),
        source=f"rtt:{unique}",
    )
