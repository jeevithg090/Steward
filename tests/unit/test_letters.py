"""Read It To Me (track 1b): a letter's facts become a plain reading that invents nothing."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tempo_adapters.bank_holidays import from_file
from tempo_adapters.vision import to_facts
from tempo_core.deadlines import mandatory_reconsideration
from tempo_core.letter_words import ADDED_NOTHING, DIRECTIONS, KINDS, NOTHING_TO_DO
from tempo_core.letters import LetterReading, foreign_numbers, read_letter, reply_draft
from tempo_core.models import Fact
from tempo_core.readability import flesch_reading_ease
from tempo_core.rules import RulePackRegistry
from tempo_ports.vision import DocumentKind

ROOT = Path(__file__).resolve().parents[2]
VISION, LETTERS = ROOT / "fixtures" / "vision", ROOT / "fixtures" / "letters"
REGISTRY = RulePackRegistry.from_directory(ROOT / "skills")
HOLIDAYS = from_file(ROOT / "fixtures" / "govuk" / "bank-holidays.json")
TODAY = date(2026, 10, 25)
FIXTURES = {
    "water_overpayment": "thames_water_overpayment.png",
    "council_tax_reminder": "council_tax_reminder.png",
}
SHAPE = {
    "kind", "sender", "date", "says", "money", "must_do", "by", "clocks", "unsure",
    "reading_text", "language",
}  # fmt: skip


def fact(key: str, value: str | int | Decimal, confidence: float = 0.9) -> Fact:
    return Fact(key=key, value=value, source="letter.png#vision", confidence=confidence)


def read(facts: tuple[Fact, ...] | list[Fact], today: date = TODAY) -> LetterReading:
    return read_letter(facts, today=today, clocks=REGISTRY.clocks, holidays=HOLIDAYS)


def recorded(name: str) -> tuple[Fact, ...]:
    """The facts ReplayVision gives for the fixture photo, through the adapter's conversion."""
    image = (VISION / FIXTURES[name]).read_bytes()
    answer = json.loads((VISION / f"{hashlib.sha256(image).hexdigest()}.json").read_text())
    return to_facts(answer, kind=DocumentKind.OFFICIAL_LETTER, source=f"{FIXTURES[name]}#vision")


