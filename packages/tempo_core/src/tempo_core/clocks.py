"""When a legal or scheme clock ends (Rights Decay, build plan R1).

A clock pack says what starts it and how long it runs; this says on which date it ends, counting
calendar months, weeks, days or working days (no weekends, no gov.uk bank holidays) the way the
rule itself counts.
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import date, timedelta

from tempo_core.deadlines import add_months, working_days_after
from tempo_core.rules.schema import ClockPack


def ends_on(pack: ClockPack, start: date, holidays: Collection[date] = ()) -> date:
    """The last day the clock runs. A window's right can still be used on this day."""
    length = pack.length
    if length.months is not None:
        return add_months(start, length.months)
    if length.working_days is not None:
        return working_days_after(start, length.working_days, holidays)
    days = length.days if length.days is not None else 7 * (length.weeks or 0)
    return start + timedelta(days=days)
