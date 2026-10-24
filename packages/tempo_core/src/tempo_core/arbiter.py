"""The Arbiter: is this worth the person's time, and which way of doing it is best? (spec §12.2)

    EV(a) = P_success·V + P_goodwill·G - (m_user / 60)·v_user - c_compute

Time comes first: on a tie, the option that asks for fewer of the person's minutes wins.
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

from pydantic import BaseModel, ConfigDict, Field

PENNY = Decimal("0.01")
DEFAULT_THRESHOLD = Decimal("0.50")


class ActionOption(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    label: str  # plain words, e.g. "Claim online for you"
    p_success: Decimal = Field(ge=0, le=1)
    amount_gbp: Decimal = Field(ge=0)
    p_goodwill: Decimal = Field(default=Decimal(0), ge=0, le=1)
    goodwill_gbp: Decimal = Field(default=Decimal(0), ge=0)
    user_minutes: Decimal = Field(ge=0)
    compute_gbp: Decimal = Field(ge=0)


class ScoredOption(BaseModel):
    model_config = ConfigDict(frozen=True)

    option: ActionOption
    ev_gbp: Decimal


class Decision(BaseModel):
    model_config = ConfigDict(frozen=True)

    chosen: ActionOption | None  # None when Tempo declines
    ev_gbp: Decimal | None
    explanation: str
    ranked: tuple[ScoredOption, ...]  # best first

    @property
    def declined(self) -> bool:
        return self.chosen is None


def expected_value(
    *,
    p_success: Decimal,
    amount: Decimal,
    p_goodwill: Decimal,
    goodwill: Decimal,
    user_minutes: Decimal,
    time_value_gbp_h: Decimal,
    compute_gbp: Decimal,
) -> Decimal:
    return (
        p_success * amount
        + p_goodwill * goodwill
        - (user_minutes / Decimal(60)) * time_value_gbp_h
        - compute_gbp
    )


def choose_action(
    options: Iterable[ActionOption],
    *,
    time_value_gbp_h: Decimal,
    threshold: Decimal = DEFAULT_THRESHOLD,
) -> Decision:
    """Pick the option with the best expected value, or decline (and say why) below `threshold`."""
    ranked = tuple(
        sorted(
            (ScoredOption(option=o, ev_gbp=_ev(o, time_value_gbp_h)) for o in options),
            # Best EV first; ties go to fewer user minutes, then less compute, then a stable id.
            key=lambda s: (-s.ev_gbp, s.option.user_minutes, s.option.compute_gbp, s.option.id),
        )
    )
    if not ranked:
        return Decision(
            chosen=None, ev_gbp=None, explanation="There's nothing Tempo can do here.", ranked=()
        )
    best = ranked[0]
    if best.ev_gbp < threshold:
        return Decision(
            chosen=None,
            ev_gbp=best.ev_gbp,
            explanation=_decline_text(best.option, best.ev_gbp, time_value_gbp_h),
            ranked=ranked,
        )
    return Decision(
        chosen=best.option,
        ev_gbp=best.ev_gbp,
        explanation=_choice_text(best.option, best.ev_gbp, time_value_gbp_h),
        ranked=ranked,
    )


def _ev(o: ActionOption, time_value_gbp_h: Decimal) -> Decimal:
    return expected_value(
        p_success=o.p_success,
        amount=o.amount_gbp,
        p_goodwill=o.p_goodwill,
        goodwill=o.goodwill_gbp,
        user_minutes=o.user_minutes,
        time_value_gbp_h=time_value_gbp_h,
        compute_gbp=o.compute_gbp,
    )


def _choice_text(o: ActionOption, ev: Decimal, time_value: Decimal) -> str:
    return (
        f"{o.label}: £{_gbp(o.amount_gbp)} for {_minutes(o.user_minutes)} of your time "
        f"(your time is worth about £{_gbp(time_value)} an hour). "
        f"Expected value £{_gbp(ev)}."
    )


def _decline_text(o: ActionOption, ev: Decimal, time_value: Decimal) -> str:
    worth = (
        f"so you'd be £{_gbp(-ev)} worse off"
        if ev < 0
        else f"so it's only worth £{_gbp(ev)} to you"
    )
    return (
        f"Not worth your time: the best way ({o.label}) would pay £{_gbp(o.amount_gbp)} but "
        f"needs {_minutes(o.user_minutes)} of your time (about £{_gbp(time_value)} an hour), "
        f"{worth}."
    )


def _gbp(value: Decimal) -> Decimal:
    return value.quantize(PENNY, ROUND_HALF_UP)


def _minutes(value: Decimal) -> str:
    n = value.normalize()
    return f"{n:f} min"
