"""Rights Decay: when to act on a right, and when waiting is the better move (build plan R2).

The Arbiter (arbiter.py) answers "is this worth your time, and which way is best?". This adds
time. Every right has clocks (it opens later, or it runs out) and some problems get paid without a
fight (the hazard curve, scaled by the share of closures that pay). The planner works backwards
from the horizon, one day at a time:

    exercise(t) = the best EV of any way of using a right that is open on day t
    wait(t)     = h(t)·R + (1 - h(t))·V(t+1) - c     h: chance it's paid that day; R: value if so
    drop(t)     = R·P(paid by the horizon | still unpaid at t)    stop chasing; it may still come
    V(t)        = max(exercise, wait, drop)

`c` is what an open problem costs the person each day, in their own time: by default 2 minutes
of attention a week at their time value. It is an assumption, shown with every plan and editable.
Without it, waiting is free and the answer is always "wait until the last day".

Pure and deterministic: no I/O and no model. Amounts still come from the Rights Engine; models
only read the documents that set the dates.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from tempo_core.arbiter import DEFAULT_THRESHOLD, ActionOption, expected_value
from tempo_core.clocks import ends_on
from tempo_core.hazard import ZERO, Hazard
from tempo_core.rights_explain import Situation, explain, why
from tempo_core.rules.schema import ClockPack

HORIZON_DAYS = 180
DEFAULT_ATTENTION_MIN_WEEK = Decimal(2)  # (assumption) minutes a week an open problem costs you
WAIT, DROP = "wait", "drop"
TIE = Decimal("1e-9")  # differences below this are rounding, not a reason to change course


class Right(BaseModel):
    """Something the person can do about the problem, with the clocks that gate it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    label: str  # plain words: "Complain to Broadbandly"
    ways: tuple[ActionOption, ...] = Field(min_length=1)  # e.g. Tempo calls, or you complain
    opens_on: date | None = None  # None: open from the start
    expires_on: date | None = None  # None: no deadline; else usable up to and on this day
    unlocked_by: tuple[str, ...] = ()  # events that must have happened, e.g. "complaint_sent"
    clocks: tuple[str, ...] = ()  # the clock packs that set its dates (provenance)
    hard_cliff: bool = True

    def open_on(self, day: date, happened: Collection[str]) -> bool:
        return (
            (self.opens_on is None or self.opens_on <= day)
            and (self.expires_on is None or day <= self.expires_on)
            and all(event in happened for event in self.unlocked_by)
        )


Status = Literal["chosen", "open", "opens_later", "locked", "expired"]


class RightStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    status: Status
    opens_on: date | None
    expires_on: date | None
    unlocked_by: tuple[str, ...]
    ev_gbp: Decimal  # the best way's expected value, today's terms
    best_way: str


class DayPlan(BaseModel):
    model_config = ConfigDict(frozen=True)

    day: date
    best: str  # "wait", "drop" or a right id
    value_gbp: Decimal  # V(t): what the problem is worth to you if handled well from today
    value_at_risk_gbp: Decimal  # V(t) - drop(t): what you lose by giving up on it today
    cost_of_delay_gbp: Decimal  # V(t) - wait(t): what one more day of doing nothing costs


class Assumptions(BaseModel):
    model_config = ConfigDict(frozen=True)

    time_value_gbp_h: Decimal
    attention_minutes_per_week: Decimal
    wait_cost_gbp_day: Decimal
    resolved_value_gbp: Decimal
    hazard_id: str
    hazard_demo_values: bool
    pays_share: Decimal  # the share of closures that pay, applied to the curve
    pays_share_source: str


class Plan(BaseModel):
    model_config = ConfigDict(frozen=True)

    today: date
    horizon: date
    action_today: str  # "wait", "drop" or a right id
    way: str | None  # which way of using the right (an ActionOption id), when acting
    next_decision_on: date | None  # the first day the answer isn't "wait"
    days: tuple[DayPlan, ...]
    rights: tuple[RightStatus, ...]
    explanation: str  # plain words (Flesch >= 60)
    why: tuple[str, ...]  # the numbers behind the answer
    assumptions: Assumptions


