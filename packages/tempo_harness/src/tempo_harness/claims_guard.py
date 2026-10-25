"""The profile guards on the Clawback workflows' own claim path (plan.md §12.1, finding 1).

The Negotiator's tools run inside the Harness middleware (`negotiator_policies(profile=...)`).
The Clawback Rail and Ofcom workflows file their claim from a workflow step instead, through the
claims port, so that path had no profile guard. `GuardedClaims` wraps the port: before a claim
reaches the company, the same `CapabilityGuard` and `BudgetGuard` judge the same `Seen` a
`file_claim` tool call makes. A deny raises `ClaimRefused` with the guard's plain message and
nothing is filed; the Gateway turns that into a failed-safe mission.

`BudgetGuard` escalates a claim above the profile's limit, and the person has already been asked:
the Gateway adds `ask_note` to the consent ask, and the workflow files only after a signed yes.
So an escalation goes through only when `asked_above_limit(mission_id)` says that ask named the
limit. Otherwise it is refused, never waved through, and so is a profile that can't be found.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from tempo_core.errors import TempoError
from tempo_core.profiles import Profile
from tempo_harness.policies import Action, Decision, Point, Seen, evaluate
from tempo_harness.policies_profile import BudgetGuard, CapabilityGuard

UNKNOWN_PROFILE = "I can't find the profile this claim runs under, so I stopped."


class ClaimRefused(TempoError):
    """A guard said no to filing a claim. `str(exc)` is the plain message for the person."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.message, self.reason = message, reason


class Claims(Protocol):
    """The claims port, by shape (`tempo_ports.claims.ClaimsPort`): the Harness wraps whatever
    files claims without importing the ports package."""

    async def file_claim(
        self, *, operator: str, mission_id: str, proof_trace_id: str, amount_gbp: Decimal,
        idempotency_key: str,
    ) -> Any: ...  # fmt: skip

    async def payment_status(self, reference: str) -> Any: ...


def _never(mission_id: str) -> bool:
    return False


@dataclass(frozen=True)
class GuardedClaims:
    inner: Claims
    profile_for: Callable[[str], Profile | None]  # None: the mission runs under no profile
    asked_above_limit: Callable[[str], bool] = _never

    def _judge(self, mission_id: str, amount_gbp: Decimal) -> tuple[Profile | None, Decision]:
        try:
            profile = self.profile_for(mission_id)
        except Exception as exc:  # a lookup that fails must block, never wave through
            raise ClaimRefused(UNKNOWN_PROFILE, "profile_unknown") from exc
        if profile is None:
            return None, Decision(Action.ALLOW)
        seen = Seen(
            Point.PRE_TOOL, tool="file_claim",
            args={"mission_id": mission_id, "amount_gbp": str(amount_gbp)},
        )  # fmt: skip
        decision, _ = evaluate((CapabilityGuard(profile), BudgetGuard(profile)), seen)
        return profile, decision

    def ask_note(self, mission_id: str, amount_gbp: Decimal) -> str | None:
        """The sentence the consent ask carries when this claim is above the profile's limit.
        None when the claim is within it, or when the profile refuses the claim outright (the
        tool will say no; the limit is not the reason)."""
        try:
            profile, decision = self._judge(mission_id, amount_gbp)
        except ClaimRefused:
            return None
        if profile is None or decision.reason != "budget_above_limit":
            return None
        cap = profile.limits.max_gbp_per_claim
        return f"This is above your profile's limit of £{cap}, so I'm asking you first."

    def check(self, mission_id: str, amount_gbp: Decimal) -> None:
        """Raise ClaimRefused unless the mission's profile lets this claim be filed now."""
        profile, decision = self._judge(mission_id, amount_gbp)
        if profile is None or decision.action is Action.ALLOW:
            return
        if decision.action is Action.ESCALATE and decision.reason == "budget_above_limit":
            if self.asked_above_limit(mission_id):
                return  # the signed yes answered an ask that named the limit
            cap = profile.limits.max_gbp_per_claim
            message = f"This is above your profile's limit of £{cap}, so I stopped."
            raise ClaimRefused(message, "budget_not_asked")
        if decision.blocks:
            message = decision.message or "I stopped before filing."
            raise ClaimRefused(message, decision.reason or "refused")

    async def file_claim(
        self, *, operator: str, mission_id: str, proof_trace_id: str, amount_gbp: Decimal,
        idempotency_key: str,
    ) -> Any:  # fmt: skip
        self.check(mission_id, amount_gbp)
        return await self.inner.file_claim(
            operator=operator, mission_id=mission_id, proof_trace_id=proof_trace_id,
            amount_gbp=amount_gbp, idempotency_key=idempotency_key,
        )  # fmt: skip

    async def payment_status(self, reference: str) -> Any:
        return await self.inner.payment_status(reference)
