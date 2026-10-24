"""The words Read It To Me uses (SHIPPING §4.8): short spoken sentences, built only from a fact
or a rule written here.

Templates only: what a kind of letter is called, how a fact is read back, what each kind means
you must do. `tempo_core.letters` decides which apply. Every sentence is Flesch-checked in
tests/unit/test_letters.py.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Collection
from decimal import Decimal
from typing import Literal

from tempo_core.deadlines import mandatory_reconsideration
from tempo_core.models import Fact

Kind = Literal["water_bill", "council_tax", "benefit_decision", "debt_letter", "unknown"]
Direction = Literal["owed_to_you", "you_owe", "none"]
KINDS: tuple[str, ...] = ("water_bill", "council_tax", "benefit_decision", "debt_letter", "unknown")
DIRECTIONS: tuple[str, ...] = ("owed_to_you", "you_owe", "none")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")

LABELS = {
    "kind": "what kind of letter this is",
    "sender": "who the letter is from",
    "amount_gbp": "the amount",
    "direction": "who owes the money",
    "due_date": "the date to pay by",
    "letter_date": "the date on the letter",
    "reference": "the reference number",
}
KIND_WORDS = {
    "water_bill": "a water bill",
    "council_tax": "a council tax letter",
    "benefit_decision": "a benefit decision",
    "debt_letter": "a debt letter",
    "unknown": "a letter",
}
DIRECTION_WORDS = {"owed_to_you": "they owe you", "you_owe": "you owe them", "none": "no one"}
ABOUT = {
    "water_bill": "my water bill",
    "council_tax": "my council tax",
    "benefit_decision": "your decision about my benefit",
    "debt_letter": "the debt you say I owe",
    "unknown": "your letter",
}
NO_MONEY = {
    "water_bill": "It is about your water bill. No money is owed either way.",
    "council_tax": "It is about your council tax. No money is owed either way.",
    "benefit_decision": "It is a decision about your benefit.",
    "debt_letter": "It is about a debt, but I could not read how much.",
    "unknown": "I could not tell what it is about.",
}
NOTHING_TO_DO = "There is nothing you need to do."
UNSURE_WHAT_TO_DO = (
    "I could not tell what you need to do. Ask someone you trust to read it with you, "
    "or ring the sender on a number you already know."
)
CHECK_THE_DEBT = (
    "Do not pay from this letter alone. Check the debt is real first. Ring the firm on a "
    "number you already know, or ring a free debt advice line."
)
ASK_AGAIN = "If you think this is wrong, you can ask them to look again."
ADDED_NOTHING = (
    "Note from Tempo: this reply uses only the letter and your own words. "
    "I added no facts, dates or amounts."
)


def spoken_date(day: dt.date) -> str:
    return day.strftime("%-d %B %Y")


def gbp(amount: Decimal | None) -> str:
    return f"£{amount:,.2f}" if amount is not None else "money"


def spoken(fact: Fact) -> str:
    """A fact as Tempo would say it, so a read-back sounds like the reading."""
    value = str(fact.value)
    if fact.key == "kind":
        return KIND_WORDS.get(value, value)
    if fact.key == "direction":
        return DIRECTION_WORDS.get(value, value)
    if fact.key.endswith("_gbp") and isinstance(fact.value, Decimal | int):
        return gbp(Decimal(fact.value))
    if ISO_DATE.fullmatch(value):
        return spoken_date(dt.date.fromisoformat(value))
    return value


def read_back(fact: Fact) -> str:
    label = LABELS.get(fact.key, fact.key.replace("_", " "))
    return f"I read {label} as {spoken(fact)}. Is that right?"


def confirm_direction(direction: str, amount: Decimal | None) -> str:
    asked = "Is that money you owe?" if direction == "you_owe" else "Is that money owed?"
    return f"I read the amount as {gbp(amount)}. {asked}"


def opening(kind: Kind, sender: str, letter_date: dt.date | None) -> list[str]:
    first = f"This is {KIND_WORDS[kind]} from {sender}" if sender else f"This is {KIND_WORDS[kind]}"
    if letter_date is not None:
        first += f", dated {spoken_date(letter_date)}"
    return [first + "."] + ([] if sender else ["I could not read who sent it."])


def says(kind: Kind, direction: str, amount: Decimal | None, sender: str) -> str:
    them = sender or "the sender"
    if direction == "owed_to_you":
        return f"It says you paid too much. {them} owes you {gbp(amount)}. You do not owe anything."
    if direction == "you_owe" and kind == "debt_letter":
        return f"It says you owe {gbp(amount)}. {them} is asking you to pay it."
    if direction == "you_owe":
        return f"It says you owe {them} {gbp(amount)}."
    return NO_MONEY[kind]


def must_do_benefit(
    letter_date: dt.date | None, holidays: Collection[dt.date]
) -> tuple[str, dt.date | None]:
    """DWP must receive a request to look again within one month of the letter's date."""
    if letter_date is None:
        return f"{ASK_AGAIN} You have one month from the date on the letter.", None
    deadline = mandatory_reconsideration(letter_date, holidays)
    return (
        f"{ASK_AGAIN} They must get your request by {spoken_date(deadline.deadline)}, "
        f"so post it by {spoken_date(deadline.post_by)}.",
        deadline.deadline,
    )


def must_do_money(
    kind: Kind,
    direction: str,
    amount: Decimal | None,
    due: dt.date | None,
    sender: str,
    today: dt.date,
) -> tuple[str, dt.date | None]:
    them = sender or "the sender"
    if direction == "owed_to_you":
        return NOTHING_TO_DO, None
    if direction == "none":
        return (UNSURE_WHAT_TO_DO if kind == "unknown" else NOTHING_TO_DO), None
    if kind == "debt_letter":
        when = f" They ask for an answer by {spoken_date(due)}." if due else ""
        return CHECK_THE_DEBT + when, due
    if due is None:
        return f"Pay {gbp(amount)}. The letter does not say by when, so ring {them} to check.", None
    if due < today:
        return (
            f"The date to pay by, {spoken_date(due)}, has passed. Ring {them} on a number you "
            "already know, and ask what to do."
        ), due
    return (
        f"Pay {gbp(amount)} by {spoken_date(due)}. If you cannot pay, ring them before that "
        "date to ask for more time."
    ), due


def own_words(said: str) -> str:
    """The person's words, tidied: one space between words, a capital to start, a stop to end."""
    text = " ".join(said.split())
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    return text if text[-1] in ".!?" else text + "."
