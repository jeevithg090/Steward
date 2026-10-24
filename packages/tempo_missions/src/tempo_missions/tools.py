"""The tools Tempo's agents can call (build plan S3.2).

Binding tools change something in the world, so MAF asks for approval before every call
(`approval_mode="always_require"`) and the Harness checks consent first. Each takes an
idempotency key, so a retried or replayed call happens once. Read-only tools never need approval.
Every tool runs under a timeout.

Claims never take an amount from the model: `file_claim` reads it from the Proof Trace.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from agent_framework import FunctionTool, tool

from tempo_core.models import ContextCapsule, ProofTrace
from tempo_ports.claims import ClaimsPort

TOOL_TIMEOUT_S = 20.0

# Binding tool -> the consent scope it needs (for ConsentScopeGuard).
BINDING_SCOPES = {
    "file_claim": "file_claim",
    "phone_company": "phone_company",
    "accept_offer": "accept_offer",
    "share_with_helper": "share_with_helper",
}


@dataclass
class ToolDeps:
    claims: ClaimsPort
    capsule: Callable[[str], ContextCapsule]  # mission id -> its capsule
    trace: Callable[[str], ProofTrace | None]  # proof trace id -> the trace
    operator: Callable[[str], str]  # mission id -> the company being claimed from
    start_call: Callable[[str, str], Awaitable[str]] | None = None  # (mission, key) -> call id
    stalls: list[dict[str, str]] = field(default_factory=list)
    references: list[dict[str, str]] = field(default_factory=list)
    accepted: dict[str, dict[str, str]] = field(default_factory=dict)  # idempotency key -> offer
    shared: dict[str, dict[str, str]] = field(default_factory=dict)


async def _timed[T](work: Coroutine[Any, Any, T]) -> T:
    async with asyncio.timeout(TOOL_TIMEOUT_S):
        return await work


def mission_tools(deps: ToolDeps) -> list[FunctionTool]:
    @tool(
        name="file_claim",
        approval_mode="always_require",
        description="File the compensation claim backed by a Proof Trace. Needs approval.",
    )
    async def file_claim(mission_id: str, proof_trace_id: str, idempotency_key: str) -> str:
        trace = deps.trace(proof_trace_id)
        if trace is None:
            return json.dumps({"error": "no such Proof Trace"})
        receipt = await _timed(
            deps.claims.file_claim(
                operator=deps.operator(mission_id),
                mission_id=mission_id,
                proof_trace_id=proof_trace_id,
                amount_gbp=trace.amount_gbp,
                idempotency_key=idempotency_key,
            )
        )
        return receipt.model_dump_json()

    @tool(
        name="phone_company",
        approval_mode="always_require",
        description="Phone the company about this mission, with AI disclosure. Needs approval.",
    )
    async def phone_company(mission_id: str, idempotency_key: str) -> str:
        if deps.start_call is None:
            return json.dumps({"error": "phone calls are not set up"})
        call_id = await _timed(deps.start_call(mission_id, idempotency_key))
        return json.dumps({"call_id": call_id})

    @tool(
        name="accept_offer",
        approval_mode="always_require",
        description="Accept the company's offer (kind: cash or voucher). Needs approval.",
    )
    async def accept_offer(
        mission_id: str, kind: str, amount_gbp: str, idempotency_key: str
    ) -> str:
        offer = {"mission_id": mission_id, "kind": kind, "amount_gbp": str(Decimal(amount_gbp))}
        deps.accepted.setdefault(idempotency_key, offer)
        return json.dumps({"accepted": deps.accepted[idempotency_key]})

    @tool(
        name="share_with_helper",
        approval_mode="always_require",
        description="Share this mission's status with the person's chosen helper. Needs approval.",
    )
    async def share_with_helper(mission_id: str, helper_id: str, idempotency_key: str) -> str:
        deps.shared.setdefault(idempotency_key, {"mission_id": mission_id, "helper_id": helper_id})
        return json.dumps({"shared_with": deps.shared[idempotency_key]["helper_id"]})

    @tool(name="get_case_capsule", description="The mission's facts, entitlement and limits.")
    async def get_case_capsule(mission_id: str) -> str:
        return deps.capsule(mission_id).model_dump_json()

    @tool(name="log_stall", description="Record a stalling tactic the company used, with a quote.")
    async def log_stall(mission_id: str, category: str, quote: str) -> str:
        deps.stalls.append({"mission_id": mission_id, "category": category, "quote": quote})
        return "logged"

    @tool(name="record_reference", description="Record the case reference the company gave.")
    async def record_reference(mission_id: str, reference: str) -> str:
        deps.references.append({"mission_id": mission_id, "reference": reference})
        return "recorded"

    return [
        file_claim,
        phone_company,
        accept_offer,
        share_with_helper,
        get_case_capsule,
        log_stall,
        record_reference,
    ]
