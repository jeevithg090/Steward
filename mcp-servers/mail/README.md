# tempo-mcp-mail

A read-only MCP server over a folder of `.eml` files: Tempo's mail connector. It searches and
reads messages; nothing here sends, moves or deletes one, or follows a link. What a message says
is evidence for Tempo's code, never instructions.

| Tool | Input | Output |
|---|---|---|
| `search_messages` | `query: str = ""`, `since: str \| None = None` (ISO date or date and time), `limit: int = 20` | `[{id, from, subject, date, snippet}]`, newest first |
| `get_message` | `id: str` (from `search_messages`) | `{id, from, to, subject, date, text, attachments: [{filename, mime_type}]}` |

- A message's `id` is its file name without `.eml`. An unknown id is a tool error (`isError`).
- `query` matches when every word of it appears in the subject, the sender or the text, in any
  case; an empty query lists every message. `since` with no UTC offset means UK time.
- `date` is ISO 8601 with the message's offset, e.g. `2026-10-21T19:04:12+01:00`.
- `text` is the `text/plain` part, or the HTML part stripped to its words when there is no plain
  one. Attachments are listed, never opened.
- Both tools are annotated read-only, not destructive, idempotent and closed-world, and have an
  output schema. A list comes back as `structuredContent: {"result": [...]}`.

## Run it

The data folder is `TEMPO_CONNECTOR_DATA`; by default `fixtures/connectors/mail/` under
`TEMPO_HOME` or this repository (Margaret's invented mailbox, see
[`fixtures/connectors/README.md`](../../fixtures/connectors/README.md)).

```bash
uv run tempo-mcp-mail                                   # stdio, from the repository
uv run python -m tempo_mcp_mail                         # the same
TEMPO_CONNECTOR_DATA=/path/to/eml-folder uv run tempo-mcp-mail
claude mcp add tempo-mail -- uv run --directory "$PWD" tempo-mcp-mail
```

Installed outside the repository (`uvx --from ./mcp-servers/mail tempo-mcp-mail`), set
`TEMPO_CONNECTOR_DATA` (or `TEMPO_HOME`), since the default folder is found from the source tree.
