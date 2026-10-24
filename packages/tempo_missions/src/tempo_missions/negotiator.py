"""The Negotiator in text mode: the voice agent's prompt (rendered from its YAML by the caller),
with the same tools and Harness.

The voice Negotiator runs on ElevenLabs and reaches Tempo through the Gateway's server tools.
This builds the equivalent MAF agent, so its policy and tool path can be tested against scripted
company transcripts and evaluated against the Sludge Arena without a phone line.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from decimal import Decimal
from typing import Any

from agent_framework import Agent, FunctionTool

from tempo_core.consent import ConsentState
from tempo_core.models import ProofTrace
from tempo_harness.bundle import Implementation, build_harness
from tempo_harness.policies import (
    ConsentScopeGuard,
    InjectionShield,
    PIIEgressRedactor,
    Policy,
    ProofRequired,
    SettlementGuard,
)
from tempo_missions.tools import BINDING_SCOPES, ToolDeps, mission_tools

TOOLS = frozenset({"get_case_capsule", "log_stall", "record_reference", "accept_offer"})


def negotiator_policies(
    *,
    entitlement: Callable[[], Decimal | None],
    consent: Callable[[], ConsentState],
    traces: Callable[[str], ProofTrace | None],
) -> list[Policy]:
    return [
        ConsentScopeGuard(BINDING_SCOPES, consent),
        SettlementGuard(entitlement, consent),
        ProofRequired(traces),
        InjectionShield(),
        PIIEgressRedactor(),
    ]


def build_negotiator(
    client: Any,
    deps: ToolDeps,
    *,
    instructions: str,
    policies: Sequence[Policy],
    implementation: Implementation = "agent_hooks",
) -> Agent:
    tools: list[FunctionTool] = [
        t for t in mission_tools(deps, standing=frozenset({"accept_offer"})) if t.name in TOOLS
    ]
    return Agent(
        client,
        instructions=instructions,
        name="negotiator",
        tools=tools,
        middleware=build_harness(policies, implementation=implementation),
    )
