"""The Time Ledger and the Time Invoice (spec §12.3).

The headline number is "hours of life returned". A Time Invoice prices wasted time at the
person's own time value; it's non-binding and goes with a complaint as a goodwill request.
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

PENNY = Decimal("0.01")
SIXTY = Decimal(60)


class LedgerEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    mission_id: str
    at: AwareDatetime
    minutes_lost: Decimal = Field(default=Decimal(0), ge=0)  # e.g. hold time the company caused
    minutes_returned: Decimal = Field(default=Decimal(0), ge=0)  # what Tempo did instead of you
    gbp_recovered: Decimal = Field(default=Decimal(0), ge=0)


class LedgerTotals(BaseModel):
    model_config = ConfigDict(frozen=True)

    minutes_lost: Decimal
    minutes_returned: Decimal
    gbp_recovered: Decimal

    @property
    def hours_returned(self) -> Decimal:
        return (self.minutes_returned / SIXTY).quantize(Decimal("0.1"), ROUND_HALF_UP)


def summarise(entries: Iterable[LedgerEntry]) -> LedgerTotals:
    entries = list(entries)
    return LedgerTotals(
        minutes_lost=sum((e.minutes_lost for e in entries), Decimal(0)),
        minutes_returned=sum((e.minutes_returned for e in entries), Decimal(0)),
        gbp_recovered=sum((e.gbp_recovered for e in entries), Decimal(0)),
    )


class InvoiceLine(BaseModel):
    model_config = ConfigDict(frozen=True)

    description: str  # "On hold to Openreach, 23 Oct"
    minutes: Decimal = Field(gt=0)
    amount_gbp: Decimal


class TimeInvoice(BaseModel):
    model_config = ConfigDict(frozen=True)

    time_value_gbp_h: Decimal
    lines: tuple[InvoiceLine, ...]
    total_gbp: Decimal  # the sum of the rounded lines, so the invoice always adds up


def time_invoice(items: Iterable[tuple[str, Decimal]], *, time_value_gbp_h: Decimal) -> TimeInvoice:
    """Price each (description, minutes) item at the person's time value, to the penny."""
    lines = tuple(
        InvoiceLine(
            description=description,
            minutes=minutes,
            amount_gbp=(minutes / SIXTY * time_value_gbp_h).quantize(PENNY, ROUND_HALF_UP),
        )
        for description, minutes in items
    )
    return TimeInvoice(
        time_value_gbp_h=time_value_gbp_h,
        lines=lines,
        total_gbp=sum((line.amount_gbp for line in lines), Decimal("0.00")),
    )
