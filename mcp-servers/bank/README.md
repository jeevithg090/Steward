# tempo-mcp-bank

A read-only MCP server over a CSV bank statement: Tempo's bank connector. It lists
transactions; nothing here moves money, pays anyone or changes the account.

| Tool | Input | Output |
|---|---|---|
| `list_transactions` | `since: str \| None = None` (ISO date), `limit: int = 50` | `[{id, date, description, amount_gbp}]`, newest first |

- It reads `statement.csv` in the data folder: columns `date,description,amount` (any case),
  amounts signed with money in positive. Lines starting with `#` are comments; dates may be ISO
  (`2026-10-09`) or UK style (`09/10/2026`); amounts may carry `£` or thousands commas.
- `amount_gbp` is a string, signed, with two decimals: `"+23.40"` in, `"-45.00"` out.
- `date` is an ISO date. Same-day rows come latest row first. `since` keeps rows on or after it.
- `id` is a hash of the row (`tx_` and 16 hex digits), the same on every read; identical rows
  (two coffees on one day) get different ids.
- The tool is annotated read-only, not destructive, idempotent and closed-world, and has an
  output schema. The list comes back as `structuredContent: {"result": [...]}`.

## Run it

The data folder is `TEMPO_CONNECTOR_DATA`; by default `fixtures/connectors/bank/` under
`TEMPO_HOME` or this repository (Margaret's invented October statement).

```bash
uv run tempo-mcp-bank                                   # stdio, from the repository
uv run python -m tempo_mcp_bank                         # the same
TEMPO_CONNECTOR_DATA=/path/to/statement-folder uv run tempo-mcp-bank
claude mcp add tempo-bank -- uv run --directory "$PWD" tempo-mcp-bank
```

Installed outside the repository, set `TEMPO_CONNECTOR_DATA` (or `TEMPO_HOME`).
