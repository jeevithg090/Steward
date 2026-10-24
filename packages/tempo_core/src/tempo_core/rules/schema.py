"""Rule pack schemas: compensation schemes as data, validated before they can be used.

Write money as quoted strings in YAML ("32.31"): a bare 32.31 is a binary float.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from itertools import pairwise
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Pack(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    version: str
    operator: str
    citation_url: str = Field(pattern=r"^https://")
    claim_window_days: int = Field(gt=0)
    # True until the numbers are checked against the operator's published terms (the honesty rule).
    demo_values: bool = False
    last_verified: date | None = None

    @model_validator(mode="after")
    def verified_packs_say_when(self) -> Self:
        if not self.demo_values and self.last_verified is None:
            raise ValueError("a pack without demo_values must say when it was last_verified")
        return self


class DelayBand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    min_minutes: int = Field(ge=0)
    max_minutes: int | None  # None = open-ended
    refund_pct: Decimal = Field(ge=0, le=100)

    def contains(self, minutes: int) -> bool:
        return self.min_minutes <= minutes and (
            self.max_minutes is None or minutes <= self.max_minutes
        )


class DelayRepayPack(_Pack):
    """UK rail Delay Repay: a percentage of the fare by how late the train arrived."""

    kind: Literal["delay_repay"] = "delay_repay"
    scheme: Literal["DR15", "DR30"]
    bands: tuple[DelayBand, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def bands_are_contiguous(self) -> Self:
        """Bands cover every delay from 0 up, without gaps or overlaps, and never pay less later.

        That makes every non-negative delay land in exactly one band, and makes the refund
        monotonic in the delay.
        """
        ordered = sorted(self.bands, key=lambda b: b.min_minutes)
        if ordered[0].min_minutes != 0:
            raise ValueError("the first band must start at 0 minutes")
        if ordered[-1].max_minutes is not None:
            raise ValueError("the last band must be open-ended (max_minutes: null)")
        for a, b in pairwise(ordered):
            if a.max_minutes is None or a.max_minutes + 1 != b.min_minutes:
                raise ValueError("bands must be contiguous and non-overlapping")
            if b.refund_pct < a.refund_pct:
                raise ValueError("a longer delay must never pay less")
        return self


class FixedAmountPack(_Pack):
    """A fixed payment when a condition is met, e.g. Ofcom's missed engineer appointment."""

    kind: Literal["fixed_amount"] = "fixed_amount"
    scheme: str
    amount_gbp: Decimal = Field(gt=0)
    min_notice_hours: int = Field(ge=0)  # cancelling with less notice than this counts as missed


class DistanceBand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    max_km: int | None  # None = open-ended
    amount_gbp: Decimal = Field(gt=0)


class DistanceBandPack(_Pack):
    """Flight delay compensation by distance once the arrival delay passes a threshold (UK261)."""

    kind: Literal["distance_band"] = "distance_band"
    scheme: str
    min_arrival_delay_minutes: int = Field(gt=0)
    bands: tuple[DistanceBand, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def bands_ascend(self) -> Self:
        caps = [b.max_km for b in self.bands]
        if caps[-1] is not None or None in caps[:-1]:
            raise ValueError("only the last distance band may be open-ended")
        bounded = [c for c in caps if c is not None]
        if bounded != sorted(set(bounded)):
            raise ValueError("distance bands must ascend")
        amounts = [b.amount_gbp for b in self.bands]
        if amounts != sorted(amounts):
            raise ValueError("a longer flight must never pay less")
        return self


RulePack = Annotated[
    DelayRepayPack | FixedAmountPack | DistanceBandPack, Field(discriminator="kind")
]
