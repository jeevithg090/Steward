"""Rail data port: one train's scheduled and actual arrival, wherever the data came from."""

from __future__ import annotations

from datetime import date
from typing import Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class ServiceDelay(BaseModel):
    model_config = ConfigDict(frozen=True)

    service_id: str  # "gb-nr:L01525:2026-10-23" (RTT) or an HSP RID
    operator_code: str  # "GW"
    origin_crs: str = Field(pattern=r"^[A-Z]{3}$")
    destination_crs: str = Field(pattern=r"^[A-Z]{3}$")
    scheduled_departure: AwareDatetime
    scheduled_arrival: AwareDatetime
    actual_arrival: AwareDatetime | None  # None if cancelled or not reported
    cancelled: bool = False
    delay_minutes: int | None  # None if cancelled or not reported
    source: str  # provenance for the Fact: "hsp:RID:202610238123", "rtt:gb-nr:L01525:2026-10-23"


class RailDataPort(Protocol):
    async def service_delay(
        self, origin_crs: str, destination_crs: str, day: date, scheduled_departure: str
    ) -> ServiceDelay:
        """`scheduled_departure` is the timetabled departure from the origin, "HHMM" or "HH:MM".

        Raises ServiceNotFound when no train matches, RailDataUnavailable when the source fails.
        """
        ...
