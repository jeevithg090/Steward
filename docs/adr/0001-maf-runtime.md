# ADR 0001: Microsoft Agent Framework is the agent runtime

- **Status:** accepted, 24 Oct 2026
- **Spec:** §16

## Context
Tempo's missions wait for days (a payment deadline), must survive restarts, and must stop for a
person's consent before anything binding. Guardrails have to fail closed. We had one weekend, so we
compared the agent runtimes on github.com/topics/multi-agent (spec §16.1) rather than writing one.

## Decision
Use **Microsoft Agent Framework** (`agent-framework`, MIT, GA 1.0) underneath the Conductor and the
Harness:
- **Workflows** with **checkpoints** run missions; a pending `request_info` is saved in the
  checkpoint and re-emitted on restore.
- **Agent Hooks** interceptors carry our policies (allow / deny / transform / escalate).
- `OpenAIChatCompletionClient` talks to Snowflake Cortex (ADR 0002).

Tempo writes the product logic (rules, consent, time value, Mesh, voice); MAF provides the runtime.

## Consequences
- Durable waits and consent checkpoints come for free, and the crash-and-resume test is cheap.
- Agent Hooks is a 0.x SDK, so its payload shape lives only in `tempo_harness/hooks_adapter.py`,
  and `TEMPO_HOOKS=fallback` swaps in plain function middleware. One policy suite covers both.
- Version-sensitive names stay in adapter files and are pinned in `uv.lock`.
- The domain core never imports MAF, so rules, consent and the Arbiter stay testable without it.
