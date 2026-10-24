"""Turning what Tempo read into at most one plain question (spec §7.1: ask at most 2 questions).

When several facts are uncertain, Tempo asks about the one that matters most for the claim, in
words a person can answer with "yes" or a correction. It never asks a list of questions.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from tempo_core.models import Fact

CONFIDENT = 0.8

# Most important first: a wrong date or fare changes the claim; a wrong ticket type rarely does.
PRIORITY = (
    "event_date",  # the day the engineer didn't come: it starts every clock
    "travel_date",
    "departure_time",
    "fare_gbp",
    "origin",
    "destination",
    "deadline",
    "amount_gbp",
    "reference",
)

LABELS = {
    "event_date": "the date of the missed visit",
    "operator": "your provider",
    "notice_hours": "the notice they gave",
    "account_ref": "your account number",
    "travel_date": "the date you travelled",
    "departure_time": "the train's departure time",
    "fare_gbp": "the fare",
    "origin": "the station you left from",
    "destination": "the station you were going to",
    "deadline": "the deadline in the letter",
    "amount_gbp": "the amount in the letter",
    "reference": "the reference number",
}


class FollowUp(BaseModel):
    model_config = ConfigDict(frozen=True)

    fact_key: str
    question: str


def follow_up(facts: tuple[Fact, ...], *, threshold: float = CONFIDENT) -> FollowUp | None:
    """The single most important question to ask, or None if Tempo is confident enough."""
    unsure = [f for f in facts if f.confidence < threshold]
    if not unsure:
        return None
    rank = {key: i for i, key in enumerate(PRIORITY)}
    fact = min(unsure, key=lambda f: (rank.get(f.key, len(PRIORITY)), f.confidence, f.key))
    label = LABELS.get(fact.key, fact.key.replace("_", " "))
    return FollowUp(
        fact_key=fact.key,
        question=f"I read {label} as {_spoken(fact)}. Is that right?",
    )


def _spoken(fact: Fact) -> str:
    value = fact.value
    if fact.key.endswith("_gbp") and isinstance(value, Decimal | int):
        return f"£{Decimal(value):.2f}"
    if isinstance(value, str):
        try:
            return date.fromisoformat(value).strftime("%-d %B %Y")
        except ValueError:
            return value
    return str(value)
