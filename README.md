# Tempo

**Your time, returned.** Tempo is an open-source personal AI agent that handles life's admin and
wins back the money and hours companies waste. Its flagship skill pack, **Clawback**, finds the
compensation you're owed, works it out from published rules, claims it and checks it arrives.

> Built at OxHack 26. Status: under construction (Phase 0 of the build plan).

## Run it

```bash
make setup   # uv sync, pre-commit hooks, local services (Docker, if installed)
make check   # lint, types and fast tests (< 60 s)
make doctor  # checks every key and service with one cheap call
```

## Layout

| Path | What lives there |
|---|---|
| `packages/tempo_core` | Domain core: pure Python, no I/O, fully unit-tested |
| `packages/tempo_ports` | Ports (`typing.Protocol`) plus Replay implementations |
| `packages/tempo_adapters` | One module per vendor, each behind a port |
| `packages/tempo_harness` | Guardrails as code (Agent Hooks interceptors), budgets |
| `packages/tempo_missions` | Mission workflows on Microsoft Agent Framework |
| `packages/tempo_memory` | Memory Gate, context provider, Mem0 and Graphiti stores |
| `packages/tempo_crypto` | Envelope encryption and device-held keys |
| `docs/adr` | Architecture decision records |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the coding standards and the merge-request rules.

## License

Apache-2.0
