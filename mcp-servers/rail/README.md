# tempo-mcp-rail

An MCP server with one read-only tool, `get_service_delay`: given an origin and destination
station code, a date and the timetabled departure, it returns the scheduled and actual arrival
and the delay in minutes. Live mode asks National Rail HSP first and Realtime Trains when HSP
can't answer; `TEMPO_MODE=replay` serves recorded journeys with no network.

```bash
uvx --from ./mcp-servers/rail tempo-mcp-rail      # stdio
claude mcp add tempo-rail -- uvx --from ./mcp-servers/rail tempo-mcp-rail
```

Settings come from the environment or `.env` (`RTT_TOKEN`, `HSP_*`, `TEMPO_MODE`).