def apply_clocks(
    rights: Sequence[Right],
    clocks: Sequence[ClockPack],
    starts: Mapping[str, date],
    holidays: Collection[date] = (),
) -> tuple[Right, ...]:
    """Set each right's dates from the clocks that gate it.

    A started `window` clock sets when the right runs out; a started `wait` clock sets when it
    opens. A `wait` clock that hasn't started (the complaint isn't sent yet) locks its right
    until its trigger happens. A window that hasn't started limits nothing yet.
    """
    by_id = {r.id: r for r in rights}
    for clock in clocks:
        right = by_id.get(clock.right)
        if right is None:
            continue
        start = starts.get(clock.starts_from)
        changes: dict[str, object] = {"clocks": (*right.clocks, clock.id)}
        if start is None and clock.role == "wait":
            changes["unlocked_by"] = tuple(dict.fromkeys((*right.unlocked_by, clock.trigger)))
        elif start is not None and clock.role == "wait":
            opens = ends_on(clock, start, holidays) + timedelta(days=1)
            changes["opens_on"] = max(opens, right.opens_on) if right.opens_on else opens
        elif start is not None:
            ends = ends_on(clock, start, holidays)
            changes["expires_on"] = min(ends, right.expires_on) if right.expires_on else ends
            changes["hard_cliff"] = clock.hard_cliff
        by_id[right.id] = right.model_copy(update=changes)
    return tuple(by_id[r.id] for r in rights)


def wait_cost(time_value_gbp_h: Decimal, attention_minutes_per_week: Decimal) -> Decimal:
    """What one day of an open problem costs, in the person's own time."""
    return time_value_gbp_h * attention_minutes_per_week / Decimal(60) / Decimal(7)


def plan(
    rights: Sequence[Right],
    *,
    hazard: Hazard,
    started_on: date,
    today: date,
    time_value_gbp_h: Decimal,
    resolved_value_gbp: Decimal,
    happened: Collection[str] = frozenset(),
    attention_minutes_per_week: Decimal = DEFAULT_ATTENTION_MIN_WEEK,
    horizon_days: int = HORIZON_DAYS,
) -> Plan:
    """The best thing to do today, and the day on which waiting stops paying."""
    if today < started_on:
        raise ValueError("today can't be before the problem started")
    share, share_source = hazard.pays_share, hazard.pays_share_source
    hazard = hazard.paid()  # a closure that doesn't pay leaves the problem, and the right, open
    cost = wait_cost(time_value_gbp_h, attention_minutes_per_week)
    horizon = today + timedelta(days=horizon_days)
    rows: list[DayPlan] = []
    ways: dict[date, str | None] = {}
    value_next = ZERO
    for offset in range(horizon_days, -1, -1):
        day = today + timedelta(days=offset)
        age, end_age = (day - started_on).days, (horizon - started_on).days + 1
        h = hazard.hazard_on(age)
        wait = h * resolved_value_gbp + (1 - h) * value_next - cost
        drop = resolved_value_gbp * hazard.p_resolves_between(age, end_age)
        # A tie (nothing to gain either way) goes to waiting: Tempo keeps watch for free.
        best, value, way = (DROP, drop, None) if drop > wait + TIE else (WAIT, wait, None)
        exercise = _best_exercise(rights, day, happened, time_value_gbp_h)
        if exercise is not None and exercise[0] >= value:
            value, best, way = exercise[0], exercise[1].id, exercise[2].id
        rows.append(DayPlan(
            day=day, best=best, value_gbp=value,
            value_at_risk_gbp=max(ZERO, value - drop), cost_of_delay_gbp=max(ZERO, value - wait),
        ))  # fmt: skip
        ways[day] = way
        value_next = value
    rows.reverse()
    return _assemble(
        rows, ways, rights, hazard=hazard, started_on=started_on, happened=happened,
        assumptions=Assumptions(
            time_value_gbp_h=time_value_gbp_h,
            attention_minutes_per_week=attention_minutes_per_week, wait_cost_gbp_day=cost,
            resolved_value_gbp=resolved_value_gbp, hazard_id=hazard.id,
            hazard_demo_values=hazard.demo_values, pays_share=share,
            pays_share_source=share_source,
        ),
    )  # fmt: skip


