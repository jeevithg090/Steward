"""A Tempo Profile is enforced where the Negotiator runs (SHIPPING.md §4.4): its guards sit in the
policy list right after the consent check, and refuse what the profile forbids."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from tempo_core.consent import ConsentState
from tempo_core.profiles import ProfileCatalog
from tempo_harness.policies import Action, Point, Seen, evaluate
from tempo_missions.negotiator import negotiator_policies

REPO = Path(__file__).resolve().parents[2]
CATALOG = ProfileCatalog.load(REPO / "profiles", REPO / "skills")


def _policies(profile_id: str | None):  # type: ignore[no-untyped-def]
    profile = CATALOG.get(profile_id) if profile_id else None
    return negotiator_policies(
        entitlement=lambda: Decimal("14.20"),
        consent=lambda: ConsentState(),
        traces=lambda _: None,
        profile=profile,
    )


def test_without_a_profile_the_policy_list_is_unchanged() -> None:
    names = [p.name for p in _policies(None)]
    assert names == [
        "consent_scope",
        "settlement",
        "proof_required",
        "injection_shield",
        "pii_redactor",
    ]


def test_a_profile_adds_its_two_guards_right_after_consent() -> None:
    names = [p.name for p in _policies("commuter")]
    assert names[:3] == ["consent_scope", "capability", "budget"]


def test_the_commuter_profile_refuses_a_voucher_before_settlement_is_even_asked() -> None:
    guards = [p for p in _policies("commuter") if p.name in ("capability", "budget")]
    seen = Seen(Point.PRE_TOOL, tool="accept_offer", args={"kind": "voucher", "amount_gbp": "20"})
    decision, trail = evaluate(guards, seen)
    assert decision.action is Action.DENY
    assert trail[0][0] == "capability"
    assert "voucher" in (decision.message or "").lower()


def test_a_read_only_profile_refuses_every_binding_tool() -> None:
    guards = [p for p in _policies("am-i-owed") if p.name == "capability"]
    for tool, args in (
        ("file_claim", {}),
        ("phone_company", {}),
        ("accept_offer", {"kind": "cash", "amount_gbp": "5"}),
        ("share_with_helper", {}),
    ):
        decision, _ = evaluate(guards, Seen(Point.PRE_TOOL, tool=tool, args=args))
        assert decision.action is Action.DENY, tool
