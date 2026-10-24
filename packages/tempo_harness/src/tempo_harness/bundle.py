"""Build the Harness for an agent: Agent Hooks interceptors, or the plain-middleware fallback.

Place the result first in `Agent(middleware=[...])`, so every tool call and reply passes
through the policies (spec §16.6).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal

from agent_framework import create_agent_hooks_middleware

from tempo_harness.audit import AuditSink
from tempo_harness.fallback_middleware import PolicyFunctionMiddleware, PolicyOutputMiddleware
from tempo_harness.hooks_adapter import PolicyInterceptor, audit_record
from tempo_harness.policies import Policy

Implementation = Literal["agent_hooks", "fallback"]
Mode = Literal["enforce", "evaluate_only"]


def build_harness(
    policies: Sequence[Policy],
    *,
    implementation: Implementation = "agent_hooks",
    mode: Mode = "enforce",
    audit: AuditSink | None = None,
) -> list[Any]:
    """The middleware list for one agent. `evaluate_only` records decisions without acting."""
    if not policies:
        raise ValueError("a harness needs at least one policy")
    enforce = mode == "enforce"
    if implementation == "fallback":
        return [
            PolicyOutputMiddleware(policies, enforce=enforce, audit=audit),
            PolicyFunctionMiddleware(policies, enforce=enforce, audit=audit),
        ]

    def sink(record: Any) -> None:
        if audit is not None and (translated := audit_record(record, enforced=enforce)) is not None:
            audit(translated)

    interceptors = {policy.name: PolicyInterceptor(policy) for policy in policies}
    return [create_agent_hooks_middleware(interceptors, mode=mode, record_sink=sink)]
