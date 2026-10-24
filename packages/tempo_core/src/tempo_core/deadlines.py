"""Deadline maths for letters (build plan S7.2): calendar months and working days.

A DWP "mandatory reconsideration" must be asked for within one calendar month of the date on
the decision letter. Tempo also gives a "post it by" date two working days earlier (no
weekends or bank holidays), because the deadline is when DWP receives it.
"""

from __future__ import annotations

import calendar
from collections.abc import Collection
from dataclasses import dataclass
from datetime import date, timedelta

POSTING_DAYS = 2  # first class post: allow two working days


def add_months(day: date, months: int = 1) -> date:
    """The same date `months` later, or the month's last day if there is none (31 Jan → 28 Feb)."""
    month_index = day.month - 1 + months
    year, month = day.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def is_working_day(day: date, holidays: Collection[date]) -> bool:
    return day.weekday() < 5 and day not in holidays


def working_days_before(day: date, count: int, holidays: Collection[date]) -> date:
    """The working day `count` working days before `day`."""
    current = day
    while count > 0:
        current -= timedelta(days=1)
        if is_working_day(current, holidays):
            count -= 1
    return current


@dataclass(frozen=True)
class ReconsiderationDeadline:
    decision_date: date
    deadline: date  # DWP must receive the request by this date
    post_by: date  # send it by this date to be safe

    def days_left(self, today: date) -> int:
        return (self.deadline - today).days


def mandatory_reconsideration(
    decision_date: date, holidays: Collection[date]
) -> ReconsiderationDeadline:
    deadline = add_months(decision_date, 1)
    return ReconsiderationDeadline(
        decision_date, deadline, working_days_before(deadline, POSTING_DAYS, holidays)
    )
