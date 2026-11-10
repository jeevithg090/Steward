# Tenant packages

A tenant package is a folder of YAML files that makes Steward someone's own: its name and colour,
its agents and what they are for, its skills, its extra rules, its model, the coding agents it may
run and its phone shortcuts. The code underneath stays the same, so fixes to Steward keep reaching
every package.

| Folder                | What it is                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`steward/`](steward) | Steward itself: a proactive steward for mail, calendar and errands. Loaded by default.                                                                        |
| [`tempo/`](tempo)     | An example of making it your own: Tempo wins back money and time (Delay Repay claims, scam checks, subscription audits) and never pays or types bank details. |

Choose one with `STEWARD_TENANT`:

```sh
STEWARD_TENANT=tempo STEWARD_DATA_DIR=.steward-data/tempo pnpm dev
```

The data folder keeps Tempo's conversations, memory and rules apart from Steward's.

| File             | What it holds                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `brand.yaml`     | The name, the tagline, the accent colour, the voice and the starters on Today.                               |
| `agents.yaml`    | The agents, their standing instructions, tools and, if they want one, their own model.                       |
| `skills.yaml`    | Instructions called with `/name`.                                                                            |
| `rules.yaml`     | Extra rules, in CEL. They can make Steward stricter, never looser.                                           |
| `model.yaml`     | The default model.                                                                                           |
| `harnesses.yaml` | The coding agents it may run, such as Claude Code. See [docs/harnesses.md](../docs/harnesses.md#adding-one). |
| `shortcuts.yaml` | Its own phone shortcuts, such as Tempo's Delay Spotter. See [docs/phone.md](../docs/phone.md).               |

Every file is optional, and a missing one means Steward's built-in defaults, not the files in
`steward/`. A file that is there but wrong stops the server at start-up with the file, the line and
the field, because a silently ignored typo in a rule is a rule that does not apply.

The full guide, with every field, is [docs/make-it-your-own.md](../docs/make-it-your-own.md).
