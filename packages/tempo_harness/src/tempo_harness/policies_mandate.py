"""MandateGuard (build plan P3): no binding action outside the mandate the person signed.

The Harness checks the mandate before every binding tool call, with the same verifier a company
uses (`tempo_passport`). A model talked into doing more than the person signed for is stopped
here, and again on the far side of the call. No mandate, an unreadable amount, or a status that
can't be fetched is a deny: deny wins (docs/adr/0004).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any

from tempo_harness.policies import ALLOW, Action, Decision, Point, Seen, _money
from tempo_passport import NO_KEYS, Revoked, SignedMandate, check

# Binding tool -> the mandate action it needs. accept_offer depends on what is offered.
TOOL_ACTIONS: Mapping[str, str | None] = MappingProxyType(
    {
        "file_claim": "claim",
        "phone_company": "call",
        "accept_offer": None,
        "share_with_helper": "share_personal_data",
    }
)


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def offer_action(args: Mapping[str, Any]) -> str:
    """Only cash is cash: any other kind (voucher, credit, points) needs `accept_voucher`."""
    return "accept_cash" if args.get("kind") == "cash" else "accept_voucher"


@dataclass(frozen=True)
class MandateGuard:
    mandate: Callable[[], SignedMandate | None]
    counterparty: Callable[[], str]
    clock: Callable[[], datetime]
    revoked: Revoked | None = None  # mandate id -> revoked?; None from it means unreachable
    gateway_keys: Mapping[str, bytes] = NO_KEYS  # trusted keys for landline mandates
    name: str = "mandate"
    points: frozenset[Point] = frozenset({Point.PRE_TOOL})

    def check(self, seen: Seen) -> Decision:
        tool = seen.tool or ""
        if tool not in TOOL_ACTIONS:
            return ALLOW
        signed = self.mandate()
        if signed is None:
            return Decision(
                Action.DENY,
                "mandate_missing",
                "I don't hold a signed mandate for this, so I stopped.",
            )
        raw = seen.args.get("amount_gbp")
        amount = None if raw is None else _money(raw)
        if amount is None and (raw is not None or tool == "accept_offer"):
            return Decision(
                Action.DENY, "mandate_bad_amount", "I can't read the amount, so I said no."
            )
        verdict = check(
            signed, now=self.clock(), counterparty=self.counterparty(),
            action=TOOL_ACTIONS[tool] or offer_action(seen.args), amount_gbp=amount,
            revoked=self.revoked, gateway_keys=self.gateway_keys,
        )  # fmt: skip
        if verdict.ok:
            return ALLOW
        return Decision(Action.DENY, f"mandate_{verdict.reason}", verdict.message)
