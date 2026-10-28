# @steward/bots

The bot pack format from [docs/plans/bot-directory.md](../../docs/plans/bot-directory.md): reading
and writing packs, skills in the open [Agent Skills](https://agentskills.io/specification)
`SKILL.md` format, the content hash, the checks a pack must pass, the bridge to and from tenant
packs, and the client and builder for a directory index.

A bot is a folder:

```
rent-scout/
├── bot.yaml                  # id, name, pitch, category, version, author, licence, needs,
│                             # instructions, starters, examples, skills (folder names), rules,
│                             # routines, shortcuts, hash?
├── README.md                 # the listing text, Markdown, written for people
└── skills/
    └── find-rentals/
        └── SKILL.md          # Agent Skills: name, description, license?, compatibility?,
                              # metadata?, allowed-tools?; then the instructions
```

What `buildIndex` makes from a folder of them:

```
directory/
├── bots/<id>/…               # the sources above
├── categories.yaml           # optional: id → label; BOT_CATEGORIES otherwise
├── counts.json               # optional: { "<id>": { "installs": n, "usedBy": n } }
├── index.json                # { name, site?, generatedAt, categories, bots: BotListing[] }
└── packs/<id>.json           # one BotPack each, with its hash; packUrl in the index is relative
```

The shapes (`BotPackSchema`, `SkillPackSchema`, `BotListing`, `DirectoryIndex`, `BotsQuery`) live
in `@steward/shared`.

## Exports

| Export                                              | What it does                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parseSkillMd(text)`                                | `SKILL.md` → `SkillPack`. Frontmatter fields as the spec names them; `allowed-tools` becomes `allowedTools`. Throws `SkillMdError` with `.field`.                                                                  |
| `serializeSkillMd(skill)`                           | The inverse; `parseSkillMd(serializeSkillMd(s))` is `s` again.                                                                                                                                                     |
| `parseBotFolder(dir)`                               | A folder → validated `BotPack`. Unknown `bot.yaml` fields, a missing skill, or a skill whose `name` is not its folder are `BotPackError`s naming the file and field.                                               |
| `writeBotFolder(dir, pack)`                         | The inverse. Empty lists are left out of `bot.yaml`.                                                                                                                                                               |
| `canonicalPack(pack)`, `hashPack(pack)`             | Stable JSON (schema defaults filled, keys sorted at every depth, lists in order, `hash` left out) and its sha256 hex.                                                                                              |
| `validatePack(pack, ctx)`                           | Everything below. `ctx.tools` are the names this Steward has; `ctx.validateRule` is the gateway's rule check; `ctx.connectors` warns about ones not connected. Returns `{ ok, pack?, problems }`.                  |
| `scanForInjection(text)`                            | Hits with a pattern name and an excerpt. Used by `validatePack`; exported for the generator and the server.                                                                                                        |
| `packFromTenant(tenant, agentId?)`                  | A tenant's agent as a pack: instructions, skills as `SKILL.md`, its ask and deny rules, starters, tools with `*` spelled out (display tools and the secret box left out). Tempo is `money`; others `productivity`. |
| `profileFromPack(pack)`                             | The agent an installed pack becomes: `source: bot:<id>`, the pack's tools and skill names.                                                                                                                         |
| `describeMayDo(tools)`                              | "What it may do without asking" lines from `TOOL_PLAIN_WORDS`, once each, with the "asks first" ones left out.                                                                                                     |
| `new DirectoryClient({ source, fetch?, cacheMs? })` | `index()` (cached, 5 min by default), `list(query)` (ranked), `get(id)`, `pack(listingOrUrl)`, `invalidate()`.`source` is an https URL or a path to `index.json`.                                                  |
| `buildIndex(dir, { name?, site? })`                 | Scans `<dir>/bots/*/`, validates with the built-in catalogue and the gateway's `CelEngine`, skips bad folders with a `console.warn`, writes `packs/<id>.json` and `index.json`.                                    |

## What `validatePack` checks

Errors (the pack is refused):

- the schema: ids, lengths, at most 8 starters and examples, 12 skills and rules;
- every `needs.tools` entry is a tool this Steward has (`*` is not allowed in a pack);
- every rule is `ask` or `deny` ("A bot can only tighten the rules") and passes the gateway's
  own check, whose message is shown;
- skill names are unique and valid;
- no text that reads as orders for the model, in instructions, README, skill bodies and examples:
  "ignore previous instructions", "you are now", "system prompt", "disregard", "do not tell the
  user", "forward … to", base64 over 200 characters, zero-width characters, `{{template}}` tokens;
- no personal data in instructions or skills: email addresses (RFC 2606 example domains and role
  mailboxes such as `report@` or `support@` are fine), phone numbers, card-like digit runs;
- an AI author names its model and the date it was generated.

Warnings (shown, not blocking):

- a skill's `allowed-tools` names a tool outside `needs.tools`;
- a needed connector is not connected here;
- a sentence over 35 words, or jargon ("leverage", "synergy", "going forward", …).

## Ranking in `DirectoryClient.list`

With `q`, each listing is scored by word overlap: name matches count 3, category 2, pitch 1
(prefix matches count less); listings that match nothing are left out. Ties go to installs, then
"I use this" counts, then the newest. `sort=new|used|installs` puts that key first; `match` is
the default. `category`, `limit` and `offset` work as the shared `BotsQuery` says.

`pack()` resolves a relative `packUrl` against the index: a URL for a web index, a path inside the
folder for a disk index. A web index may never point at a `file:` pack. The pack is checked against
the schema, and when it carries a hash, the hash must match its content ("pack changed since it
was listed").

## Tests

```sh
pnpm vitest run packages/bots
pnpm --filter @steward/bots typecheck
pnpm biome check packages/bots
```
