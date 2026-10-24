"""Deadline maths (S7.2): calendar months, working days and gov.uk bank holidays."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from tempo_adapters.bank_holidays import from_file
from tempo_core.deadlines import (
    add_months,
    is_working_day,
    mandatory_reconsideration,
    working_days_before,
)

HOLIDAYS = from_file(
    Path(__file__).resolve().parents[2] / "fixtures" / "govuk" / "bank-holidays.json"
)


@pytest.mark.parametrize(
    ("start", "expected"),
    [
        (date(2026, 10, 14), date(2026, 11, 14)),
        (date(2027, 1, 31), date(2027, 2, 28)),  # no 31 February: the month's last day
        (date(2028, 1, 31), date(2028, 2, 29)),  # a leap year
        (date(2026, 12, 15), date(2027, 1, 15)),  # into the next year
    ],
)
def test_one_calendar_month(start: date, expected: date) -> None:
    assert add_months(start) == expected


def test_post_by_skips_weekends() -> None:
    mr = mandatory_reconsideration(date(2026, 10, 14), HOLIDAYS)

    assert mr.deadline == date(2026, 11, 14)  # a Saturday: DWP must have it by then
    assert mr.post_by == date(2026, 11, 12)  # Thursday: two working days of post
    assert mr.days_left(date(2026, 10, 24)) == 21


def test_post_by_skips_bank_holidays_from_gov_uk() -> None:
    mr = mandatory_reconsideration(date(2026, 11, 28), HOLIDAYS)

    assert mr.deadline == date(2026, 12, 28)  # the Boxing Day substitute holiday
    assert date(2026, 12, 25) in HOLIDAYS and date(2026, 12, 28) in HOLIDAYS
    assert mr.post_by == date(2026, 12, 23)  # skips Christmas Day and the weekend


def test_working_days() -> None:
    assert not is_working_day(date(2026, 12, 25), HOLIDAYS)
    assert is_working_day(date(2026, 12, 24), HOLIDAYS)
    assert working_days_before(date(2026, 4, 7), 2, HOLIDAYS) == date(2026, 4, 1)  # Easter
    assert working_days_before(date(2026, 4, 7), 0, HOLIDAYS) == date(2026, 4, 7)
