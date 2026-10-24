"""Entitlement Check (S7.1): ten personas against expected flags; screening, not a decision."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tempo_core.entitlement import (
    DISCLAIMER,
    QUESTIONS,
    Answers,
    Figures,
    pack,
    screen,
    tariff_income,
)
from tempo_core.readability import flesch_reading_ease

FIGURES = Figures.from_file(
    Path(__file__).resolve().parents[2] / "skills" / "entitlement-check" / "figures.yaml"
)
PC, AA, ST = "Pension Credit", "Attendance Allowance", "Cheaper broadband or phone (social tariff)"


def person(**fields: Any) -> Answers:
    return Answers(**({"age": 75, "weekly_income_gbp": Decimal(300)} | fields))


PERSONAS = [
    ("margaret", person(age=78, weekly_income_gbp=Decimal(190), savings_gbp=Decimal(4000), needs_care_day=True, care_months=12),
     {PC: ("likely", "37.10"), AA: ("likely", "73.90"), ST: ("worth_checking", None)}),
    ("couple_on_state_pension", person(age=70, couple=True, weekly_income_gbp=Decimal(320), savings_gbp=Decimal(2000)),
     {PC: ("likely", "26.60"), AA: ("unlikely", None), ST: ("worth_checking", None)}),
    ("comfortable", person(age=72, weekly_income_gbp=Decimal(400), savings_gbp=Decimal(50000)),
     {PC: ("unlikely", None), AA: ("unlikely", None), ST: ("unlikely", None)}),
    ("just_over_the_line", person(age=67, weekly_income_gbp=Decimal(240)),
     {PC: ("worth_checking", None), AA: ("unlikely", None), ST: ("worth_checking", None)}),
    ("savings_tip_it_over", person(weekly_income_gbp=Decimal(200), savings_gbp=Decimal(25000)),
     {PC: ("worth_checking", None), AA: ("unlikely", None), ST: ("worth_checking", None)}),
    ("help_day_and_night", person(age=82, weekly_income_gbp=Decimal(260), needs_care_day=True, needs_care_night=True, care_months=9),
     {PC: ("unlikely", None), AA: ("likely", "110.40"), ST: ("unlikely", None)}),
    ("help_just_started", person(age=80, needs_care_day=True, care_months=3),
     {PC: ("unlikely", None), AA: ("worth_checking", None), ST: ("unlikely", None)}),
    ("terminally_ill", person(age=68, terminally_ill=True),
     {PC: ("unlikely", None), AA: ("likely", "110.40"), ST: ("unlikely", None)}),
    ("working_age_on_universal_credit", person(age=45, weekly_income_gbp=Decimal(150), benefits=frozenset({"universal_credit"})),
     {PC: ("unlikely", None), AA: ("unlikely", None), ST: ("likely", None)}),
    ("no_broadband", person(age=79, weekly_income_gbp=Decimal(150), has_broadband_or_phone=False),
     {PC: ("likely", "77.10"), AA: ("unlikely", None)}),
]  # fmt: skip


@pytest.mark.parametrize(("name", "answers", "expected"), PERSONAS, ids=[p[0] for p in PERSONAS])
def test_personas_get_the_expected_flags(
    name: str, answers: Answers, expected: dict[str, tuple[str, str | None]]
) -> None:
    flags = {
        f.benefit: (f.likelihood, None if f.weekly_gbp is None else f"{f.weekly_gbp:.2f}")
        for f in screen(answers, FIGURES)
    }

    assert flags == expected


def test_every_flag_signposts_the_official_checker() -> None:
    for _, answers, _ in PERSONAS:
        for flag in screen(answers, FIGURES):
            assert flag.signpost.startswith(("https://www.gov.uk/", "https://www.ofcom.org.uk/"))
            assert flesch_reading_ease(flag.why) >= 60, flag.why


def test_the_pack_is_screening_not_a_decision() -> None:
    margaret = PERSONAS[0][1]

    text = pack(margaret, screen(margaret, FIGURES), FIGURES)

    assert DISCLAIMER in text and "not a decision" in DISCLAIMER
    assert "- How old are you? 78" in text and "- Do you live with a partner? No" in text
    assert "- Do you get any benefits now? For example Universal Credit or PIP. None" in text
    assert "Pension Credit: likely (about £37.10 a week)" in text
    assert "haven't been checked against this year's rates" in text  # figures are demo values
    assert len(QUESTIONS) == 10
    assert flesch_reading_ease(DISCLAIMER) >= 60


def test_benefits_are_listed_in_the_pack() -> None:
    on_uc = PERSONAS[8][1]

    assert "For example Universal Credit or PIP. universal credit" in pack(
        on_uc, screen(on_uc, FIGURES), FIGURES
    )


def test_tariff_income_counts_each_part_of_500() -> None:
    pc = FIGURES.pension_credit

    assert [tariff_income(Decimal(s), pc) for s in (10000, 10001, 10500, 10501, 0)] == [
        0,
        1,
        1,
        2,
        0,
    ]


def test_verified_figures_drop_the_note() -> None:
    verified = FIGURES.model_copy(update={"demo_values": False})
    margaret = PERSONAS[0][1]

    assert "haven't been checked" not in pack(margaret, screen(margaret, verified), verified)
