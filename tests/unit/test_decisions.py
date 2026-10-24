"""Letter Explainer and Decision Challenger (S7.2): plain words, and no invented facts."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from tempo_adapters.bank_holidays import from_file
from tempo_core.deadlines import mandatory_reconsideration
from tempo_core.decisions import (
    Evidence,
    PipDecision,
    draft_reconsideration,
    explain,
    rate,
    unsupported_claims,
)
from tempo_core.readability import flesch_reading_ease

HOLIDAYS = from_file(
    Path(__file__).resolve().parents[2] / "fixtures" / "govuk" / "bank-holidays.json"
)
DECISION = PipDecision(
    decision_date="14 October 2026",
    daily_living_points=6,
    mobility_points=10,
    reference="PIP-55021",
)
EVIDENCE = [
    Evidence("Preparing food", "I can't stand long enough to cook a meal, so my daughter does it."),
    Evidence("Moving around", "I have to stop and rest after about 20 metres because of pain."),
]


def test_rates_follow_the_points_thresholds() -> None:
    assert [rate(p) for p in (0, 7, 8, 11, 12, 20)] == [
        "no award", "no award", "the standard rate", "the standard rate", "the enhanced rate", "the enhanced rate",
    ]  # fmt: skip


def test_the_explanation_gives_the_deadline_in_plain_words() -> None:
    text = explain(DECISION, mandatory_reconsideration(date(2026, 10, 14), HOLIDAYS))

    assert "6 points for daily living (no award)" in text
    assert "10 points for getting around (the standard rate)" in text
    assert "They must get it by 14 November 2026, so post it by 12 November 2026." in text
    assert flesch_reading_ease(text) >= 60


def test_the_draft_never_adds_facts_that_are_not_in_the_evidence() -> None:
    draft = draft_reconsideration(DECISION, EVIDENCE)

    assert unsupported_claims(draft, DECISION, EVIDENCE) == []
    assert "dated 14 October 2026 (reference PIP-55021)" in draft
    assert "- Moving around: I have to stop and rest after about 20 metres" in draft


def test_a_polished_draft_with_new_facts_is_caught() -> None:
    polished = draft_reconsideration(DECISION, EVIDENCE).replace(
        "Please look",
        "I was in hospital on 3 March for 5 days and Dr Ahmed Khan agrees. I need £500.\\n\\nPlease look",
    )

    assert set(unsupported_claims(polished, DECISION, EVIDENCE)) >= {
        "3 March",
        "5",
        "Dr Ahmed Khan",
        "£500",
    }


def test_a_draft_without_a_reference_still_works() -> None:
    plain = PipDecision(decision_date="2 November 2026", daily_living_points=12, mobility_points=0)

    draft = draft_reconsideration(plain, [])

    assert "dated 2 November 2026.\n" in draft
    assert unsupported_claims(draft, plain, []) == []


def test_a_decision_is_built_from_what_was_read_off_the_letter() -> None:
    from tempo_core.decisions import decision_from_facts
    from tempo_core.models import Fact

    def fact(key: str, value: str, confidence: float = 0.95) -> Fact:
        return Fact(key=key, value=value, source="pip.jpg#vision", confidence=confidence)

    read = [fact("decision_date", "2026-10-14"), fact("daily_living_points", "6"),
            fact("mobility_points", "10"), fact("reference", "PIP-55021")]  # fmt: skip

    decision, ask = decision_from_facts(read)
    blurry, ask_again = decision_from_facts([*read[:2], fact("mobility_points", "1O", 0.5)])

    assert (decision, ask) == (DECISION, [])
    assert (blurry, ask_again) == (None, ["mobility_points"])  # read it back before using it
    assert decision_from_facts(read[:3])[0] == PipDecision("14 October 2026", 6, 10)
