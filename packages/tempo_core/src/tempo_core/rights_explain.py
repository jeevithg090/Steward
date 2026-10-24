"""What the Rights Decay planner says, in plain words, and the numbers behind it (build plan R2).

Every sentence here is read to people who may be tired, worried or reading in a second language,
so each one is short and the whole message must score Flesch 60 or more (the plain-language
eval collects these from the real code path).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from tempo_core.hazard import Hazard

PENNY = Decimal("0.01")
SOON_DAYS = 14  # "the next two weeks", when saying waiting won't help any more


@dataclass(frozen=True)
class Situation:
    verdict: str  # "wait", "drop" or "act"
    today: date
    horizon: date
    next_decision_on: date | None
    chosen_label: str | None  # the right Tempo will use when the time comes
    chosen_opens_on: date | None
    chosen_expires_on: date | None
    way_label: str | None  # how: "I call Broadbandly for you"
    deadlines: tuple[tuple[date, str], ...]  # (runs out on, right) for rights not yet expired
    hazard: Hazard
    started_on: date
    resolved_value_gbp: Decimal
    time_value_gbp_h: Decimal
    attention_minutes_per_week: Decimal
    pays_share: Decimal = Decimal(1)  # the share of closures that pay, already in `hazard`
    pays_share_source: str = ""

    def p_paid(self, by: date, start: date | None = None) -> Decimal:
        """P(paid without a fight by `by` | unpaid at `start`, today by default)."""
        begin = (start or self.today) - self.started_on
        return self.hazard.p_resolves_between(begin.days, (by - self.started_on).days)


def explain(s: Situation) -> str:
    if s.verdict == "act":
        return " ".join(_act(s))
    if s.verdict == "wait":
        return " ".join(_wait(s))
    if _fixes_itself(s) and s.resolved_value_gbp > 0:
        return "It isn't worth chasing this. If the money comes on its own, I'll tell you."
    return "There's nothing to claim here yet, and nothing that opens later."


def why(s: Situation) -> tuple[str, ...]:
    """Three numbers a judge (or a worried person) can check: the odds, the cost, the deadline."""
    if _fixes_itself(s):
        soon = s.today + timedelta(days=SOON_DAYS)
        check = soon if s.verdict == "act" else s.next_decision_on or s.horizon
        when = "in the next two weeks" if s.verdict == "act" else f"by {_day(check)}"
        stand_in = ", used as a stand-in" if s.hazard.demo_values else ""
        share = (
            f"; {_pct(s.pays_share)}% of closures pay ({s.pays_share_source})"
            if s.pays_share < 1
            else ""
        )
        odds = (
            f"{_pct(s.p_paid(check))}% of cases like this are paid without a fight {when} "
            f"({s.hazard.source}, {s.hazard.n:,} cases{stand_in}{share})"
        )
    else:
        odds = "This kind of problem doesn't fix itself."
    week = s.time_value_gbp_h * s.attention_minutes_per_week / Decimal(60)
    cost = (
        f"An open problem costs you about {_num(s.attention_minutes_per_week)} minutes a week: "
        f"£{_gbp(week)} at £{_gbp(s.time_value_gbp_h)} an hour. You can change this."
    )
    nearest = next(iter(s.deadlines), None)
    deadline = (
        f"Nearest deadline: {nearest[1]}, until {_day(nearest[0])}."
        if nearest
        else f"No deadline before {_day(s.horizon)}."
    )
    return odds, cost, deadline


def _wait(s: Situation) -> list[str]:
    then = s.next_decision_on
    said = ["I'll wait for now."]
    if then is not None and s.chosen_opens_on is not None and s.chosen_opens_on >= then:
        said.append(f"You can {_lower(s.chosen_label)} from {_day(then)}.")
    if _fixes_itself(s):
        fixed = _pct(s.p_paid(then or s.horizon))
        said.append(f"About {fixed}% of cases like this get paid without a fight by then.")
        said.append(f"If yours does, you get £{_gbp(s.resolved_value_gbp)} and nobody has to call.")
    said.append(f"I'll check again on {_day(then)}." if then else "I'll keep an eye on it.")
    if then is not None and not any(d < then for d, _ in s.deadlines):
        said.append("Nothing you can claim runs out before then.")
    return said


def _act(s: Situation) -> list[str]:
    said = [f"It's time to act: {_lower(s.way_label)}."]
    if _fixes_itself(s):
        soon = _pct(s.p_paid(s.today + timedelta(days=SOON_DAYS)))
        said.append(f"Waiting won't help much now. Only {soon}% of cases like this get paid")
        said[-1] += " without a fight in the next two weeks."
    else:
        said.append("This won't fix itself.")
    if s.chosen_expires_on is not None:
        said.append(f"You can claim until {_day(s.chosen_expires_on)}.")
    return said


def _fixes_itself(s: Situation) -> bool:
    return s.hazard.n > 0 and s.p_paid(s.horizon) > 0


def _lower(text: str | None) -> str:
    text = text or "act"
    return text[0].lower() + text[1:] if not text.startswith("I ") else text


def _pct(p: Decimal) -> int:
    return int((p * 100).quantize(Decimal(1), ROUND_HALF_UP))


def _gbp(value: Decimal) -> Decimal:
    return value.quantize(PENNY, ROUND_HALF_UP)


def _num(value: Decimal) -> str:
    return f"{value.normalize():f}"


def _day(day: date | None) -> str:
    return f"{day:%-d %B}" if day else "later"
