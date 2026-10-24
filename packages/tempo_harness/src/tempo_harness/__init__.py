"""The Harness: guardrails as code that wrap every agent action.

Policies are pure and fail closed. The Agent Hooks payload shape is known in exactly one module.
`MandateGuard` lives in `policies_mandate` (policies.py is near its 300-line limit) and is
re-exported here: `from tempo_harness import MandateGuard`."""

from tempo_harness.policies_mandate import TOOL_ACTIONS, MandateGuard

__all__ = ["TOOL_ACTIONS", "MandateGuard"]
