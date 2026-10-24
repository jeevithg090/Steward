"""MandateGuard (build plan P3): Tempo can't take a binding action outside its signed mandate.

Table-driven over the golden mandate, signed for real by the fixture passkey.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from tempo_core.consent import ConsentEvent, ConsentKind, effective_consent
from tempo_core.readability import flesch_reading_ease
from tempo_harness import TOOL_ACTIONS, MandateGuard
from tempo_harness.policies import Action, Point, Seen, evaluate
from tempo_harness.policies_mandate import utc_now
from tempo_missions.negotiator import negotiator_policies
from tempo_missions.tools import BINDING_SCOPES
from tempo_passport import SignedMandate

from ..helpers.passport import COMPANY, NOW, gateway_signed, golden, sign, trusted_keys

SIGNED = sign(golden())
CLAIM = {"mission_id": "m_ofcom_demo", "proof_trace_id": "pt_1", "idempotency_key": "k1"}


def pre(tool: str, **args: Any) -> Seen:
    return Seen(Point.PRE_TOOL, tool=tool, args=args)


def guard(
    signed: SignedMandate | None = SIGNED,
    *,
    company: str = COMPANY,
    now: datetime = NOW,
    revoked: Callable[[str], bool | None] | None = None,
) -> MandateGuard:
    return MandateGuard(lambda: signed, lambda: company, lambda: now, revoked)


@pytest.mark.parametrize(
    ("name", "policy", "seen", "reason"),
    [
        ("allowed claim", guard(), pre("file_claim", **CLAIM), None),
        ("allowed call", guard(), pre("phone_company", mission_id="m", idempotency_key="k"), None),
        ("allowed cash at the amount", guard(), pre("accept_offer", kind="cash", amount_gbp="32.31"), None),
        ("a read-only tool needs no mandate", guard(None), pre("log_stall", category="x", quote="y"), None),
        ("voucher", guard(), pre("accept_offer", kind="voucher", amount_gbp="32.31"), "mandate_action_not_allowed"),
        ("store credit counts as a voucher", guard(), pre("accept_offer", kind="credit", amount_gbp="32.31"), "mandate_action_not_allowed"),
        ("sharing her details", guard(), pre("share_with_helper", helper_id="h"), "mandate_action_not_allowed"),
        ("cash above max", guard(), pre("accept_offer", kind="cash", amount_gbp="40"), "mandate_amount_above_max"),
        ("cash below min", guard(), pre("accept_offer", kind="cash", amount_gbp="10"), "mandate_amount_below_min"),
        ("an offer with no amount", guard(), pre("accept_offer", kind="cash"), "mandate_bad_amount"),
        ("an amount nobody can read", guard(), pre("file_claim", **CLAIM, amount_gbp="lots"), "mandate_bad_amount"),
        ("wrong counterparty", guard(company="Telly Ltd"), pre("file_claim", **CLAIM), "mandate_wrong_counterparty"),
        ("expired", guard(now=NOW + timedelta(days=1)), pre("file_claim", **CLAIM), "mandate_expired"),
        ("revoked", guard(revoked=lambda _: True), pre("file_claim", **CLAIM), "mandate_revoked"),
        ("status unreachable", guard(revoked=lambda _: None), pre("file_claim", **CLAIM), "mandate_status_unreachable"),
        ("missing mandate", guard(None), pre("file_claim", **CLAIM), "mandate_missing"),
        ("a landline mandate without the Gateway's key", guard(gateway_signed(golden())), pre("file_claim", **CLAIM), "mandate_bad_key"),
    ],
)  # fmt: skip
def test_mandate_guard(name: str, policy: MandateGuard, seen: Seen, reason: str | None) -> None:
    decision = policy.check(seen)

    assert decision.action is (Action.ALLOW if reason is None else Action.DENY), decision
    assert decision.reason == reason


def test_a_landline_mandate_passes_with_the_trusted_gateway_key() -> None:
    policy = replace(guard(gateway_signed(golden())), gateway_keys=trusted_keys())

    assert policy.check(pre("file_claim", **CLAIM)).action is Action.ALLOW


def test_every_binding_tool_maps_to_a_mandate_action() -> None:
    assert set(TOOL_ACTIONS) == set(BINDING_SCOPES)


def test_refusals_explain_themselves_in_plain_words() -> None:
    seen = [
        pre("accept_offer", kind="voucher", amount_gbp="32.31"),
        pre("accept_offer", kind="cash", amount_gbp="40"),
        pre("accept_offer", kind="cash"),
    ]
    messages = [guard().check(s).message for s in seen] + [guard(None).check(seen[0]).message]

    assert messages[0] == "This mandate does not cover taking a voucher."
    for message in messages:
        assert message is not None and flesch_reading_ease(message) >= 60, message


# --- Composition with the Negotiator's other policies ------------------------------------------


def policies(**kw: Any) -> list[Any]:
    grant = ConsentEvent(
        mission_id="m_ofcom_demo", scope="accept_offer", kind=ConsentKind.GRANT, at=NOW,
        limits={"auto_accept_max_gbp": Decimal(50)}, device_sig="passkey:iphone",
    )  # fmt: skip
    return negotiator_policies(
        entitlement=lambda: Decimal("32.31"), consent=lambda: effective_consent([grant], NOW),
        traces=lambda _: None, **kw,
    )  # fmt: skip


def with_mandate(signed: SignedMandate | None = SIGNED) -> list[Any]:
    return policies(mandate=lambda: signed, counterparty=lambda: COMPANY, clock=lambda: NOW)


def test_without_a_mandate_the_negotiator_policies_are_unchanged() -> None:
    assert [p.name for p in policies()] == [
        "consent_scope", "settlement", "proof_required", "injection_shield", "pii_redactor",
    ]  # fmt: skip
    assert [p.name for p in with_mandate()][:3] == ["consent_scope", "mandate", "settlement"]


def test_a_fair_cash_offer_passes_both_the_settlement_and_the_mandate_guard() -> None:
    decision, trail = evaluate(with_mandate(), pre("accept_offer", kind="cash", amount_gbp="32.31"))

    assert decision.action is Action.ALLOW
    assert [name for name, _ in trail] == [
        "consent_scope",
        "mandate",
        "settlement",
        "proof_required",
    ]


@pytest.mark.parametrize(
    ("args", "reason"),
    [
        (
            {"kind": "voucher", "amount_gbp": "32.31"},
            "mandate_action_not_allowed",
        ),  # both would deny
        (
            {"kind": "cash", "amount_gbp": "40"},
            "mandate_amount_above_max",
        ),  # settlement alone allows
        (
            {"kind": "cash", "amount_gbp": "80"},
            "mandate_amount_above_max",
        ),  # settlement would escalate
    ],
)
def test_the_first_deny_wins(args: dict[str, str], reason: str) -> None:
    decision, trail = evaluate(with_mandate(), pre("accept_offer", **args))

    assert (decision.action, decision.reason) == (Action.DENY, reason)
    assert trail[-1][0] == "mandate"  # nothing after the deny ran


def test_a_mandate_needs_a_counterparty() -> None:
    with pytest.raises(ValueError, match="counterparty"):
        policies(mandate=lambda: SIGNED)


def test_the_default_clock_is_aware_utc() -> None:
    assert utc_now().utcoffset() == timedelta(0)
