"""The facts a model hands to a tool must have been said by the person (plan.md §16).

The brain may understand "London" as London Paddington or "Monday" as a date, and that is its
job. But a station, a time, a fare or a date that appears nowhere in the person's words is
refused here, and the brain asks for it instead. Code, not the model, decides what was said.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from tempo_core.intent import (
    PROVIDERS,
    Slots,
    numbers_in,
    provider_name,
    station_code,
    station_name,
    times_in,
)

LONDON_TERMINALS = frozenset({"PAD", "KGX", "EUS", "WAT", "VIC", "LST", "MYB"})
_RELATIVE = re.compile(
    r"\b(?:today|yesterday|tonight|this (?:morning|afternoon|evening)|last (?:night|week)|"
    r"mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b",
    re.IGNORECASE,
)
MAX_AGE = timedelta(days=366)


def _station(arg: str, words: str, what: str, problems: list[str]) -> str | None:
    code = station_code(arg)
    if code is None:
        problems.append(f"{what}: Tempo doesn't know a station called {arg!r}; ask which station")
        return None
    said = words.casefold()
    if (
        arg.casefold().removeprefix("london ").strip() in said
        or station_name(code).casefold() in said
    ):
        return code
    if code in LONDON_TERMINALS and "london" in said:
        return code  # "London" from Oxford is Paddington: the brain says which it assumed
    problems.append(f"{what}: the person never said {arg!r}; ask them")
    return None


def _day(arg: str, words: str, today: date, what: str, problems: list[str]) -> str | None:
    try:
        when = date.fromisoformat(arg.strip())
    except ValueError:
        problems.append(f"{what}: {arg!r} is not a date; ask which day")
        return None
    if when > today or when < today - MAX_AGE:
        problems.append(
            f"{what}: {when.isoformat()} is in the future or over a year ago; ask which day"
        )
        return None
    if Decimal(when.day) in numbers_in(words) or _RELATIVE.search(words):
        return when.isoformat()
    problems.append(f"{what}: the person never said which day; ask them")
    return None


def train(args: dict[str, str], words: str, today: date) -> tuple[Slots | None, list[str]]:
    """A late train's five facts, each one checked against what the person said."""
    problems: list[str] = []
    origin = _station(args.get("origin_station", ""), words, "origin", problems)
    destination = _station(args.get("destination_station", ""), words, "destination", problems)
    travel_date = _day(args.get("travel_date", ""), words, today, "travel date", problems)
    departure = next(iter(times_in(args.get("departure_time", ""))), None)
    if departure is None or departure not in times_in(words):
        problems.append("departure time: the person never said it; ask what time the train left")
        departure = None
    fare: str | None = None
    try:
        amount = Decimal(args.get("fare_gbp", "").replace("£", "").replace(",", "").strip())
        if amount > 0 and amount in numbers_in(words):
            fare = str(amount.quantize(Decimal("0.01")))
    except InvalidOperation:
        pass
    if fare is None:
        problems.append("fare: the person never said what the ticket cost; ask them")
    if problems:
        return None, problems
    return Slots(origin_crs=origin, destination_crs=destination, travel_date=travel_date,
                 departure=departure, fare_gbp=fare), []  # fmt: skip


def visit(args: dict[str, str], words: str, today: date) -> tuple[Slots | None, list[str]]:
    """A missed engineer visit: a provider Tempo can claim against, and the day, both said."""
    problems: list[str] = []
    provider = provider_name(args.get("provider", ""))
    if provider is None:
        problems.append(
            f"provider: {args.get('provider', '')!r} is not a broadband or phone provider "
            f"Tempo can claim against (it can claim against {', '.join(PROVIDERS)}); "
            "say so kindly"
        )
    elif provider_name(words) != provider:
        problems.append(f"provider: the person never named {provider}; ask who the provider was")
        provider = None
    event_date = _day(args.get("visit_date", ""), words, today, "visit date", problems)
    if problems:
        return None, problems
    return Slots(operator=provider, event_date=event_date), []
