"""The only module that knows the Agent Hooks (AGENT-HOOKS-0.1) context and verdict shapes.

If the experimental SDK changes its payloads, this file is the one to fix (docs/adr/0001).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from agent_hooks import Decision as HooksDecision
from agent_hooks import InterceptionRecord, Transform, Verdict

from tempo_harness.audit import AuditRecord
from tempo_harness.policies import Action, Decision, Point, Policy, Seen, evaluate

AgentContext = Mapping[str, Any]

_POINTS = {p.value: p for p in Point}
# Where each point's subject sits in the context's target, for transforms.
_TRANSFORM_PATHS = {
    Point.PRE_TOOL: "$target",
    Point.POST_TOOL: "$target",
    Point.OUTPUT: "$target.content",
}


def point(ctx: AgentContext) -> str:
    return str(ctx.get("interception_point", ""))


def tool_name(ctx: AgentContext) -> str | None:
    name = (ctx.get("tool_call") or {}).get("name")
    return str(name) if name is not None else None


def tool_args(ctx: AgentContext) -> Mapping[str, Any]:
    args = (ctx.get("tool_call") or {}).get("args")
    return args if isinstance(args, Mapping) else {}


def tool_result(ctx: AgentContext) -> Any:
    return (ctx.get("tool_result") or {}).get("value")


def output_content(ctx: AgentContext) -> Any:
    return (ctx.get("output") or {}).get("content")


def mission_id(ctx: AgentContext) -> str | None:
    mission = ctx.get("mission")
    return str(mission["id"]) if isinstance(mission, Mapping) and "id" in mission else None


def seen(ctx: AgentContext) -> Seen | None:
    """What a policy sees at this point, or None at points Tempo doesn't police."""
    at = _POINTS.get(point(ctx))
    if at is None:
        return None
    return Seen(
        at,
        tool=tool_name(ctx),
        args=tool_args(ctx),
        result=tool_result(ctx),
        content=output_content(ctx),
    )


def to_verdict(decision: Decision, at: Point) -> Verdict:
    if decision.action is Action.ALLOW:
        return Verdict.allow()
    if decision.action is Action.DENY:
        return Verdict.deny(reason=decision.reason, message=decision.message)
    if decision.action is Action.ESCALATE:
        return Verdict.escalate(reason=decision.reason, message=decision.message)
    return Verdict(
        decision=HooksDecision.TRANSFORM,
        reason=decision.reason,
        transform=Transform(path=_TRANSFORM_PATHS[at], value=decision.replacement),
    )


class PolicyInterceptor:
    """Adapts one Tempo policy to the Agent Hooks Interceptor protocol."""

    def __init__(self, policy: Policy) -> None:
        self.policy = policy

    def intercept(self, context: AgentContext, /) -> Verdict:
        s = seen(context)
        if s is None or s.point not in self.policy.points:
            return Verdict.allow()
        decision, _ = evaluate([self.policy], s)  # a raising policy becomes a deny
        return to_verdict(decision, s.point)


def audit_record(record: InterceptionRecord, *, enforced: bool) -> AuditRecord | None:
    """Translate an SDK interception record; None for points Tempo doesn't police."""
    at = record.interception_point.value
    if at not in _POINTS:
        return None
    verdict = record.verdict
    decision = verdict.decision.value
    if verdict.is_liftable:
        decision = Action.ESCALATE.value
    # SDK records are payload-free by design, so they carry no tool name.
    return AuditRecord(at, None, decision, verdict.reason, enforced)
