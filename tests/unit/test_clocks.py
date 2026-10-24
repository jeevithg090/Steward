"""Clock packs (Rights Decay R1): legal and scheme clocks as data, and when each one ends."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from tempo_adapters.bank_holidays import from_file
from tempo_core.clocks import ends_on
from tempo_core.readability import flesch_reading_ease
from tempo_core.rules import ClockPack, RulePackRegistry, parse_pack

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"
HOLIDAYS = from_file(ROOT / "fixtures" / "govuk" / "bank-holidays.json")


def clock(**overrides: Any) -> ClockPack:
    data: dict[str, Any] = {
        "kind": "clock",
        "id": "test.clock",
        "version": "1.0.0",
        "operator": "Test",
        "citation_url": "https://example.org/clock",
        "demo_values": True,
        "trigger": "journey",
        "starts_from": "event_date",
        "length": {"days": 28},
        "role": "window",
        "right": "test.claim",
        "summary": "You have 28 days to claim.",
    }
    pack = parse_pack(data | overrides)
    assert isinstance(pack, ClockPack)
    return pack


@pytest.mark.parametrize(
    "length",
    [{}, {"days": 28, "weeks": 4}, {"months": 1, "working_days": 10}, {"days": 0}],
    ids=["none", "days-and-weeks", "months-and-working-days", "zero"],
)
def test_a_clock_length_has_exactly_one_positive_unit(length: dict[str, int]) -> None:
    with pytest.raises(ValidationError):
        clock(length=length)


def test_a_window_is_a_cliff_unless_it_says_otherwise() -> None:
    assert clock().hard_cliff is True
    assert clock(hard_cliff=False).hard_cliff is False
    assert clock(role="wait").hard_cliff is False


def test_a_wait_clock_cannot_be_a_cliff() -> None:
    with pytest.raises(ValidationError, match="wait clock has no cliff"):
        clock(role="wait", hard_cliff=True)


def test_clocks_keep_the_honesty_rule() -> None:
    with pytest.raises(ValidationError, match="last_verified"):
        clock(demo_values=False)
    assert clock(demo_values=False, last_verified=date(2026, 10, 24)).demo_values is False


@pytest.mark.parametrize(
    ("length", "start", "end"),
    [
        ({"days": 28}, date(2026, 10, 23), date(2026, 11, 20)),
        ({"weeks": 8}, date(2026, 10, 24), date(2026, 12, 19)),
        ({"months": 1}, date(2027, 1, 31), date(2027, 2, 28)),  # no 31 February
        ({"months": 6}, date(2026, 10, 24), date(2027, 4, 24)),
        # 10 working days over Christmas: skips the weekends, 25 and 28 Dec (the Boxing Day
        # substitute) and 1 Jan.
        ({"working_days": 10}, date(2026, 12, 18), date(2027, 1, 6)),
    ],
)
def test_when_a_clock_ends(length: dict[str, int], start: date, end: date) -> None:
    assert ends_on(clock(length=length), start, HOLIDAYS) == end


def test_working_days_need_the_holidays_to_be_right() -> None:
    pack = clock(length={"working_days": 10})

    assert ends_on(pack, date(2026, 12, 18)) == date(2027, 1, 1)  # wrong without bank holidays
    assert ends_on(pack, date(2026, 12, 18), HOLIDAYS) == date(2027, 1, 6)


def test_the_registry_finds_the_clocks_an_event_starts() -> None:
    registry = RulePackRegistry.from_directory(SKILLS)

    [payment] = registry.clocks("missed_appointment")
    assert payment.id == "ofcom.auto-comp.payment-window"
    assert payment.role == "wait" and payment.right == "ofcom.complaint"
    assert [c.id for c in registry.clocks("complaint_sent")] == [
        "fca.complaint.eight-weeks",
        "telecoms.complaint.eight-weeks",
    ]
    assert registry.clocks("nothing happened") == []


def test_every_installed_clock_is_cited_labelled_and_plain() -> None:
    clocks = [p for p in RulePackRegistry.from_directory(SKILLS) if isinstance(p, ClockPack)]

    assert len(clocks) >= 8
    for pack in clocks:
        assert pack.citation_url.startswith("https://")
        assert pack.demo_values, f"{pack.id}: say when a person checked it (last_verified)"
        assert flesch_reading_ease(pack.summary) >= 60, pack.summary
