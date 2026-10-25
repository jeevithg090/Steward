# tempo-mcp-calendar

A read-only MCP server over a folder of `.ics` files: Tempo's calendar connector. It lists
events; nothing here adds, moves or deletes one, or answers an invitation.

| Tool | Input | Output |
|---|---|---|
| `list_events` | `start: str`, `end: str` (ISO dates or dates and times) | `[{uid, title, start, end, location, description}]`, earliest first |

- It returns the events that **begin** in `[start, end)`, from every `.ics` file in the folder.
  `start` and `end` with no UTC offset mean UK time; `end` must be after `start`.
- A timed event's `start` and `end` are ISO 8601 with their offset (`2026-10-19T08:00:00+01:00`);
  an all-day event's are dates (`2026-10-27`, with `end` the day after, as iCalendar has it).
- The iCalendar reader (`tempo_mcp_calendar.ics`) is our own, with no dependency: folded lines,
  escaped text, `DTSTART`/`DTEND` as a date, in UTC (`Z`), with a `TZID` (Olson names and
  Outlook's "GMT Standard Time"), or floating (read as UK time), and `DURATION` when there is no
  `DTEND`. It reads only the VEVENT's own properties (not its VALARMs' or a VTIMEZONE's). A
  recurring event (`RRULE`) is read as its first occurrence only; a cancelled one is left out.
  Without a time-zone database (a slim container) it falls back to the UK's own rules.
- The tool is annotated read-only, not destructive, idempotent and closed-world, and has an
  output schema. The list comes back as `structuredContent: {"result": [...]}`.

## Run it

The data folder is `TEMPO_CONNECTOR_DATA`; by default `fixtures/connectors/calendar/` under
`TEMPO_HOME` or this repository (Margaret's invented calendar).

```bash
uv run tempo-mcp-calendar                               # stdio, from the repository
uv run python -m tempo_mcp_calendar                     # the same
TEMPO_CONNECTOR_DATA=/path/to/ics-folder uv run tempo-mcp-calendar
claude mcp add tempo-calendar -- uv run --directory "$PWD" tempo-mcp-calendar
```

Installed outside the repository, set `TEMPO_CONNECTOR_DATA` (or `TEMPO_HOME`).
