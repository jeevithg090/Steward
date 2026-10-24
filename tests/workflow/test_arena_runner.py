"""The text-mode Arena runner with two scripted agents (S4.3): plumbing, not model quality."""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from pathlib import Path

from agent_framework import Agent

from tempo_core.models import ContextCapsule
from tempo_missions.arena import load_scenarios, run_text_scenario, score
from tempo_missions.tools import ToolDeps, mission_tools
from tempo_ports.claims import SimulatedClaims

from .conftest import ScriptedModel, say, tool_call

SCENARIOS = Path(__file__).resolve().parents[2] / "evals" / "arena" / "scenarios.yaml"


async def test_a_scripted_call_is_recorded_and_scored(
    scripted: Callable[..., ScriptedModel],
) -> None:
    lowball = next(s for s in load_scenarios(SCENARIOS) if s.id == "lowballer-cash")
    deps = ToolDeps(
        claims=SimulatedClaims(),
        capsule=lambda m: ContextCapsule(
            mission_id=m, goal="g", display_name="Margaret", time_value_gbp_h=Decimal(18)
        ),
        trace=lambda _: None,
        operator=lambda _: "GWR",
    )
    negotiator_model = scripted(
        say("Hello, I'm Tempo, an AI assistant calling on behalf of Margaret about Delay Repay."),
        tool_call("log_stall", mission_id="m_1", category="lowball_offer", quote="Ten pounds cash"),
        tool_call("record_reference", mission_id="m_1", reference="GW-12345"),
        say("Thank you, that's reference GW-12345."),
    )
    company_model = scripted(
        say("Ten pounds is really the most I can do."), say("Fine. Reference GW-12345.")
    )
    tools = [t for t in mission_tools(deps) if t.name in {"log_stall", "record_reference"}]
    negotiator = Agent(negotiator_model.client(), instructions="negotiate", tools=tools)
    company = Agent(company_model.client(), instructions="stall")

    record = await run_text_scenario(lowball, negotiator=negotiator, company=company, deps=deps)

    assert len(record.negotiator_turns) == 2
    assert record.references == ("GW-12345",)
    assert score(lowball, record).won