def golden(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((LETTERS / f"{name}.reading.json").read_text())
    return data


def given_to_tempo(facts: tuple[Fact, ...] | list[Fact]) -> list[str]:
    """Everything the reading may quote: the facts, and the dates the deadline rule derives."""
    found = {f.key: str(f.value) for f in facts}
    sources = list(found.values())
    letter_date = found.get("letter_date", "")
    if found.get("kind") == "benefit_decision" and len(letter_date) == 10:
        deadline = mandatory_reconsideration(date.fromisoformat(letter_date), HOLIDAYS)
        sources += [deadline.deadline.isoformat(), deadline.post_by.isoformat()]
    return sources


BENEFIT = [fact("sender", "DWP"), fact("kind", "benefit_decision"), fact("letter_date", "2026-11-28"),
           fact("reference", "PIP-55021")]  # fmt: skip
DEBT = [fact("sender", "Quick Refund Services"), fact("kind", "debt_letter"), fact("letter_date", "2026-10-01"),
        fact("amount_gbp", Decimal("640")), fact("direction", "you_owe"), fact("due_date", "2026-10-31")]  # fmt: skip
PASSED = [fact("sender", "Oxford City Council"), fact("kind", "council_tax"), fact("amount_gbp", Decimal("112")),
          fact("direction", "you_owe"), fact("due_date", "2026-10-10")]  # fmt: skip


def plain_messages() -> dict[str, str]:
    """What Read It To Me says, from the real code paths. Flesch 60 or more, like the eval in
    test_plain_language.py (these live here so the two tracks don't edit the same file)."""
    council = read(recorded("council_tax_reminder"))
    return {
        "water_overpayment": read(recorded("water_overpayment")).reading_text,
        "council_tax_reminder": council.reading_text,
        "benefit_decision": read(BENEFIT).reading_text,
        "debt_letter": read(DEBT).reading_text,
        "unknown": read([]).reading_text,
        "due_date_passed": read(PASSED, today=date(2026, 10, 25)).reading_text,
        "reply": reply_draft(council, "I paid this on the 2nd by card."),
        "reply_note": ADDED_NOTHING,
    }


@pytest.mark.parametrize(("name", "text"), list(plain_messages().items()))
def test_read_it_to_me_speaks_plainly(name: str, text: str) -> None:
    score = flesch_reading_ease(text)

    assert score >= 60, f"{name} reads at {score:.0f}: {text}"


@pytest.mark.parametrize("name", list(FIXTURES))
def test_the_fixture_photos_read_as_the_golden_files_say(name: str) -> None:
    reading = read(recorded(name))

    assert reading.model_dump(mode="json") == golden(name)
    assert flesch_reading_ease(reading.reading_text) >= 60
    assert set(golden(name)) == SHAPE


def test_the_json_shape_is_the_web_contract() -> None:
    reading = read(recorded("council_tax_reminder")).model_dump(mode="json")

    assert set(reading) == SHAPE
    assert reading["money"] == {"direction": "you_owe", "amount_gbp": "112.00"}
    assert reading["date"] == "2026-10-20" and reading["by"] == "2026-11-10"
    assert reading["unsure"] == [
        {
            "key": "due_date",
            "question": "I read the date to pay by as 10 November 2026. Is that right?",
        }
    ]
    assert reading["language"] == "en" and reading["clocks"] == []
    assert LetterReading.model_validate(reading) == read(recorded("council_tax_reminder"))


def test_an_overpayment_means_nothing_to_do() -> None:
    reading = read(recorded("water_overpayment"))

    assert (reading.kind, reading.sender, reading.date) == (
        "water_bill",
        "Thames Water",
        date(2026, 10, 3),
    )
    assert reading.money.direction == "owed_to_you" and reading.money.amount_gbp == Decimal("23.40")
    assert reading.must_do == NOTHING_TO_DO and reading.by is None
    assert reading.unsure == () and reading.clocks == ()
    assert reading.reading_text == (
        "This is a water bill from Thames Water, dated 3 October 2026. It says you paid too much. "
        "Thames Water owes you £23.40. You do not owe anything. There is nothing you need to do."
    )


def test_a_reminder_says_pay_by_the_date_and_reads_back_what_it_is_unsure_of() -> None:
    reading = read(recorded("council_tax_reminder"))

    assert reading.must_do == (
        "Pay £112.00 by 10 November 2026. If you cannot pay, ring them before that date to ask for more time."
    )
    assert [u.key for u in reading.unsure] == ["due_date"]
    assert reading.reading_text.endswith(
        "I read the date to pay by as 10 November 2026. Is that right?"
    )


def test_a_benefit_decision_starts_the_reconsideration_clock() -> None:
    reading = read(BENEFIT)

    assert reading.kind == "benefit_decision" and reading.money.direction == "none"
    assert reading.by == date(2026, 12, 28)  # one calendar month, as tempo_core.deadlines says
    assert (
        "They must get your request by 28 December 2026, so post it by 23 December 2026."
        in reading.must_do
    )
    [clock] = reading.clocks
    assert (clock.id, clock.expires_on) == ("dwp.pip.mandatory-reconsideration", date(2026, 12, 28))
    assert clock.label == REGISTRY.by_id(clock.id).summary  # the rule's own plain words


def test_a_benefit_decision_with_no_readable_date_still_says_the_rule() -> None:
    reading = read(
        [
            fact("sender", "DWP"),
            fact("kind", "benefit_decision"),
            fact("letter_date", "Nov 28th", 0.5),
        ]
    )

    assert reading.by is None and reading.clocks == ()
    assert "You have one month from the date on the letter." in reading.must_do
    assert reading.unsure[0].question == "I read the date on the letter as Nov 28th. Is that right?"


def test_a_debt_letter_says_check_before_paying() -> None:
    reading = read(DEBT)

    assert reading.says == "It says you owe £640.00. Quick Refund Services is asking you to pay it."
    assert reading.must_do.startswith(
        "Do not pay from this letter alone. Check the debt is real first."
    )
    assert reading.must_do.endswith("They ask for an answer by 31 October 2026.")
    assert reading.by == date(2026, 10, 31)


def test_a_letter_it_cannot_place_asks_for_help() -> None:
    nothing = read([])
    odd = read([fact("sender", "Acme Parking"), fact("kind", "parking_fine", 0.95)])

    assert nothing.kind == "unknown" and nothing.sender == ""
    assert nothing.reading_text.startswith("This is a letter. I could not read who sent it.")
    assert "Ask someone you trust to read it with you" in nothing.must_do
    assert odd.kind == "unknown" and odd.reading_text.startswith(
        "This is a letter from Acme Parking."
    )


def test_a_due_date_that_has_passed_is_said_so() -> None:
    facts = [fact("sender", "Oxford City Council"), fact("kind", "council_tax"), fact("amount_gbp", Decimal("112")),
             fact("direction", "you_owe"), fact("due_date", "2026-10-10")]  # fmt: skip

    reading = read(facts, today=date(2026, 10, 25))

    assert reading.must_do.startswith("The date to pay by, 10 October 2026, has passed.")
    assert read(facts, today=date(2026, 10, 9)).must_do.startswith(
        "Pay £112.00 by 10 October 2026."
    )


def test_a_bill_with_no_due_date_says_to_check() -> None:
    reading = read([fact("sender", "Severn Trent"), fact("kind", "water_bill"), fact("amount_gbp", Decimal("48.10")),
                    fact("direction", "you_owe")])  # fmt: skip

    assert (
        reading.must_do
        == "Pay £48.10. The letter does not say by when, so ring Severn Trent to check."
    )


def test_an_assumed_direction_is_read_back_not_trusted() -> None:
    bill = read(
        [
            fact("sender", "Severn Trent"),
            fact("kind", "water_bill"),
            fact("amount_gbp", Decimal("48.10")),
        ]
    )
    decision = read(
        [
            fact("sender", "DWP"),
            fact("kind", "benefit_decision"),
            fact("amount_gbp", Decimal("48.10")),
        ]
    )

    assert bill.money.direction == "you_owe"
    assert [u.model_dump() for u in bill.unsure] == [
        {"key": "direction", "question": "I read the amount as £48.10. Is that money you owe?"},
    ]
    assert decision.money.direction == "none" and decision.unsure[0].question.endswith(
        "Is that money owed?"
    )


def test_each_unsure_fact_becomes_one_plain_question_most_important_first() -> None:
    reading = read([fact("reference", "CT-1", 0.3), fact("sender", "Thames Water", 0.7), fact("kind", "water_bill", 0.6),
                    fact("amount_gbp", Decimal("23.40"), 0.79), fact("direction", "owed_to_you", 0.5)])  # fmt: skip

    assert [u.key for u in reading.unsure] == [
        "kind",
        "sender",
        "amount_gbp",
        "direction",
        "reference",
    ]
    assert [u.question for u in reading.unsure][:4] == [
        "I read what kind of letter this is as a water bill. Is that right?",
        "I read who the letter is from as Thames Water. Is that right?",
        "I read the amount as £23.40. Is that right?",
        "I read who owes the money as they owe you. Is that right?",
    ]
    assert all(q.count("?") == 1 for q in (u.question for u in reading.unsure))


def test_an_amount_that_will_not_convert_is_not_money() -> None:
    reading = read(
        [
            fact("sender", "Thames Water"),
            fact("kind", "water_bill"),
            fact("amount_gbp", "twenty", 0.5),
        ]
    )

    assert reading.money.amount_gbp is None and reading.money.direction == "none"
    assert reading.unsure[0].question == "I read the amount as twenty. Is that right?"


def test_foreign_numbers_understands_dates_and_amounts() -> None:
    assert foreign_numbers("Pay £1,200.00 by 3 October 2026.", "1200", "2026-10-03") == ()
    assert foreign_numbers("Pay £1,200.00 by 3 October 2026.", "2026-10-03") == ("1200.00",)
    assert foreign_numbers("No digits here") == ()


CONFIDENCE = st.floats(min_value=0.0, max_value=1.0)
DATES = st.dates(min_value=date(2025, 1, 1), max_value=date(2027, 12, 31)).map(date.isoformat)
AMOUNTS = st.decimals(min_value=Decimal("0.01"), max_value=Decimal("99999.99"), places=2)
SENDERS = st.sampled_from(
    ["Thames Water", "Oxford City Council", "DWP", "Quick Refund Services", "Lowell", "HMRC"]
)


def maybe(key: str, values: st.SearchStrategy[Any]) -> st.SearchStrategy[Fact | None]:
    return st.one_of(st.none(), st.builds(lambda v, c: fact(key, v, c), values, CONFIDENCE))


@st.composite
def letter_facts(draw: st.DrawFn) -> tuple[Fact, ...]:
    parts = [
        draw(maybe("sender", SENDERS)),
        draw(maybe("kind", st.sampled_from([*KINDS, "parking_fine"]))),
        draw(maybe("letter_date", DATES)),
        draw(maybe("amount_gbp", AMOUNTS)),
        draw(maybe("direction", st.sampled_from([*DIRECTIONS, "sideways"]))),
        draw(maybe("due_date", DATES)),
        draw(maybe("reference", st.from_regex(r"[A-Z]{2}-[0-9]{5,8}", fullmatch=True))),
    ]
    return tuple(p for p in parts if p is not None)


@settings(max_examples=300)
@given(facts=letter_facts(), today=st.dates(min_value=date(2025, 1, 1), max_value=date(2028, 1, 1)))
def test_the_reading_never_invents_a_number_and_is_always_plain(
    facts: tuple[Fact, ...], today: date
) -> None:
    reading = read(facts, today=today)

    assert foreign_numbers(reading.reading_text, *given_to_tempo(facts)) == ()
    assert foreign_numbers(reading.says + " " + reading.must_do, *given_to_tempo(facts)) == ()
    assert flesch_reading_ease(reading.reading_text) >= 60, reading.reading_text
    assert len(reading.unsure) == sum(f.confidence < 0.8 for f in facts) + (
        reading.money.amount_gbp is not None
        and not any(f.key == "direction" and str(f.value) in DIRECTIONS for f in facts)
    )
    assert reading.kind in KINDS and reading.money.direction in DIRECTIONS


def test_the_reply_uses_only_the_letter_and_the_persons_words() -> None:
    reading = read(recorded("council_tax_reminder"))

    draft = reply_draft(reading, "  i already paid this on the 2nd of october   by card")

    assert "Dear Oxford City Council," in draft
    assert "Thank you for your letter dated 20 October 2026 about my council tax." in draft
    assert "\nI already paid this on the 2nd of october by card.\n" in draft
    assert draft.rstrip().endswith(ADDED_NOTHING)
    assert foreign_numbers(draft, reading.model_dump_json(), "2nd of october") == ()


def test_the_reply_copes_with_an_unknown_sender_and_nothing_said() -> None:
    draft = reply_draft(read([]), "   ")

    assert "Dear Sir or Madam," in draft and "about your letter." in draft
    assert "[Say here what you want to tell them.]" in draft


@given(facts=letter_facts(), said=st.text(max_size=200))
def test_the_reply_never_adds_a_number(facts: tuple[Fact, ...], said: str) -> None:
    reading = read(facts)

    draft = reply_draft(reading, said)

    assert foreign_numbers(draft, reading.model_dump_json(), said) == ()
    assert draft.rstrip().endswith(ADDED_NOTHING)
