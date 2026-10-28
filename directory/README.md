# The Steward bot directory

Ready-made bots for Steward (docs/plans/bot-directory.md). A bot is a **pack**: a folder with
`bot.yaml` (profile, starters, rules, routines, what it needs), `README.md` (the listing text,
written for people) and `skills/<name>/SKILL.md` in the Agent Skills format. Installing one adds
an agent to your Steward; removing it takes away what it brought and nothing else.

```
directory/
├── categories.yaml      the 19 jobs, keys from BOT_CATEGORIES
├── bots/<id>/           one folder per bot: bot.yaml, README.md, skills/
├── index.json           built: one listing per bot (what Steward reads)
├── packs/<id>.json      built: the full pack with its content hash
└── REPORT.md            built: counts and problems from the last seed run
```

`index.json` is what a Steward needs. The server's default `STEWARD_DIRECTORY_URL` is this
folder's `index.json`; a fork or a company can point it anywhere else.

## What a pack can and cannot do

- Its rules may only `ask` or `deny`. An `allow` is refused at validation; a pack can only tighten
  the gateway, never loosen it.
- Skills grant nothing; the agent holds what its profile grants, through the gateway.
- Instructions are untrusted text: shown to the person before Add, scanned for anything that reads
  as orders for the model, and never above the person or the gateway.
- Listing text is third-party. Steward treats it as data.

## Where the bots come from

| Source                                                                | Author label                               | Licence | Credit                                                               |
| --------------------------------------------------------------------- | ------------------------------------------ | ------- | -------------------------------------------------------------------- |
| AI-made from `packages/bots-gen/src/jobs.yaml`                        | `author.kind: ai`, model and date          | MIT     | Labelled "AI-made, not yet used by anyone" until someone installs it |
| [LobeHub's agent index](https://github.com/lobehub/lobe-chat-agents)  | `author.kind: person`, the original author | MIT     | Each README says "Adapted from LobeChat's agent index (MIT), by …"   |
| [CopilotKit OpenBot](https://github.com/CopilotKit/openbot) coworkers | `author.kind: person`, CopilotKit OpenBot  | MIT     | Each README credits OpenBot's coworker catalogue                     |

Everything in this folder is published under the MIT licence. The repository's `NOTICE` carries
the copyright lines. Converted packs keep their original author in `author`; a person can claim
and improve an AI-made bot, and the listing then says "based on an AI-made draft".

## Rebuilding

```
pnpm --filter @steward/bots-gen seed convert-openbot
pnpm --filter @steward/bots-gen seed convert-lobe
NVIDIA_API_KEY=… pnpm --filter @steward/bots-gen seed generate --limit 60
pnpm --filter @steward/bots-gen seed build
pnpm --filter @steward/bots-gen seed report --write
pnpm biome check --write directory
```

`build` validates every pack again, with the gateway's own rule engine, and skips any that fail,
saying why. The last line is there because biome formats Markdown and JSON: it adds blank lines
to the written `README.md` and `SKILL.md` files and reflows `packs/*.json`, none of which changes
a pack's content or hash. See `packages/bots-gen/README.md`.
