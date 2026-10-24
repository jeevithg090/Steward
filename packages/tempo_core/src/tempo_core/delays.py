"""How late a train was, in whole minutes, correct across midnight and clock changes.

Python subtracts two datetimes that share a tzinfo as if they were naive, so across the night the
clocks change, `actual - scheduled` in Europe/London is out by an hour. Everything here converts
to UTC before subtracting.

HSP reports local "HHMM" wall-clock times plus the date the service started, so a time can belong
to the next day (a 23:40 that arrives at 00:30), and in the repeated hour when the clocks go back
"0120" happens twice. Where it's ambiguous, Tempo takes the reading that gives the smaller delay,
so it never claims for time the person didn't lose.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from tempo_core.rules.schema import DelayRepayPack

LONDON = ZoneInfo("Europe/London")


def delay_minutes(scheduled: datetime, actual: datetime) -> int:
    """Whole minutes late (negative when early). Both times must be timezone-aware."""
    if scheduled.tzinfo is None or actual.tzinfo is None:
        raise ValueError("delay_minutes needs timezone-aware datetimes")
    seconds = (actual.astimezone(UTC) - scheduled.astimezone(UTC)).total_seconds()
    return math.floor(seconds / 60)


def _wall(hhmm: str) -> time:
    if len(hhmm) != 4 or not hhmm.isdigit():
        raise ValueError(f"expected an HHMM time, got {hhmm!r}")
    return time(int(hhmm[:2]), int(hhmm[2:]))


def _readings(day: date, hhmm: str) -> list[datetime]:
    """Every instant "HHMM" can mean on the day before, the day itself and the day after."""
    wall = _wall(hhmm)
    readings = []
    for offset in (-1, 0, 1):
        naive = datetime.combine(day + timedelta(days=offset), wall)
        for fold in (0, 1):  # the two readings differ only in the repeated hour
            instant = naive.replace(tzinfo=LONDON, fold=fold).astimezone(UTC)
            if instant not in readings:
                readings.append(instant)
    return readings


def at_or_after(reference: datetime, day: date, hhmm: str) -> datetime:
    """The first reading of "HHMM" at or after `reference`: a scheduled time later in a service."""
    ref = reference.astimezone(UTC)
    return min(r for r in _readings(day, hhmm) if r >= ref).astimezone(LONDON)


def nearest(reference: datetime, hhmm: str) -> datetime:
    """The reading of "HHMM" closest to `reference`; ties go to the earlier one (smaller delay)."""
    ref = reference.astimezone(UTC)
    day = reference.astimezone(LONDON).date()
    return min(_readings(day, hhmm), key=lambda r: (abs(r - ref), r)).astimezone(LONDON)


def hsp_arrival_delay(
    service_date: date, departure_hhmm: str, scheduled_hhmm: str, actual_hhmm: str
) -> int:
    """Delay at the destination from HSP's local times and the date the service started."""
    start = datetime.combine(service_date, _wall(departure_hhmm)).replace(tzinfo=LONDON)
    scheduled = at_or_after(start, service_date, scheduled_hhmm)
    return delay_minutes(scheduled, nearest(scheduled, actual_hhmm))


def claimable_delay(pack: DelayRepayPack, *, delay: int | None, cancelled: bool) -> int | None:
    """The delay to claim for. A cancelled service counts as the scheme's top band."""
    if cancelled:
        return max(b.min_minutes for b in pack.bands)
    return delay
