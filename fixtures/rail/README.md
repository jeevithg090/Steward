# Rail fixtures

**Everything here is synthetic until it's recorded.** The files follow each API's documented
shape so the parsers and the demo can be built before the keys arrive:

| Folder | What | Used by |
|---|---|---|
| `hsp/` | HSP `serviceMetrics` and `serviceDetails` responses | contract tests |
| `rtt/` | Realtime Trains `/gb-nr/location` and `/gb-nr/service` responses | contract tests |
| `replay/` | Parsed journeys (`ServiceDelay`), one per file | `TEMPO_MODE=replay` |

Synthetic journeys use made-up ids (RID `2026102300000xx`, RTT identity `X000xx`), and their
`source` starts with `synthetic:` so a Proof Trace can never present them as official data.

## Record real ones

With `RTT_TOKEN` and/or the `HSP_*` settings in `.env`:

```bash
uv run python scripts/record_rail.py OXF PAD 2026-10-23 08:12 17:42
```

That saves the raw responses under `hsp/` or `rtt/` and the parsed journey under `replay/`
(with the real source, e.g. `hsp:RID:…`). Then remove the synthetic files you've replaced.
