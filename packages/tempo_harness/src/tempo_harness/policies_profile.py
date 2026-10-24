"""Profile guards (SHIPPING §4.4): a profile is enforced, not displayed.

`CapabilityGuard` refuses any binding tool whose capability the profile does not allow. It uses
the same tool-to-action map as the MandateGuard, so a profile and a signed mandate can never
disagree about what a word means. `BudgetGuard` turns a claim or an offer above the profile's
`max_gbp_per_claim` into a question for the person, not a refusal: the limit is theirs to lift,
once, with a signed yes. An amount nobody can read is a deny (docs/adr/0004: deny wins).

`file_claim` never takes an amount from the model (the Proof Trace holds it, and `ProofRequired`
pins the claim to it), so a claim with no `amount_gbp` is allowed unless the guard is handed a
trace lookup; `accept_offer` always carries one and is refused without it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal

from tempo_core.capabilities import IN_PLAIN_WORDS
from tempo_core.models import ProofTrace
from tempo_core.profiles import Profile
from tempo_harness.policies import ALLOW, Action, Decision, Point, Seen, _money
from tempo_harness.policies_mandate import TOOL_ACTIONS, offer_action

BUDGETED = frozenset({"file_claim", "accept_offer"})  # the tools that carry money


@dataclass(frozen=True)
class CapabilityGuard:
    profile: Profile
    name: str = "capability"
    points: frozenset[Point] = frozenset({Point.PRE_TOOL})

    def check(self, seen: Seen) -> Decision:
        tool = seen.tool or ""
        if tool not in TOOL_ACTIONS:
            return ALLOW  # read-only: a profile bounds what binds, not what Tempo may look at
        action = TOOL_ACTIONS[tool] or offer_action(seen.args)
        if action in self.profile.may_not:
            return self._stop("capability_refused", action)
        if action not in self.profile.may:
            return self._stop("capability_not_allowed", action)
        return ALLOW

    @staticmethod
    def _stop(reason: str, action: str) -> Decision:
        return Decision(
            Action.DENY,
            reason,
            f"This profile doesn't let me {IN_PLAIN_WORDS[action]}, so I stopped.",
        )


@dataclass(frozen=True)
class BudgetGuard:
    profile: Profile
    traces: Callable[[str], ProofTrace | None] | None = None  # the amount of a claim, by trace id
    name: str = "budget"
    points: frozenset[Point] = frozenset({Point.PRE_TOOL})

    def check(self, seen: Seen) -> Decision:
        tool = seen.tool or ""
        if tool not in BUDGETED:
            return ALLOW
        raw = seen.args.get("amount_gbp")
        if raw is None and tool == "file_claim":
            if self.traces is None:
                return ALLOW  # ProofRequired owns the amount; there is nothing here to weigh
            trace = self.traces(str(seen.args.get("proof_trace_id", "")))
            raw = None if trace is None else trace.amount_gbp
        amount = _money(raw)
        if amount is None or not amount.is_finite() or amount < 0:
            return Decision(
                Action.DENY, "budget_bad_amount", "I can't read the amount, so I said no."
            )
        cap: Decimal = self.profile.limits.max_gbp_per_claim
        if amount > cap:
            return Decision(
                Action.ESCALATE,
                "budget_above_limit",
                f"This is for £{amount}. This profile lets me handle up to £{cap} on my own. "
                "Do you want me to go ahead?",
            )
        return ALLOW
