# Tempo

**Your time, returned.** Tempo is an open-source personal AI agent that handles life's admin and
wins back the money and hours companies waste. Its flagship skill pack, **Clawback**, finds the
compensation you're owed, works it out from published rules, claims it and checks it arrives.

> Built at OxHack 26. Status: the Clawback Rail mission runs end to end in replay mode.

## Run it

```bash
make setup         # uv sync, pre-commit hooks, local services (Docker, if installed)
make demo-dry-run  # Margaret's late train, claimed with consent, surviving a restart (no keys)
make check         # lint, types and fast tests (< 60 s)
make doctor        # checks every key and service with one cheap call
uv run tempo-gateway  # the Gateway on http://127.0.0.1:8000 (replay mode unless TEMPO_MODE=live)
```

Replay mode uses recorded (currently synthetic) rail data, an in-memory store and a simulated
company, so everything runs offline. `make test-int` needs a Postgres in `TEST_DATABASE_URL`
(or Docker).

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
| `apps/gateway` | FastAPI Gateway: REST, ElevenLabs tools, Twilio SMS, live WebSocket |
| `mcp-servers/rail` | MCP server: how late a UK train was (HSP, Realtime Trains, replay) |
| `skills/` | Rule packs (rights as code) per skill |
| `alembic/` | Database migrations |
| `docs/adr` | Architecture decision records |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the coding standards and the merge-request rules.

## License

Apache-2.0
