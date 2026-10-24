"""Claims port: filing a claim with a company. Every call carries an idempotency key.

`SimulatedClaims` is the demo and test operator (the honesty badge says "SIMULATED company"): it
hands out a stable reference and files each idempotency key exactly once.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Protocol

from pydantic import BaseModel, ConfigDict


class ClaimReceipt(BaseModel):
    model_config = ConfigDict(frozen=True)

    reference: str  # the company's case reference, e.g. "GWR-48213"
    amount_gbp: Decimal
    simulated: bool  # True when no real company received it


class PaymentStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    paid: bool
    amount_gbp: Decimal | None = None
    paid_at: datetime | None = None


class ClaimsPort(Protocol):
    async def file_claim(
        self,
        *,
        operator: str,
        mission_id: str,
        proof_trace_id: str,
        amount_gbp: Decimal,
        idempotency_key: str,
    ) -> ClaimReceipt:
        """Filing twice with the same idempotency key returns the first receipt."""
        ...  # fmt: skip

    async def payment_status(self, reference: str) -> PaymentStatus:
        """Whether the company has paid this claim yet (read-only)."""
        ...


class SimulatedClaims:
    """`pays_after`: how long the simulated company takes to pay (None: it never pays)."""

    def __init__(
        self,
        *,
        pays_after: timedelta | None = timedelta(0),
        clock: Callable[[], datetime] = lambda: datetime.now(tz=UTC),
    ) -> None:
        self._filed: dict[str, ClaimReceipt] = {}
        self._filed_at: dict[str, datetime] = {}
        self._pays_after = pays_after
        self._clock = clock
        self.calls = 0  # how many times a claim was actually filed

    async def file_claim(
        self, *, operator: str, mission_id: str, proof_trace_id: str, amount_gbp: Decimal,
        idempotency_key: str,
    ) -> ClaimReceipt:  # fmt: skip
        if idempotency_key in self._filed:
            return self._filed[idempotency_key]
        digest = int(hashlib.sha256(idempotency_key.encode()).hexdigest(), 16)
        prefix = "".join(c for c in operator.upper() if c.isalpha())[:3] or "REF"
        receipt = ClaimReceipt(
            reference=f"{prefix}-{digest % 90000 + 10000}", amount_gbp=amount_gbp, simulated=True
        )
        self._filed[idempotency_key] = receipt
        self._filed_at[receipt.reference] = self._clock()
        self.calls += 1
        return receipt

    async def payment_status(self, reference: str) -> PaymentStatus:
        filed_at = self._filed_at.get(reference)
        if filed_at is None or self._pays_after is None:
            return PaymentStatus(paid=False)
        paid_at = filed_at + self._pays_after
        if self._clock() < paid_at:
            return PaymentStatus(paid=False)
        receipt = next(r for r in self._filed.values() if r.reference == reference)
        return PaymentStatus(paid=True, amount_gbp=receipt.amount_gbp, paid_at=paid_at)
