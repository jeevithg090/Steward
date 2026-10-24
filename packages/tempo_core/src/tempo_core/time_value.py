"""A person's time value in £ per hour (spec §12.1): always explained, always editable.

"I think an hour of your time is worth about £18. Is that right?" If the person gives a number,
theirs wins. Otherwise Tempo starts from their pay (if they shared it) or a default appraisal
value, then weighs lost shifts and caring duties more heavily.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from pydantic import BaseModel, ConfigDict, Field

PENNY = Decimal("0.01")

# (check) Starting point when the person shares no pay: a placeholder for the DfT TAG databook's
# non-work value of time. Replace it with the current TAG figure, then set DEMO_DEFAULT to False.
DEFAULT_GBP_H = Decimal("12.00")
DEMO_DEFAULT = True
SHIFT_WORK_FACTOR = Decimal("1.5")  # waiting in can cost a whole shift
CARING_FACTOR = Decimal("1.25")  # time away from caring has to be covered by someone


class TimeProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    hourly_pay_gbp: Decimal | None = Field(default=None, gt=0)  # optional, from onboarding
    shift_worker: bool = False
    caring_duties: bool = False
    override_gbp_h: Decimal | None = Field(default=None, ge=0)  # the person's own number


class TimeValue(BaseModel):
    model_config = ConfigDict(frozen=True)

    gbp_h: Decimal
    explanation: str


def time_value(profile: TimeProfile) -> TimeValue:
    if profile.override_gbp_h is not None:
        value = _pence(profile.override_gbp_h)
        return TimeValue(
            gbp_h=value, explanation=f"You told me your time is worth £{value} an hour."
        )

    if profile.hourly_pay_gbp is not None:
        value = profile.hourly_pay_gbp
        reasons = [f"your pay of £{_pence(value)} an hour"]
    else:
        value = DEFAULT_GBP_H
        source = "a placeholder (demo value)" if DEMO_DEFAULT else "the DfT appraisal value"
        reasons = [f"a starting value of £{value} an hour from {source}"]
    if profile.shift_worker:
        value *= SHIFT_WORK_FACTOR
        reasons.append("more because waiting in can cost you a shift")
    if profile.caring_duties:
        value *= CARING_FACTOR
        reasons.append("more because you're a carer")
    value = _pence(value)
    return TimeValue(
        gbp_h=value,
        explanation=(
            f"I think an hour of your time is worth about £{value}, based on "
            f"{', '.join(reasons)}. Is that right?"
        ),
    )


def _pence(value: Decimal) -> Decimal:
    return value.quantize(PENNY, ROUND_HALF_UP)
