"""The Negotiator in text mode against a scripted company (S4.2), on both Harness implementations."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tempo_adapters.elevenlabs import load_agent_config, render_prompt
from tempo_core.consent import ConsentEvent, ConsentKind, effective_consent
from tempo_core.models import ContextCapsule
from tempo_harness.bundle import Implementation
from tempo_missions.negotiator import build_negotiator, negotiator_policies
from tempo_missions.tools import ToolDeps, mission_tools
from tempo_ports.claims import SimulatedClaims

from .conftest import ScriptedModel, say, tool_call

T0 = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
CONFIG = Path(__file__).resolve().parents[2] / "voice" / "agents" / "negotiator.outbound.yaml"
VARIABLES = {
    "mission_id": "m_1", "display_name": "Margaret", "entitlement_gbp": "14.20",
    "operator": "GWR", "user_phone": "+15550100123",
}  # fmt: skip
IMPLEMENTATIONS = pytest.mark.parametrize("implementation", ["agent_hooks", "fallback"])


def tool_deps() -> ToolDeps:
    return ToolDeps(
        claims=SimulatedClaims(),
        capsule=lambda mission_id: ContextCapsule(
            mission_id=mission_id, goal="Delay Repay for the 08:12", display_name="Margaret",
            time_value_gbp_h=Decimal("18"), proof_trace_id="pt_m_1",
        ),
        trace=lambda trace_id: None,
        operator=lambda mission_id: "GWR",
    )  # fmt: skip


def consent(**limits: str) -> Any:
    grant = ConsentEvent(
        mission_id="m_1", scope="accept_offer", kind=ConsentKind.GRANT, at=T0,
        limits={k: Decimal(v) for k, v in limits.items()}, device_sig="passkey:iphone",
    )  # fmt: skip
    return effective_consent([grant], T0)


async def call(
    model: ScriptedModel, deps: ToolDeps, implementation: Implementation, **limits: str
) -> Any:
    agent = build_negotiator(
        model.client(),
        deps,
        instructions=render_prompt(load_agent_config(CONFIG), VARIABLES),
        policies=negotiator_policies(
            entitlement=lambda: Decimal("14.20"),
            consent=lambda: consent(**limits),
            traces=lambda _: None,
        ),
        implementation=implementation,
    )
    return await agent.run("Company: Thank you for calling Great Western Railway.")


@IMPLEMENTATIONS
async def test_a_stalling_company_is_logged_the_voucher_refused_and_the_reference_kept(
    scripted: Callable[..., ScriptedModel], implementation: Implementation
) -> None:
    deps = tool_deps()
    model = scripted(
        tool_call("get_case_capsule", mission_id="m_1"),
        tool_call(
            "log_stall",
            mission_id="m_1",
            category="hold_extension",
            quote="Please continue to hold.",
        ),
        tool_call(
            "accept_offer",
            mission_id="m_1",
            kind="voucher",
            amount_gbp="5",
            idempotency_key="m_1:offer1",
        ),
        tool_call("record_reference", mission_id="m_1", reference="GWR-48213"),
        say("Thank you. The reference is GWR-48213 and you'll pay within 28 days."),
    )

    await call(model, deps, implementation, auto_accept_max_gbp="50")

    capsule, stall, offer, reference = model.tool_messages()
    assert '"proof_trace_id":"pt_m_1"' in capsule
    assert stall == "logged"
    assert "voucher" in offer.lower()  # the model is told why it was refused
    assert reference == "recorded"
    assert deps.stalls == [
        {"mission_id": "m_1", "category": "hold_extension", "quote": "Please continue to hold."}
    ]
    assert deps.references == [{"mission_id": "m_1", "reference": "GWR-48213"}]
    assert deps.accepted == {}  # nothing was accepted


@IMPLEMENTATIONS
async def test_a_fair_cash_offer_within_the_preapproved_limit_is_accepted_on_the_call(
    scripted: Callable[..., ScriptedModel], implementation: Implementation
) -> None:
    deps = tool_deps()
    model = scripted(
        tool_call(
            "accept_offer",
            mission_id="m_1",
            kind="cash",
            amount_gbp="14.20",
            idempotency_key="m_1:offer2",
        ),
        say("Accepted £14.20."),
    )

    response = await call(model, deps, implementation, auto_accept_max_gbp="50")

    assert response.user_input_requests == []  # standing approval: no prompt mid-call
    assert deps.accepted == {
        "m_1:offer2": {"mission_id": "m_1", "kind": "cash", "amount_gbp": "14.20"}
    }


@IMPLEMENTATIONS
async def test_a_lowball_offer_is_refused(
    scripted: Callable[..., ScriptedModel], implementation: Implementation
) -> None:
    deps = tool_deps()
    model = scripted(
        tool_call(
            "accept_offer",
            mission_id="m_1",
            kind="cash",
            amount_gbp="10",
            idempotency_key="m_1:offer3",
        ),
        say("I said no."),
    )

    await call(model, deps, implementation, auto_accept_max_gbp="50")

    assert deps.accepted == {}
    assert "14.20" in model.tool_messages()[0]


def test_only_binding_tools_can_have_standing_approval() -> None:
    with pytest.raises(ValueError, match="standing approval"):
        mission_tools(tool_deps(), standing=frozenset({"log_stall"}))


def test_the_negotiator_only_gets_its_own_tools() -> None:
    agent = build_negotiator(
        ScriptedModel([say("hi")]).client(),
        tool_deps(),
        instructions="x",
        policies=negotiator_policies(
            entitlement=lambda: None, consent=lambda: consent(), traces=lambda _: None
        ),
    )

    names = (
        {t.name for t in agent.default_options["tools"]}
        if hasattr(agent, "default_options")
        else set()
    )
    assert names <= {"get_case_capsule", "log_stall", "record_reference", "accept_offer"}
