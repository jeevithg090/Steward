"""How often a problem sorts itself out, and how soon (Rights Decay, build plan R2).

A hazard curve is P(resolved by day t), counted from the day the problem started, fitted from
real resolution times (Kaplan-Meier, scripts/rights_backtest.py) and kept as a step curve with its
provenance. Not every resolution pays, so the planner uses `paid()`: the same curve scaled by the
share of closures that go the person's way (the FCA's "upheld" share is the UK anchor). The
planner asks two things of it: how likely a problem still open at age t is to be paid today, and
how likely it is to be paid by some later day.

Curves fitted on one population and used for another say so (`demo_values: true` and a `note`),
and the screen repeats it.
"""

from __future__ import annotations

from decimal import Decimal
from itertools import pairwise
from pathlib import Path
from typing import Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

ZERO, ONE = Decimal(0), Decimal(1)


class Hazard(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    source: str = Field(min_length=1)  # where the curve came from, and when it was fetched
    n: int = Field(ge=0)  # how many cases it was fitted on
    demo_values: bool  # True while the curve stands in for a different population
    note: str = ""
    resolved_by: tuple[tuple[int, Decimal], ...] = Field(min_length=1)  # (day, P(resolved))
    # A closed case isn't always a paid one: the share of closures that go the person's way.
    # A closure that doesn't leaves the problem open, so the right to complain is still there.
    pays_share: Decimal = Field(default=ONE, ge=ZERO, le=ONE)
    pays_share_source: str = ""

    @model_validator(mode="after")
    def is_a_curve(self) -> Self:
        """Starts at (0, 0), days strictly ascend, and the share resolved never goes down."""
        if self.resolved_by[0] != (0, ZERO):
            raise ValueError("a hazard curve starts at day 0 with nothing resolved")
        for (d1, p1), (d2, p2) in pairwise(self.resolved_by):
            if d2 <= d1:
                raise ValueError("hazard curve days must ascend")
            if p2 < p1:
                raise ValueError("the share resolved can't go down over time")
        if not all(ZERO <= p <= ONE for _, p in self.resolved_by):
            raise ValueError("hazard curve values are probabilities")
        return self

    def p_resolved_by(self, day: int) -> Decimal:
        """P(resolved by `day`), straight lines between knots and flat after the last one."""
        if day <= 0:
            return ZERO
        for (d1, p1), (d2, p2) in pairwise(self.resolved_by):
            if day <= d2:
                return p1 + (p2 - p1) * Decimal(day - d1) / Decimal(d2 - d1)
        return self.resolved_by[-1][1]

    def p_resolves_between(self, start: int, end: int) -> Decimal:
        """P(resolved by `end` | still open at `start`). Zero when nothing is left open."""
        open_at_start = ONE - self.p_resolved_by(start)
        if open_at_start <= ZERO or end <= start:
            return ZERO
        return (self.p_resolved_by(end) - self.p_resolved_by(start)) / open_at_start

    def hazard_on(self, day: int) -> Decimal:
        """P(resolves during `day` | open at its start). Zero past the data, never a guess."""
        return self.p_resolves_between(day, day + 1)

    def paid(self) -> Hazard:
        """The curve of being paid without a fight: closures scaled by the share that pay."""
        if self.pays_share == ONE:
            return self
        knots = tuple((d, p * self.pays_share) for d, p in self.resolved_by)
        return self.model_copy(update={"resolved_by": knots, "pays_share": ONE})

    @classmethod
    def none(cls, id: str = "none") -> Hazard:
        """For rights that never sort themselves out (a late train is never un-late)."""
        return cls(
            id=id, source="no self-resolution", n=0, demo_values=False, resolved_by=((0, ZERO),)
        )

    @classmethod
    def from_yaml(cls, path: Path) -> Hazard:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["resolved_by"] = [(int(d), Decimal(str(p))) for d, p in data["resolved_by"]]
        if "pays_share" in data:
            data["pays_share"] = Decimal(str(data["pays_share"]))
        return cls.model_validate(data)


def load_hazards(directory: Path) -> dict[str, Hazard]:
    """Every `*.yaml` curve in a folder, by id (skills/rights-decay/hazards)."""
    curves = [Hazard.from_yaml(p) for p in sorted(directory.glob("*.yaml"))]
    by_id = {h.id: h for h in curves}
    if len(by_id) != len(curves):
        raise ValueError("two hazard curves share an id")
    return by_id