def _best_exercise(
    rights: Sequence[Right], day: date, happened: Collection[str], time_value_gbp_h: Decimal
) -> tuple[Decimal, Right, ActionOption] | None:
    """The best way of using any right open on `day`, if one is worth the Arbiter's threshold."""
    found = [
        (_ev(way, time_value_gbp_h), right, way)
        for right in rights
        if right.open_on(day, happened)
        for way in right.ways
    ]
    found = [f for f in found if f[0] >= DEFAULT_THRESHOLD]
    # Best EV first; ties go to fewer of the person's minutes, then a stable id (as the Arbiter).
    return min(found, key=lambda f: (-f[0], f[2].user_minutes, f[1].id, f[2].id), default=None)


def _ev(way: ActionOption, time_value_gbp_h: Decimal) -> Decimal:
    return expected_value(
        p_success=way.p_success, amount=way.amount_gbp, p_goodwill=way.p_goodwill,
        goodwill=way.goodwill_gbp, user_minutes=way.user_minutes,
        time_value_gbp_h=time_value_gbp_h, compute_gbp=way.compute_gbp,
    )  # fmt: skip


def _statuses(
    rights: Sequence[Right], today: date, happened: Collection[str], chosen: str, tv: Decimal
) -> tuple[RightStatus, ...]:
    statuses = []
    for right in rights:
        best = max(right.ways, key=lambda w: (_ev(w, tv), -w.user_minutes))
        status: Status
        if right.open_on(today, happened):
            status = "chosen" if right.id == chosen else "open"
        elif right.expires_on is not None and right.expires_on < today:
            status = "expired"
        elif not all(event in happened for event in right.unlocked_by):
            status = "locked"
        else:
            status = "opens_later"
        statuses.append(RightStatus(
            id=right.id, label=right.label, status=status, opens_on=right.opens_on,
            expires_on=right.expires_on, unlocked_by=right.unlocked_by, ev_gbp=_ev(best, tv),
            best_way=best.id,
        ))  # fmt: skip
    return tuple(statuses)


def _assemble(
    rows: list[DayPlan],
    ways: Mapping[date, str | None],
    rights: Sequence[Right],
    *,
    hazard: Hazard,
    started_on: date,
    happened: Collection[str],
    assumptions: Assumptions,
) -> Plan:
    first = rows[0]
    decision = next((r for r in rows if r.best != WAIT), None)
    chosen = way = None
    if decision is not None:
        chosen = next((r for r in rights if r.id == decision.best), None)
        if chosen is not None:
            way = next((w for w in chosen.ways if w.id == ways[decision.day]), None)
    statuses = _statuses(rights, first.day, happened, first.best, assumptions.time_value_gbp_h)
    situation = Situation(
        verdict=first.best if first.best in (WAIT, DROP) else "act",
        today=first.day, horizon=rows[-1].day,
        next_decision_on=decision.day if decision else None,
        chosen_label=chosen.label if chosen else None,
        chosen_opens_on=chosen.opens_on if chosen else None,
        chosen_expires_on=chosen.expires_on if chosen else None,
        way_label=way.label if way else None,
        deadlines=tuple(sorted(
            ((r.expires_on, r.label) for r in statuses if r.expires_on and r.status != "expired"),
        )),
        hazard=hazard, started_on=started_on,
        resolved_value_gbp=assumptions.resolved_value_gbp,
        time_value_gbp_h=assumptions.time_value_gbp_h,
        attention_minutes_per_week=assumptions.attention_minutes_per_week,
        pays_share=assumptions.pays_share, pays_share_source=assumptions.pays_share_source,
    )  # fmt: skip
    return Plan(
        today=first.day, horizon=rows[-1].day, action_today=first.best,
        way=ways[first.day], next_decision_on=situation.next_decision_on, days=tuple(rows),
        rights=statuses, explanation=explain(situation), why=why(situation),
        assumptions=assumptions,
    )  # fmt: skip
