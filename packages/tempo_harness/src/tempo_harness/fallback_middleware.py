"""TEMPO_HOOKS=fallback: the same policies as plain MAF middleware, for when Agent Hooks breaks.

Tool seam: a blocked call never runs, and the model gets the reason as the tool result. Output:
transforms (e.g. PII redaction) rewrite the final reply's text.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from agent_framework import (
    AgentContext,
    AgentMiddleware,
    FunctionInvocationContext,
    FunctionMiddleware,
)
from pydantic import BaseModel

from tempo_harness.audit import AuditRecord, AuditSink
from tempo_harness.policies import Action, Decision, Point, Policy, Seen, evaluate


def _blocked_result(decision: Decision) -> str:
    verb = "needs the person's approval" if decision.action is Action.ESCALATE else "was refused"
    return f"This action {verb} ({decision.reason}). {decision.message or ''}".strip()


class _Base:
    def __init__(
        self, policies: Sequence[Policy], *, enforce: bool, audit: AuditSink | None
    ) -> None:
        self._policies = tuple(policies)
        self._enforce = enforce
        self._audit = audit

    def _decide(self, seen: Seen) -> Decision:
        decision, trail = evaluate(self._policies, seen)
        if self._audit is not None and trail:
            self._audit(
                AuditRecord(
                    seen.point.value,
                    seen.tool,
                    decision.action.value,
                    decision.reason,
                    self._enforce,
                )
            )
        return decision


class PolicyFunctionMiddleware(_Base, FunctionMiddleware):
    async def process(
        self, context: FunctionInvocationContext, call_next: Callable[[], Awaitable[None]]
    ) -> None:
        tool = context.function.name
        args = _args(context.arguments)
        decision = self._decide(Seen(Point.PRE_TOOL, tool=tool, args=args))
        if self._enforce and decision.blocks:
            context.result = _blocked_result(decision)
            return  # the tool never runs
        await call_next()
        decision = self._decide(
            Seen(Point.POST_TOOL, tool=tool, args=args, result=_text(context.result))
        )
        if not self._enforce:
            return
        if decision.blocks:
            context.result = _blocked_result(decision)
        elif decision.action is Action.TRANSFORM:
            context.result = str(decision.replacement)


class PolicyOutputMiddleware(_Base, AgentMiddleware):
    async def process(
        self, context: AgentContext, call_next: Callable[[], Awaitable[None]]
    ) -> None:
        await call_next()
        response = context.result
        text = getattr(response, "text", None)
        if not isinstance(text, str) or not text:
            return
        decision = self._decide(Seen(Point.OUTPUT, content=text))
        if self._enforce and decision.action is Action.TRANSFORM and response is not None:
            from agent_framework import Content

            messages = getattr(response, "messages", [])
            if messages:
                messages[-1].contents = [Content.from_text(str(decision.replacement))]
                for earlier in messages[:-1]:
                    earlier.contents = [
                        c for c in earlier.contents if getattr(c, "type", "") != "text"
                    ]


def _args(arguments: BaseModel | Mapping[str, Any]) -> dict[str, Any]:
    return arguments.model_dump() if isinstance(arguments, BaseModel) else dict(arguments)


def _text(result: Any) -> Any:
    if isinstance(result, list):
        parts = [getattr(item, "text", None) for item in result]
        if all(isinstance(p, str) for p in parts):
            return "".join(p for p in parts if p)
    return result
