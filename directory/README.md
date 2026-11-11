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
  the gateway, never loosen it. A rule that could never fire is refused too, and one that none of
  the bot's tools can trigger, or that refuses its own tools, is a warning.
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
```

`build` validates every pack again, with the gateway's own rule engine, and skips any that fail,
saying why. It also removes the built pack of a folder that is gone or now fails, so nothing in
`packs/` can be installed that the index does not list.

A listing's `updatedAt` is when the bot's content last changed, not when its files were touched.
A bot whose content hash matches the last build keeps that build's date, so a fresh clone, a
checkout or a rebuild with nothing changed leaves `index.json` and `packs/` exactly as they were.
A bot that changed gets the time of the build; a new AI-made bot gets the day it was generated.

`packages/bots/test/shipped-directory.test.ts` fails when what is committed here does not match
what `build` would write. See `packages/bots-gen/README.md`.
