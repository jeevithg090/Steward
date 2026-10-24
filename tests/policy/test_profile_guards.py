"""CapabilityGuard and BudgetGuard (SHIPPING §4.4): a profile is enforced, not displayed.

Table-driven over the starter profiles: what each lets a binding tool do, where the budget turns
into a question for the person, and that a broken argument is a deny, never an exception.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tempo_core.capabilities import CAPABILITIES, IN_PLAIN_WORDS
from tempo_core.models import ProofStep, ProofTrace
from tempo_core.profiles import Profile, ProfileCatalog
from tempo_core.readability import flesch_reading_ease
from tempo_harness import TOOL_ACTIONS, BudgetGuard, CapabilityGuard
from tempo_harness.policies import Action, Point, Seen, evaluate

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ProfileCatalog.load(ROOT / "profiles", ROOT / "skills")


def profile(profile_id: str) -> Profile:
    found = CATALOG.get(profile_id)
    assert found is not None
    return found


OWED, COMMUTER, CARER = profile("am-i-owed"), profile("commuter"), profile("carer")
CLAIM = {"mission_id": "m_1", "proof_trace_id": "pt_1", "idempotency_key": "k1"}
CALL = {"mission_id": "m_1", "idempotency_key": "k1"}


def pre(tool: str, **args: Any) -> Seen:
    return Seen(Point.PRE_TOOL, tool=tool, args=args)


def trace(amount: str) -> ProofTrace:
    step = ProofStep(
        fact_keys=("arrival_delay_min",), rule_id="uk-rail.gwr.delay-repay", rule_version="0.1.0",
        citation_url="https://www.gwr.com/", explanation="38 min late: 50% of the fare",
    )  # fmt: skip
    return ProofTrace(id="pt_1", steps=(step,), amount_gbp=Decimal(amount))


BINDING = {
    "file_claim": pre("file_claim", **CLAIM),
    "phone_company": pre("phone_company", **CALL),
    "accept cash": pre("accept_offer", kind="cash", amount_gbp="30.00"),
    "accept voucher": pre("accept_offer", kind="voucher", amount_gbp="30.00"),
    "share_with_helper": pre("share_with_helper", helper_id="h_1"),
}
READ_ONLY = [
    pre("log_stall", category="x", quote="y"),
    pre("recall_memories", user_id="u"),
    pre("lookup_delay", service="08:12"),
]


@pytest.mark.parametrize("seen", BINDING.values(), ids=list(BINDING))
def test_am_i_owed_denies_every_binding_tool(seen: Seen) -> None:
    decision = CapabilityGuard(OWED).check(seen)

    assert decision.action is Action.DENY
    assert decision.reason == "capability_refused"
    assert decision.message is not None
    assert decision.message.startswith("This profile doesn't let me")


@pytest.mark.parametrize(
    ("name", "who", "seen", "reason"),
    [
        ("the commuter claims", COMMUTER, BINDING["file_claim"], None),
        ("the commuter takes cash", COMMUTER, BINDING["accept cash"], None),
        ("the commuter refuses a voucher", COMMUTER, BINDING["accept voucher"], "capability_refused"),
        ("store credit counts as a voucher", COMMUTER, pre("accept_offer", kind="credit", amount_gbp="30"), "capability_refused"),
        ("an offer with no kind is not cash", COMMUTER, pre("accept_offer", amount_gbp="30"), "capability_refused"),
        ("the commuter never phones", COMMUTER, BINDING["phone_company"], "capability_refused"),
        ("the commuter shares nothing", COMMUTER, BINDING["share_with_helper"], "capability_refused"),
        ("the carer may phone", CARER, BINDING["phone_company"], None),
        ("the carer may tell the helper", CARER, BINDING["share_with_helper"], None),
        ("the carer still refuses vouchers", CARER, BINDING["accept voucher"], "capability_refused"),
        ("not listed either way is not allowed", COMMUTER.model_copy(update={"may_not": ()}), BINDING["phone_company"], "capability_not_allowed"),
    ],
)  # fmt: skip
def test_capability_guard(name: str, who: Profile, seen: Seen, reason: str | None) -> None:
    decision = CapabilityGuard(who).check(seen)

    assert decision.action is (Action.ALLOW if reason is None else Action.DENY), name
    assert decision.reason == reason, name


@pytest.mark.parametrize("seen", READ_ONLY, ids=lambda s: str(s.tool))
@pytest.mark.parametrize("who", CATALOG.profiles, ids=lambda p: str(p.id))
def test_read_only_tools_are_always_allowed(who: Profile, seen: Seen) -> None:
    assert seen.tool not in TOOL_ACTIONS
    assert CapabilityGuard(who).check(seen).action is Action.ALLOW
    assert BudgetGuard(who).check(seen).action is Action.ALLOW


@pytest.mark.parametrize(
    ("name", "args", "action", "reason"),
    [
        ("at the limit", {"kind": "cash", "amount_gbp": "250.00"}, Action.ALLOW, None),
        ("a penny over", {"kind": "cash", "amount_gbp": "250.01"}, Action.ESCALATE, "budget_above_limit"),
        ("well over", {"kind": "cash", "amount_gbp": "600"}, Action.ESCALATE, "budget_above_limit"),
        ("a number as a number", {"kind": "cash", "amount_gbp": 40}, Action.ALLOW, None),
        ("unreadable", {"kind": "cash", "amount_gbp": "lots"}, Action.DENY, "budget_bad_amount"),
        ("missing", {"kind": "cash"}, Action.DENY, "budget_bad_amount"),
        ("not a number at all", {"kind": "cash", "amount_gbp": "NaN"}, Action.DENY, "budget_bad_amount"),
        ("infinite", {"kind": "cash", "amount_gbp": "Infinity"}, Action.DENY, "budget_bad_amount"),
        ("negative", {"kind": "cash", "amount_gbp": "-5"}, Action.DENY, "budget_bad_amount"),
        ("a voucher is budgeted too", {"kind": "voucher", "amount_gbp": "300"}, Action.ESCALATE, "budget_above_limit"),
    ],
)  # fmt: skip
def test_budget_guard_on_an_offer(
    name: str, args: dict[str, Any], action: Action, reason: str | None
) -> None:
    decision = BudgetGuard(COMMUTER).check(pre("accept_offer", **args))

    assert (decision.action, decision.reason) == (action, reason), name


def test_a_zero_budget_turns_every_penny_into_a_question() -> None:
    guard = BudgetGuard(OWED)  # max_gbp_per_claim is "0.00"

    assert guard.check(pre("accept_offer", kind="cash", amount_gbp="0.00")).action is Action.ALLOW
    assert (
        guard.check(pre("accept_offer", kind="cash", amount_gbp="0.01")).action is Action.ESCALATE
    )


def test_a_claim_is_weighed_from_its_proof_trace() -> None:
    plain = BudgetGuard(COMMUTER)
    over = BudgetGuard(COMMUTER, traces=lambda tid: trace("300.00") if tid == "pt_1" else None)
    within = BudgetGuard(COMMUTER, traces=lambda _: trace("250.00"))
    other_trace = {**CLAIM, "proof_trace_id": "pt_x"}

    assert plain.check(pre("file_claim", **CLAIM)).action is Action.ALLOW  # ProofRequired's job
    assert over.check(pre("file_claim", **CLAIM)).reason == "budget_above_limit"
    assert over.check(pre("file_claim", **other_trace)).reason == "budget_bad_amount"
    assert within.check(pre("file_claim", **CLAIM)).action is Action.ALLOW
    assert plain.check(pre("file_claim", **CLAIM, amount_gbp="300")).action is Action.ESCALATE
    assert plain.check(pre("file_claim", **CLAIM, amount_gbp="lots")).reason == "budget_bad_amount"


def test_the_escalation_asks_the_person_and_names_both_amounts() -> None:
    decision = BudgetGuard(COMMUTER).check(pre("accept_offer", kind="cash", amount_gbp="300"))

    assert decision.message == (
        "This is for £300. This profile lets me handle up to £250.00 on my own. "
        "Do you want me to go ahead?"
    )


def test_every_message_is_in_plain_words() -> None:
    messages = [CapabilityGuard(OWED).check(seen).message for seen in BINDING.values()]
    messages += [
        BudgetGuard(COMMUTER).check(pre("accept_offer", kind="cash", amount_gbp="300")).message,
        BudgetGuard(COMMUTER).check(pre("accept_offer", kind="cash")).message,
    ]
    messages += [
        f"This profile doesn't let me {IN_PLAIN_WORDS[word]}, so I stopped."
        for word in sorted(CAPABILITIES)
    ]

    assert messages[3] == "This profile doesn't let me accept vouchers, so I stopped."
    for message in messages:
        assert message is not None and flesch_reading_ease(message) >= 60, message


def test_a_bad_argument_never_raises_past_evaluate() -> None:
    broken = Seen(Point.PRE_TOOL, tool="accept_offer", args=None)  # type: ignore[arg-type]

    for guard in (CapabilityGuard(COMMUTER), BudgetGuard(COMMUTER)):
        decision, trail = evaluate([guard], broken)

        assert (decision.action, decision.reason) == (Action.DENY, "policy_error")
        assert trail == [(guard.name, decision)]


def test_deny_wins_and_a_question_only_follows_an_allowed_action() -> None:
    guards = [CapabilityGuard(COMMUTER), BudgetGuard(COMMUTER)]

    denied, trail1 = evaluate(guards, pre("accept_offer", kind="voucher", amount_gbp="300"))
    asked, trail2 = evaluate(guards, pre("accept_offer", kind="cash", amount_gbp="300"))
    allowed, trail3 = evaluate(guards, pre("accept_offer", kind="cash", amount_gbp="30"))

    assert (denied.action, denied.reason) == (Action.DENY, "capability_refused")
    assert [name for name, _ in trail1] == ["capability"]  # nothing after the deny ran
    assert (asked.action, asked.reason) == (Action.ESCALATE, "budget_above_limit")
    assert [name for name, _ in trail2] == ["capability", "budget"]
    assert allowed.action is Action.ALLOW and len(trail3) == 2
