"""Mission tools: approval modes, idempotency, amounts from the trace, timeouts (S3.2)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest
from agent_framework import Agent, FunctionTool

from tempo_core.models import ContextCapsule, ProofStep, ProofTrace
from tempo_missions import tools as tools_module
from tempo_missions.tools import BINDING_SCOPES, ToolDeps, mission_tools
from tempo_ports.claims import ClaimReceipt, SimulatedClaims

from .conftest import ScriptedModel, say, tool_call

TRACE = ProofTrace(
    id="pt_31c",
    steps=(
        ProofStep(
            fact_keys=("arrival_delay_min",),
            rule_id="uk-rail.gwr.delay-repay",
            rule_version="0.1.0",
            citation_url="https://www.gwr.com/",
            explanation="38 min late → 50% of £28.40 under GWR DR15",
        ),
    ),
    amount_gbp=Decimal("14.20"),
)


def deps(claims: Any = None) -> ToolDeps:
    return ToolDeps(
        claims=claims or SimulatedClaims(),
        capsule=lambda mission_id: ContextCapsule(
            mission_id=mission_id, goal="Recover Delay Repay", display_name="Margaret",
            time_value_gbp_h=Decimal("18"), proof_trace_id="pt_31c",
        ),
        trace=lambda trace_id: TRACE if trace_id == "pt_31c" else None,
        operator=lambda mission_id: "GWR",
    )  # fmt: skip


def by_name(ts: list[FunctionTool]) -> dict[str, FunctionTool]:
    return {t.name: t for t in ts}


async def invoke(t: FunctionTool, **arguments: Any) -> Any:
    result = await t.invoke(arguments=arguments)
    text = result[0].text if isinstance(result, list) else result
    return json.loads(text) if text and text[0] in "[{" else text


def test_binding_tools_need_approval_and_read_only_tools_do_not() -> None:
    ts = by_name(mission_tools(deps()))

    binding = {name for name, t in ts.items() if t.approval_mode == "always_require"}

    assert binding == set(BINDING_SCOPES)
    assert {"get_case_capsule", "log_stall", "record_reference"}.isdisjoint(binding)


def test_every_binding_tool_takes_an_idempotency_key() -> None:
    for name, t in by_name(mission_tools(deps())).items():
        if name in BINDING_SCOPES:
            assert "idempotency_key" in t.parameters()["properties"], name


async def test_binding_tools_emit_function_approval_request(
    scripted: Callable[..., ScriptedModel],
) -> None:
    claims = SimulatedClaims()
    model = scripted(
        tool_call(
            "file_claim", mission_id="m_1", proof_trace_id="pt_31c", idempotency_key="m_1:pt_31c"
        ),
        say("Filed."),
    )
    agent = Agent(model.client(), instructions="File the claim.", tools=mission_tools(deps(claims)))

    response = await agent.run("Claim my Delay Repay.")

    [request] = response.user_input_requests
    assert request.type == "function_approval_request"
    assert request.function_call.name == "file_claim"
    assert claims.calls == 0  # nothing is filed until the person approves


async def test_idempotent_file_claim_second_call_is_noop() -> None:
    claims = SimulatedClaims()
    file_claim = by_name(mission_tools(deps(claims)))["file_claim"]
    args = {"mission_id": "m_1", "proof_trace_id": "pt_31c", "idempotency_key": "m_1:pt_31c"}

    first = await invoke(file_claim, **args)
    second = await invoke(file_claim, **args)

    assert first == second
    assert claims.calls == 1


async def test_the_claim_amount_comes_from_the_proof_trace() -> None:
    file_claim = by_name(mission_tools(deps()))["file_claim"]

    receipt = await invoke(
        file_claim, mission_id="m_1", proof_trace_id="pt_31c", idempotency_key="k"
    )
    missing = await invoke(
        file_claim, mission_id="m_1", proof_trace_id="pt_nope", idempotency_key="k2"
    )

    assert Decimal(receipt["amount_gbp"]) == Decimal("14.20")
    assert receipt["simulated"] is True
    assert missing == {"error": "no such Proof Trace"}


async def test_offers_and_shares_are_idempotent_too() -> None:
    d = deps()
    ts = by_name(mission_tools(d))

    for _ in range(2):
        await invoke(
            ts["accept_offer"],
            mission_id="m_1",
            kind="cash",
            amount_gbp="14.20",
            idempotency_key="o1",
        )
        await invoke(
            ts["share_with_helper"], mission_id="m_1", helper_id="h_amir", idempotency_key="s1"
        )

    assert d.accepted == {"o1": {"mission_id": "m_1", "kind": "cash", "amount_gbp": "14.20"}}
    assert list(d.shared) == ["s1"]


async def test_read_only_tools_log_and_read() -> None:
    d = deps()
    ts = by_name(mission_tools(d))

    capsule = await invoke(ts["get_case_capsule"], mission_id="m_1")
    await invoke(ts["log_stall"], mission_id="m_1", category="hold_extension", quote="Please hold.")
    await invoke(ts["record_reference"], mission_id="m_1", reference="GWR-48213")
    no_phone = await invoke(ts["phone_company"], mission_id="m_1", idempotency_key="c1")

    assert capsule["proof_trace_id"] == "pt_31c"
    assert d.stalls[0]["category"] == "hold_extension"
    assert d.references == [{"mission_id": "m_1", "reference": "GWR-48213"}]
    assert no_phone == {"error": "phone calls are not set up"}


class SlowClaims:
    async def file_claim(self, **kwargs: Any) -> ClaimReceipt:
        await asyncio.sleep(5)
        raise AssertionError("never reached")


async def test_tool_timeouts_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    assert tools_module.TOOL_TIMEOUT_S <= 30
    monkeypatch.setattr(tools_module, "TOOL_TIMEOUT_S", 0.05)
    file_claim = by_name(mission_tools(deps(SlowClaims())))["file_claim"]

    with pytest.raises(TimeoutError):
        await file_claim.invoke(
            arguments={"mission_id": "m", "proof_trace_id": "pt_31c", "idempotency_key": "k"}
        )
