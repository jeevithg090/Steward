"""National Rail Historical Service Performance (HSP): the official record of what ran when.

(check) The base URL and auth come from the Rail Data Marketplace subscription page
(HSP_BASE_URL plus HSP_API_KEY, or HSP_USER/HSP_PASS). Request and response bodies follow HSP's
serviceMetrics / serviceDetails format.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import httpx

from tempo_adapters.rail._http import hhmm, send
from tempo_core.delay_model import THRESHOLDS, Run
from tempo_core.delays import LONDON, at_or_after, delay_minutes, nearest
from tempo_core.errors import ServiceNotFound
from tempo_ports.rail import ServiceDelay

DAY_TYPES = {5: "SATURDAY", 6: "SUNDAY"}


class HspSource:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        base_url: str,
        api_key: str | None = None,
        basic_auth: tuple[str, str] | None = None,
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._headers = {"x-apikey": api_key} if api_key else {}
        self._auth = basic_auth

    async def service_delay(
        self, origin_crs: str, destination_crs: str, day: date, scheduled_departure: str
    ) -> ServiceDelay:
        departure = hhmm(scheduled_departure)
        metrics = await self._post(
            "serviceMetrics", _metrics_query(origin_crs, destination_crs, day, departure)
        )
        rid = _matching_rid(metrics, departure)
        details = await self._post("serviceDetails", {"rid": rid})
        return _parse_details(details, origin_crs, destination_crs, departure)

    async def day_runs(
        self,
        origin_crs: str,
        destination_crs: str,
        day: date,
        thresholds: tuple[int, ...] = THRESHOLDS,
    ) -> list[Run]:
        """Every service on the route that day, and which lateness thresholds each reached (one
        call a day: the delay model's history, S6.3)."""
        query: dict[str, Any] = {
            "from_loc": origin_crs, "to_loc": destination_crs, "from_time": "0000",
            "to_time": "2359", "from_date": day.isoformat(), "to_date": day.isoformat(),
            "days": DAY_TYPES.get(day.weekday(), "WEEKDAY"),
            "tolerance": [str(t) for t in thresholds],  # (check) HSP's tolerance list
        }  # fmt: skip
        return runs_from_metrics(await self._post("serviceMetrics", query), day)

    async def _post(self, endpoint: str, body: dict[str, Any]) -> Any:
        request = self._http.build_request(
            "POST", f"{self._base}/{endpoint}", json=body, headers=self._headers
        )
        return await send(self._http, request, f"HSP {endpoint}", auth=self._auth)


def _metrics_query(origin: str, destination: str, day: date, departure: str) -> dict[str, str]:
    start = datetime.combine(day, datetime.strptime(departure, "%H%M").time())
    return {
        "from_loc": origin,
        "to_loc": destination,
        "from_time": (start - timedelta(minutes=1)).strftime("%H%M"),
        "to_time": (start + timedelta(minutes=1)).strftime("%H%M"),
        "from_date": day.isoformat(),
        "to_date": day.isoformat(),
        "days": DAY_TYPES.get(day.weekday(), "WEEKDAY"),
    }


def runs_from_metrics(metrics: Any, day: date) -> list[Run]:
    """One Run per service: a tolerance with any run outside it counts as reached."""
    runs = []
    for service in metrics.get("Services") or []:
        departure = (service.get("serviceAttributesMetrics") or {}).get("gbtt_ptd")
        if not departure:
            continue
        late = frozenset(
            int(m["tolerance_value"])
            for m in service.get("Metrics") or []
            if int(m.get("num_not_tolerance") or 0) > 0
        )
        runs.append(Run(day, departure, late))
    return runs


def _matching_rid(metrics: Any, departure: str) -> str:
    for service in metrics.get("Services") or []:
        attributes = service.get("serviceAttributesMetrics") or {}
        if attributes.get("gbtt_ptd") == departure and attributes.get("rids"):
            return str(attributes["rids"][0])
    raise ServiceNotFound(f"HSP has no service departing at {departure}")


def _parse_details(details: Any, origin: str, destination: str, departure: str) -> ServiceDelay:
    attributes = details["serviceAttributesDetails"]
    service_date = date.fromisoformat(attributes["date_of_service"])
    stops = {stop["location"]: stop for stop in attributes["locations"]}
    if destination not in stops:
        raise ServiceNotFound(f"HSP service {attributes['rid']} does not call at {destination}")
    stop = stops[destination]
    start = datetime.combine(service_date, datetime.strptime(departure, "%H%M").time())
    scheduled_departure = start.replace(tzinfo=LONDON)
    scheduled_arrival = at_or_after(scheduled_departure, service_date, stop["gbtt_pta"])
    actual = nearest(scheduled_arrival, stop["actual_ta"]) if stop.get("actual_ta") else None
    return ServiceDelay(
        service_id=str(attributes["rid"]),
        operator_code=attributes["toc_code"],
        origin_crs=origin,
        destination_crs=destination,
        scheduled_departure=scheduled_departure,
        scheduled_arrival=scheduled_arrival,
        actual_arrival=actual,
        cancelled=actual is None and bool(stop.get("late_canc_reason")),
        delay_minutes=delay_minutes(scheduled_arrival, actual) if actual else None,
        source=f"hsp:RID:{attributes['rid']}",
    )
