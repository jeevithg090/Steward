# Tenant packages

A tenant package is a folder of five YAML files that makes Steward someone's own: its name and
colour, its agent and what that agent is for, its skills, its extra rules and its model. The code
underneath stays the same, so fixes to Steward keep reaching every package.

| Folder                | What it is                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`steward/`](steward) | Steward itself: a proactive steward for mail, calendar and errands. Loaded by default.                                                                        |
| [`tempo/`](tempo)     | An example of making it your own: Tempo wins back money and time (Delay Repay claims, scam checks, subscription audits) and never pays or types bank details. |

Choose one with `STEWARD_TENANT`:

```sh
STEWARD_TENANT=tempo pnpm dev
```

Each folder holds `brand.yaml`, `agents.yaml`, `skills.yaml`, `rules.yaml` and `model.yaml`. Every
file is optional, and a missing one falls back to Steward's defaults. A file that is there but
wrong stops the server at start-up with the file and the field, because a silently ignored typo in a
rule is a rule that does not apply.

The full guide, with every field, is [docs/make-it-your-own.md](../docs/make-it-your-own.md).
