"""Claims port: filing a claim with a company. Every call carries an idempotency key.

`SimulatedClaims` is the demo and test operator (the honesty badge says "SIMULATED company"): it
hands out a stable reference and files each idempotency key exactly once.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Protocol

from pydantic import BaseModel, ConfigDict


class ClaimReceipt(BaseModel):
    model_config = ConfigDict(frozen=True)

    reference: str  # the company's case reference, e.g. "GWR-48213"
    amount_gbp: Decimal
    simulated: bool  # True when no real company received it


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


class SimulatedClaims:
    def __init__(self) -> None:
        self._filed: dict[str, ClaimReceipt] = {}
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
        self.calls += 1
        return receipt
