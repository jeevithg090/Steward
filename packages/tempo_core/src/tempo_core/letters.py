"""Read It To Me (SHIPPING §4.8): any official letter becomes a short reading Tempo can say aloud.

Vision reads the letter into facts; this module decides what they mean. Every sentence in
`reading_text` comes from a fact or from a rule (the templates in `tempo_core.letter_words`), so
a model can read the page but cannot put words in Tempo's mouth. A fact read with less than 0.8
confidence is read back as one plain question (`unsure`) instead of being trusted, the same way
`tempo_core.intake` does it.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Callable, Collection, Iterable
from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict

from tempo_core import letter_words as words
from tempo_core.clocks import ends_on
from tempo_core.letter_words import ADDED_NOTHING, DIRECTIONS, ISO_DATE, KINDS, Direction, Kind
from tempo_core.models import Fact
from tempo_core.rules.schema import ClockPack

CONFIDENT = 0.8
NUMBER = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
# Which Rights Decay clock a kind of letter starts (`trigger` in skills/rights-decay/rules).
TRIGGERS: dict[str, str] = {"benefit_decision": "decision_letter"}
# A bill, a reminder or a debt letter is by its nature a demand: when vision read an amount but
# not who owes it, this is the ordinary reading, and the person is asked to confirm it.
DEMANDS = frozenset({"council_tax", "debt_letter", "water_bill"})
# Read-back order: what the letter is matters more than its reference number.
PRIORITY = ("kind", "sender", "amount_gbp", "direction", "due_date", "letter_date", "reference")


class Money(BaseModel):
    model_config = ConfigDict(frozen=True)

    direction: Direction
    amount_gbp: Decimal | None


class Clock(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    expires_on: dt.date


class Unsure(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    question: str


class LetterReading(BaseModel):
    """What the web and the voice agent show and say. The JSON shape is a contract (SHIPPING 1b)."""

    model_config = ConfigDict(frozen=True)

    kind: Kind
    sender: str
    date: dt.date | None
    says: str
    money: Money
    must_do: str
    by: dt.date | None
    clocks: tuple[Clock, ...]
    unsure: tuple[Unsure, ...]
    reading_text: str
    language: Literal["en"] = "en"


def read_letter(
    facts: Iterable[Fact],
    *,
    today: dt.date,
    clocks: Callable[[str], list[ClockPack]],
    holidays: Collection[dt.date] = (),
) -> LetterReading:
    """The reading, built only from the facts and the rules in this package."""
    found = {f.key: f for f in facts}
    kind, sender = _kind(found), _text(found, "sender")
    letter_date, due = _date(found, "letter_date"), _date(found, "due_date")
    money, assumed = _money(found, kind)
    unsure = _unsure(found)
    if assumed:
        asked = words.confirm_direction(money.direction, money.amount_gbp)
        unsure += (Unsure(key="direction", question=asked),)
    says = words.says(kind, money.direction, money.amount_gbp, sender)
    if kind == "benefit_decision":
        must_do, by = words.must_do_benefit(letter_date, holidays)
    else:
        must_do, by = words.must_do_money(
            kind, money.direction, money.amount_gbp, due, sender, today
        )
    questions = [u.question for u in unsure]
    sentences = [*words.opening(kind, sender, letter_date), says, must_do, *questions]
    return LetterReading(
        kind=kind, sender=sender, date=letter_date, says=says, money=money, must_do=must_do,
        by=by, clocks=_clocks(kind, letter_date, clocks, holidays), unsure=unsure,
        reading_text=" ".join(sentences),
    )  # fmt: skip


def reply_draft(reading: LetterReading, said: str) -> str:
    """A formal reply in the person's own words. Tempo adds the frame (who, which letter) and
    nothing else: no fact, date or amount the reading or the person did not give."""
    sender = reading.sender or "Sir or Madam"
    dated = f" dated {words.spoken_date(reading.date)}" if reading.date else ""
    body = words.own_words(said) or "[Say here what you want to tell them.]"
    return (
        "[Your name]\n[Your address]\n\n"
        f"Dear {sender},\n\n"
        f"Thank you for your letter{dated} about {words.ABOUT[reading.kind]}.\n\n"
        f"{body}\n\n"
        "Please reply to me in writing.\n\n"
        "Yours faithfully,\n[Your name]\n\n"
        f"{ADDED_NOTHING}\n"
    )


def foreign_numbers(text: str, *sources: str) -> tuple[str, ...]:
    """Numbers in `text` that none of the `sources` contain: the no-invented-facts check.

    "3 October 2026" and "2026-10-03" agree, and "£1,200.00" is 1200, so a date or an amount
    said in plain words still counts as given."""
    given = set[Decimal]().union(*(_numbers(s) for s in sources))
    return tuple(sorted(str(n) for n in _numbers(text) - given))


def _numbers(text: str) -> set[Decimal]:
    return {Decimal(m.replace(",", "")) for m in NUMBER.findall(text)}


def _kind(found: dict[str, Fact]) -> Kind:
    value = str(found["kind"].value) if "kind" in found else "unknown"
    return value if value in KINDS else "unknown"  # type: ignore[return-value]


def _text(found: dict[str, Fact], key: str) -> str:
    return str(found[key].value).strip() if key in found else ""


def _date(found: dict[str, Fact], key: str) -> dt.date | None:
    value = _text(found, key)
    return dt.date.fromisoformat(value) if ISO_DATE.fullmatch(value) else None


def _amount(found: dict[str, Fact]) -> Decimal | None:
    if "amount_gbp" not in found:
        return None
    try:
        return Decimal(str(found["amount_gbp"].value).replace("£", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def _money(found: dict[str, Fact], kind: Kind) -> tuple[Money, bool]:
    """The money line, and whether the direction was assumed from the kind of letter."""
    amount = _amount(found)
    direction = _text(found, "direction")
    if direction in DIRECTIONS:
        return Money(direction=direction, amount_gbp=amount), False  # type: ignore[arg-type]
    if amount is None:
        return Money(direction="none", amount_gbp=None), False
    if kind in DEMANDS:
        return Money(direction="you_owe", amount_gbp=amount), True
    return Money(direction="none", amount_gbp=amount), True


def _unsure(found: dict[str, Fact]) -> tuple[Unsure, ...]:
    rank = {key: i for i, key in enumerate(PRIORITY)}
    doubtful = sorted(
        (f for f in found.values() if f.confidence < CONFIDENT),
        key=lambda f: (rank.get(f.key, len(PRIORITY)), f.confidence, f.key),
    )
    return tuple(Unsure(key=f.key, question=words.read_back(f)) for f in doubtful)


def _clocks(
    kind: Kind,
    letter_date: dt.date | None,
    clocks: Callable[[str], list[ClockPack]],
    holidays: Collection[dt.date],
) -> tuple[Clock, ...]:
    trigger = TRIGGERS.get(kind)
    if trigger is None or letter_date is None:
        return ()
    return tuple(
        Clock(id=p.id, label=p.summary, expires_on=ends_on(p, letter_date, holidays))
        for p in clocks(trigger)
        if p.starts_from == "letter_date"
    )
