"""A clock the demo can move forward (TEMPO_DEMO=1 only), so a 31-day wait fits in a minute.

Everything that tells time in the Gateway reads this one clock: missions, timers, the simulated
company and passkey challenges. While it is moved, /health says so and the honesty badge shows it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta


class DemoClock:
    def __init__(self) -> None:
        self.offset = timedelta(0)

    def __call__(self) -> datetime:
        return datetime.now(tz=UTC) + self.offset

    def advance(self, days: int) -> datetime:
        if days < 0:
            raise ValueError("the demo clock only moves forward: timers have already fired")
        self.offset += timedelta(days=days)
        return self()

    @property
    def offset_days(self) -> int:
        return self.offset.days
