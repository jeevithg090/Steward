"""A live reading's implausible dates are read back, not trusted (plan.md §13: a real model read the
engineer's card's 2026-10-19 as 2020-10-19 at confidence 0.9)."""

from __future__ import annotations

from datetime import date

from tempo_adapters.vision import UNPARSED_CONFIDENCE, plausible, to_facts
from tempo_core.intake import follow_up
from tempo_ports.vision import DocumentKind

TODAY = date(2026, 10, 25)


def card(event_date: str) -> dict[str, object]:
    return {"facts": [
        {"key": "operator", "value": "Broadbandly", "confidence": 1.0},
        {"key": "event_date", "value": event_date, "confidence": 0.9},
    ]}  # fmt: skip


def test_a_misread_year_is_read_back() -> None:
    facts = to_facts(
        card("2020-10-19"), kind=DocumentKind.MISSED_VISIT, source="c#vision", today=TODAY
    )
    date_fact = next(f for f in facts if f.key == "event_date")
    assert date_fact.confidence == UNPARSED_CONFIDENCE
    question = follow_up(facts)
    assert question is not None and question.fact_key == "event_date"
    assert "2020" in question.question


def test_a_plausible_date_is_trusted() -> None:
    facts = to_facts(
        card("2026-10-19"), kind=DocumentKind.MISSED_VISIT, source="c#vision", today=TODAY
    )
    assert follow_up(facts) is None


def test_recordings_are_not_checked_against_today() -> None:
    facts = to_facts(card("2020-10-19"), kind=DocumentKind.MISSED_VISIT, source="c#vision")
    assert next(f for f in facts if f.key == "event_date").confidence == 0.9


def test_the_ranges() -> None:
    assert plausible("event_date", "2026-01-01", TODAY)
    assert not plausible("event_date", "2026-11-30", TODAY)  # a visit that hasn't happened
    assert not plausible("travel_date", "2024-10-23", TODAY)
    assert plausible("due_date", "2027-03-01", TODAY)
    assert not plausible("due_date", "2031-01-01", TODAY)
    assert plausible("operator", "2020-10-19", TODAY)  # not a date key
