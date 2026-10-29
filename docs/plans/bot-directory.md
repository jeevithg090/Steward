# Plan: the Steward bot directory

**A free directory of ready-made bots for Steward, modelled on meetmybot.ai, seeded by AI so there
is something to add on day one, and open to anyone to list and claim.**

Status, 28 Oct 2026: **built**, except where §7 says otherwise. The pack format, installed bots,
the Bots page and picker, the generator and seeds, the hosted directory (`apps/directory`, see
[docs/directory.md](../directory.md)), retirement, meaning-based dedupe, taxonomy growth and
Submit to the directory are in the repository. What still needs a person is listed in
docs/directory.md under "What still needs a person". Companion plans:
[phone-and-shortcuts.md](phone-and-shortcuts.md) (the catalogue it shares with the phone) and
[orchestration.md](orchestration.md) (other agents and models a bot may run on).

What was studied, on 27–28 Oct 2026:

- **meetmybot.ai**, read page by page: the home, FAQ, browse, submit and connector pages, one
  listing, `/api/bots.json` and `/llms.txt`. It is a directory of Grok Bot templates made by
  people on X: 395 live listings in 18 job categories, each with a pitch, "what it does", "what
  you need" (connectors), the creator's handle, the original X post and a **Try it** link that
  opens the template in Grok. Listing is free with no paid placement; ranking comes from "I use
  this" votes and X engagement; creators submit by signing in with X and claim their listings;
  every submission is reviewed. Agents can search it through a remote MCP server (`find_bots`,
  `get_bot`, `latest`, `list_categories`, `submit_bot`), a JSON API and an RSS feed.
- Open-source catalogues we can seed from (§2).

---

## 0. The short version

**What a visitor sees:** a **Bots** page, in the app and on the web, with bots sorted by job:
"Rent scout", "Landlord letters", "Fantasy football coach", "Inbox zero for freelancers". Each
listing says what the bot does, what it needs (mail, calendar, the browser, a connector), what it
may do without asking, and who made it. **Add to Steward** installs it in one tap into the
person's own Steward, where it becomes an agent they can pick in a new conversation. Nothing to
copy, nothing to configure.

**What is different from meetmybot:**

|                         | meetmybot.ai                                                      | Steward directory                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What a listing is       | A link to a Grok Bot someone built; you copy it by hand into Grok | A **bot pack** (profile, skills, rules, starters, routines, shortcuts) that installs itself into your Steward                                                                                          |
| Who makes them          | People on X; the directory waits for submissions                  | **AI generates the first thousands** from a job taxonomy, each checked by rules and the gateway, labelled "AI-made"; people submit, claim and improve them, and real use ranks them above AI-made ones |
| Where it runs           | Grok, on xAI's servers                                            | Your machine, on any model you chose, through Steward's gateway and record                                                                                                                             |
| Trust                   | "Treat listing text as untrusted"                                 | Same, plus: a pack can only **tighten** the gateway, never loosen it, and the app shows what each bot may do before you add it                                                                         |
| Finding bots from a bot | A remote MCP connector                                            | The same: `find_bots` as a built-in Steward tool and a remote MCP server for other agents                                                                                                              |

**Decisions:**

1. **A bot is a pack, not a prompt.** The unit is a folder: `bot.yaml` (profile, starters, rules,
   routines, connectors) plus `skills/<name>/SKILL.md` in the open **Agent Skills** format. So the
   directory can also list the thousands of skills that already exist in that format, and a bot made
   for Steward can be used by other agents.
2. **Static-first, server-second.** The catalogue is a Git repository of packs built into a static
   site and a JSON index. A small server adds search, the MCP connector, submissions and claims.
   Steward reads the index from any URL (ours, a fork, or a folder on disk), so a company can run
   its own directory and the app works offline with the bundled seed.
3. **AI-made is labelled and ranked below used.** Every generated bot says "AI-made, not yet used by
   anyone" until someone installs it; installs and "I use this" set the order; AI-made bots nobody
   installs in 90 days are retired.
4. **Nothing in a pack bypasses the gateway.** Packs declare tools and rules; a rule in a pack may
   only `ask` or `deny`; skills grant nothing; instructions are shown to the person and treated as
   untrusted by the model.
5. **Add from anywhere.** "Add to Steward" on the web opens the local app with the pack's URL; the
   app shows what the bot does and needs, then installs. The same URL scheme works from chat, from
   the phone catalogue and from `steward add <url>` on the command line.

---

## 1. What a bot is in Steward

Today an agent is a profile in a tenant pack (`tenants/<id>/agents.yaml`): instructions, skills,
tools, an optional model. The directory keeps that and adds what a listing needs.

```
rent-scout/
├── bot.yaml
├── README.md                 # the listing text, written for people
└── skills/
    └── find-rentals/
        └── SKILL.md          # Agent Skills format: name, description, body
```

```yaml
# bot.yaml
id: rent-scout # directory-wide, lowercase, hyphens
name: Rent Scout
pitch: Finds rentals in your budget, flags scams, adds up the true move-in cost and reads the lease.
category: home # one of the 18 jobs (§3.1)
version: 3
author: { kind: ai, model: anthropic/claude-sonnet-5.5, generated: 2026-10-28 } # or kind: person, handle, url
licence: MIT
needs:
  tools: [browser_navigate, browser_snapshot, web_search, mail_read, show_table]
  connectors: [] # mail, calendar, or an MCP server id
  model: any # or a minimum: "needs a model that uses tools well"
does_without_asking: [browse the web, read your mail] # derived from tools and the presets
asks_before: [sending anything, paying, signing] # always true; shown anyway
instructions: |-
  You help one person find a place to rent ...
starters:
  - "Find two-bed flats under £1,600 near Oxford with a 30-minute commute to Paddington."
  - "Is this listing a scam?"
skills: [find-rentals]
rules: # may only ask or deny; an allow is rejected at validation
  - {
      name: Never pay a deposit,
      effect: deny,
      when: 'tool.kind == "pay"',
      description: Deposits are paid by you.,
    }
routines: [] # optional, created switched off
shortcuts: [] # optional launchers for the phone catalogue
examples: # for the listing and for the quality judge
  - {
      ask: "Is this listing a scam?",
      does: "Checks the address, the price against the area, the photos and the contact, then says plainly.",
    }
```

**Installing a pack** writes an **installed bot** row (SQLite, owned by the server), not a tenant
file: the profile, skills and rules it brought, its version, where it came from and when. The
`AgentHost` builds agents from the tenant pack plus installed bots. Installed skills land in the
existing Skills store with `source: bot:<id>`. Removing a bot removes what it brought and nothing
else. Updating shows the diff in plain words before applying.

**Skills follow the Agent Skills spec** (`SKILL.md` with `name`, `description`, optional
`license`, `compatibility`, `metadata`, `allowed-tools`). Steward's skill store gains a loader for
that format and `tools:` maps to `allowed-tools`. This makes `npx skills add <repo>` and the
skills.sh ecosystem usable inside Steward, and lets our skills be installed elsewhere.

---

## 2. What we take, from where

| From                                                                                                                | What                                                                                                                                                                                                                                       | Licence                                            | How                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| meetmybot.ai                                                                                                        | The product shape: 18 job categories, the listing fields (pitch, what it does, what you need, creator, Try it), "I use this", claim and report flows, no paid placement, the MCP connector's tool set, `bots.json`, `feed.xml`, `llms.txt` | (patterns only; its data is third-party creators') | Re-implemented. No data copied.                                                                                                                                                                         |
| [lobehub/lobe-chat-agents](https://github.com/lobehub/lobe-chat-agents)                                             | 505 agents as JSON (`meta.title/description/tags/category`, `config.systemRole/openingMessage/openingQuestions/fewShots`, `examples`, `author`, `homepage`, `createdAt`), schema v1, translations                                          | MIT                                                | **Seed converter**: `systemRole` → instructions, `openingQuestions` → starters, `examples` → examples, with credit to each `author`. Prompt-only bots get `needs.tools: []` and are marked "chat only". |
| [CopilotKit/openbot](https://github.com/CopilotKit/openbot) `examples/fintech/catalog/`                             | Ten coworker YAMLs (expense review, ticket triage, release notes, on-call handover, …) with standing roles                                                                                                                                 | MIT                                                | Converted to packs; good "work" category seeds                                                                                                                                                          |
| [Agent Skills spec](https://agentskills.io) ([agentskills/agentskills](https://github.com/agentskills/agentskills)) | The `SKILL.md` format and the `skills-ref` validator                                                                                                                                                                                       | Apache-2.0                                         | Adopted for skills; validator run in CI                                                                                                                                                                 |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills`) and [skills.sh](https://skills.sh)       | Installing skills from any GitHub repo; a public skills index                                                                                                                                                                              | MIT                                                | Steward's skill loader reads the same layout; the Bots page can show "skills you can also add" from skills.sh (link, not copy)                                                                          |
| [obra/superpowers](https://github.com/obra/superpowers)                                                             | A large MIT skills library                                                                                                                                                                                                                 | MIT                                                | Candidate seed for developer bots                                                                                                                                                                       |
| [anthropics/skills](https://github.com/anthropics/skills)                                                           | Anthropic's skills (pdf, docx, xlsx, pptx, …)                                                                                                                                                                                              | **Proprietary** (`LICENSE.txt`)                    | **Not bundled.** The directory may link to them for people to install themselves.                                                                                                                       |
| [f/awesome-chatgpt-prompts](https://github.com/f/awesome-chatgpt-prompts)                                           | ~200 role prompts                                                                                                                                                                                                                          | Dual licence, not SPDX-recognised                  | Not used until the licence is read in full (**UNVERIFIED**)                                                                                                                                             |
| Steward's own                                                                                                       | `tenants/steward` (6 skills, the agent) and `tenants/tempo` (3 skills, 2 shortcuts)                                                                                                                                                        | ours                                               | The first two listings; Tempo's become "Money & finance" and "Privacy & scams" bots                                                                                                                     |

`NOTICE` gains LobeHub's and (if used) superpowers' copyright lines; every converted pack keeps its
original author in `author` and the listing shows "Adapted from LobeChat's agent index, by
<author>".

---

## 3. The directory

### 3.1 The catalogue repository: `steward-bots`

A separate public Git repository, MIT, with:

- `bots/<id>/` packs (§1), one folder each;
- `categories.yaml`: the 18 jobs, adapted from meetmybot's taxonomy (food, health, money,
  investing, productivity, dev, social, video-audio, research, home, privacy, bot-helpers, games,
  sports, travel, business, sales-crm, misc) plus Steward's own: **work** (OpenBot's coworkers);
- `scripts/`: validate, build the index, run the quality judge, convert seeds;
- a GitHub Action that validates every pull request (§6) and publishes `index.json`, one
  `pack.json` per bot, `feed.xml`, `llms.txt` and a static site.

`index.json` is the only thing a Steward needs. Its URL is a setting (`STEWARD_DIRECTORY_URL`,
default our published one); a folder path works too, so a team can keep a private directory.

### 3.2 The directory server: `apps/directory`

Hono + `node:sqlite`, one process, self-hostable. It serves the static build and adds:

- **search** (`GET /api/bots?q=&category=&needs=&sort=new|used|installs`), full-text over pitch,
  README and starters;
- **the MCP connector** at `/mcp` (streamable HTTP, no key, rate-limited):
  `find_bots`, `get_bot`, `latest`, `list_categories`, `submit_bot`; the same tool set meetmybot
  exposes, so agents that already know how to use one can use the other;
- **submissions and claims**: sign in with GitHub (read-only), paste a repo or gist URL holding a
  pack, confirm it is yours; the pack is validated, then reviewed, then merged into
  `steward-bots` by a pull request the server opens;
- **use counts**: `POST /api/bots/:id/installed` (sent by Steward on install, opt-out in Settings,
  no identity) and "I use this" (+1 per signed-in account);
- **reports and removal requests**, as on meetmybot.

What the server records is listed on its privacy page: counts per bot per day, nothing per
person except the GitHub id of people who submit or vote.

**Built 28 Oct 2026** as `apps/directory` ([docs/directory.md](../directory.md)). One difference
from the above: an approved submission is written into the server's `bots/` folder and the index
rebuilt with `buildIndex`, rather than merged into `steward-bots` by a pull request.

### 3.3 In the app: the Bots page

`/bots` in `apps/web`:

- **Suggested for you**: bots matching the person's setup (mail connected → inbox bots; Tempo
  tenant → money bots) and their recent asks;
- **Browse by job**: the 18 categories, search, filters by what a bot needs;
- **Installed**: with version, updates available, remove;
- **A listing**: pitch, what it does, **what it needs** (with a green tick for each thing already
  connected), **what it may do without asking**, the rules it brings, the skills it brings, who
  made it (AI-made or a person, with credit and link), how many people use it, examples;
  **Add to Steward**;
- **Make a bot**: a form (name, job, what it should do) that calls the generator (§4) locally with
  the person's own model, shows the pack, and installs it; **Submit to the directory** opens a
  pull request draft for them.

**Agent picker.** A new conversation offers the installed bots; the default agent stays first.
`ChatPage` already accepts `?agent=`; the picker is the missing UI. Bots appear in the phone
catalogue (phone plan §4.3) as "Ask <bot>".

**Add from the web.** A listing's **Add to Steward** button links to
`http://localhost:5173/bots/add?pack=<pack.json url>` (and `steward://add?pack=` once the phone
plan's scheme exists). The app fetches the pack, shows the listing with "what it needs" and "what
it may do", and installs on confirm. If the app is not running, the page says how to start it.

### 3.4 `find_bots` inside Steward

A built-in tool, `directory_find` (kind `read`, surface `web`, taints), so Steward itself answers
"is there a bot that plans my meals?" with listings and an **Add** card. The system prompt adds
one line: when a job is outside its skills, it may suggest a bot from the directory and must say
it is a suggestion.

---

## 4. AI generation: thousands of bots on day one

`packages/bots-gen` (also used by **Make a bot** in the app, with the person's model).

1. **Taxonomy.** `jobs.yaml`: for each category, 40–120 jobs written as a person would say them
   ("find me a flat", "chase an unpaid invoice", "plan a week of dinners for a family of four").
   The first pass is written by a model from the categories and reviewed by a person; it is the
   one file where human time is spent.
2. **Generate.** For each job, one call with a strict JSON schema produces `bot.yaml`, `README.md`
   and up to three `SKILL.md` files, using **only** tools from Steward's catalogue and connectors
   Steward has. The prompt carries Steward's writing rules (plain words, no invented facts, "say
   what you could not check", never a name the person did not give).
3. **Validate** (fails closed):
   - schema and ids; every tool exists; every rule is `ask` or `deny` and compiles in the
     gateway's CEL engine;
   - `skills-ref validate` on each skill;
   - **injection scan** over instructions and skills (the gateway's outbound scanner plus a list
     of "ignore previous instructions"-style patterns);
   - **gateway dry run**: each example ask is turned into the tool calls the bot would plausibly
     make and run through `governance.dryRun`; a bot whose first example would be refused by a
     preset is rejected;
   - plain-language check (sentence length, no jargon list), no personal data, no brand claims.
4. **Judge.** A second model scores usefulness, honesty and overlap against a rubric; below the bar
   is dropped. Near-duplicates (embedding distance) are merged.
5. **Label and version.** `author.kind: ai` with model and date; `version: 1`;
   "AI-made, not yet used by anyone" until the first install.
6. **Retire.** A nightly job retires AI-made bots with no installs after 90 days and regenerates
   categories that thinned out.

Launch target: **2,000 bots across 19 categories**, plus the 505 LobeChat conversions and
OpenBot's ten, all through the same validators. Cost at today's prices is a few tens of dollars;
the pipeline runs in CI from the `steward-bots` repository, never from a person's machine.

**Where it stands, 28 Oct 2026:** 455 AI-made bots across the 19 categories (642 in the index with
the LobeChat and OpenBot conversions), of the 2,000 planned. 127 were written by Nemotron 3 Ultra
(median 115 s a bot for one worker), 328 by Nemotron 3.5 Lightning with Ultra judging (median
52 s); about 2.7 bots a minute of run time at six or seven workers, which NVIDIA's queue for Ultra
limits. 228 jobs were dropped: 96 below the bar, 4 as duplicates by meaning, 128 because the model
or the judge failed (those are retried on the next run). The taxonomy has 1,384 jobs (1,160 of
them proposed by a model and not yet read by a person), 830 still without a bot. Reaching 2,000
needs about 1,550 more bots: about ten hours of the same run, after growing the taxonomy with
`seed jobs --target 190`. `directory/REPORT.md` has the command that resumes it.

**29 Oct 2026:** the resumed run took the 830 jobs that had no bot: 609 written and 221 dropped
(186 below the bar, 30 failed calls that the next run retries, 5 duplicates by meaning) in 136
minutes, with Lightning writing and Ultra judging at six workers. The shelf has 1,064 AI-made bots
(1,251 in all). Only 30 taxonomy jobs are left without a bot, so the rest of the 2,000 needs
`seed jobs` first. Repeated names were found and fixed: 27 bots that shared a name with another
were renamed (ids unchanged), and the writer now gives a new bot a name nobody on the shelf has.

**People beat AI.** A person's submission for the same job sits above the AI one; a claimed and
improved AI bot becomes the person's (with "based on an AI-made draft" kept in its history).

---

## 5. Safety: what a pack can and cannot do

- **A pack cannot loosen the gateway.** Its rules may only `ask` or `deny`; validation rejects
  `allow`. Presets and the person's rules stay above it.
- **Skills grant nothing.** `allowed-tools` only narrows; the agent holds what its profile grants.
- **Instructions are untrusted text.** The model's base prompt says a bot's instructions never
  override the person or the gateway; the injection scan runs on every version; the listing shows
  the full instructions to the person before Add.
- **"What it may do without asking" is derived, not declared.** From the pack's tools and the
  current rules, computed by the gateway's dry run, so it is true for _this_ person's setup.
- **A bot cannot add connectors.** It can say it needs mail; connecting mail is the person's step.
- **Updates show the diff.** A changed instruction or rule is shown before it applies; auto-update
  is off by default.
- **Provenance.** Every pack carries author, version and a content hash; installs record the
  hash in Steward's audit log (`bot.installed`, `bot.updated`, `bot.removed`).

---

## 6. Contracts to add (`packages/shared`)

```ts
// bots.ts (new)
interface BotPack {
  id: string;
  name: string;
  pitch: string;
  category: string;
  version: number;
  author: { kind: "ai"; model: string; generated: string } | { kind: "person"; handle: string; url?: string };
  licence: string;
  needs: { tools: string[]; connectors: string[]; model: "any" | string };
  instructions: string;
  starters: string[];
  examples: { ask: string; does: string }[];
  skills: SkillPack[]; // SKILL.md parsed: name, description, body, allowedTools?
  rules: { name: string; effect: "ask" | "deny"; when: string; description: string }[];
  routines: Omit<RoutineBody, "enabled">[]; // installed switched off
  shortcuts: CatalogueEntry[]; // phone plan §4.3
  readme: string;
  hash: string;
}
interface BotListing
  extends Pick<BotPack, "id" | "name" | "pitch" | "category" | "version" | "author" | "needs"> {
  installs: number;
  usedBy: number;
  updatedAt: string;
  packUrl: string;
  pageUrl: string;
}
interface InstalledBot {
  id: string;
  version: number;
  hash: string;
  source: string;
  installedAt: string;
  agentId: string;
  skillIds: string[];
  ruleIds: string[];
}

// api.ts
//   GET  /api/bots                      → BotListing[] (from the configured directory, cached)
//   GET  /api/bots/installed            → InstalledBot[]
//   POST /api/bots/preview {packUrl}    → { pack: BotPack; mayDo: string[]; asksBefore: string[]; needsMissing: string[] }
//   POST /api/bots/install {packUrl}    → InstalledBot
//   DELETE /api/bots/installed/:id
//   POST /api/bots/make {job, name?}    → BotPack (generated locally, not installed)
// AuditType: "bot.installed" | "bot.updated" | "bot.removed"
```

The `AgentProfile` gains `source: "tenant" | "bot:<id>"`; `AppInfo.agents` lists both.

---

## 7. Work breakdown

| Track                     | Owns                                                                                                           | Done when                                                                                                           | Size  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----- |
| Pack format and loader    | `packages/bots` (schema, `SKILL.md` loader, validators incl. rule and injection checks, pack hash)             | Round-trips tenants/steward and tenants/tempo as packs; `skills-ref`-valid; tests                                   | ~1k   |
| Installed bots            | `apps/server` (tables, routes, `AgentHost` from tenant + installed, audit rows), `packages/shared/src/bots.ts` | Install, preview, update with diff, remove; agent appears in `/api/info`; tests                                     | ~900  |
| Bots page and picker      | `apps/web/src/pages/BotsPage.tsx`, `features/chat` agent picker, `/bots/add` route                             | Browse, listing, Add, Installed, Make a bot; axe clean; e2e                                                         | ~1.2k |
| Generator                 | `packages/bots-gen` (taxonomy, generate, validate, judge, dedupe, retire)                                      | 2,000 packs generated in CI with the validator report; `make-a-bot` works locally with the scripted model for tests | ~900  |
| Seeds                     | `steward-bots` repo scripts: LobeChat and OpenBot converters                                                   | 515 converted packs pass validation, credited                                                                       | ~400  |
| Directory site and server | `steward-bots` static build, `apps/directory` (search, MCP, submit, claim, counts)                             | Self-hosted in one command; MCP tools answer; a submission opens a PR                                               | ~1.5k |
| `directory_find` tool     | `packages/agent/src/tools/directory.ts` + web card                                                             | Steward suggests a bot with an Add card                                                                             | ~200  |

**Built, 28 Oct 2026:**

- Generator: generate, judge, near-duplicates by meaning, taxonomy growth (`seed jobs`,
  `jobs-ai.yaml`), retirement (`seed retire`), paced and retried model calls, a separate judge
  model. The count reached is under §4 and in `directory/REPORT.md`.
- Directory site and server: `apps/directory`. Approvals write the server's `bots/` folder
  instead of opening a pull request; retirement runs there nightly.
- Bots page: Make a bot ends with Submit to the directory (the pack folder as a zip, and the
  hosted directory's submit page).

Order: pack format first (everything reads it), then installed bots and the Bots page together,
then the generator and seeds, then the directory server. The in-app experience works from the
bundled seed before the server exists.

---

## 8. Verification

- **Unit:** schema, `SKILL.md` round trip, rule validation (an `allow` is rejected), injection
  scan true and false positives, pack hash stability, converters on fixture files.
- **Integration:** install a pack → the agent answers a starter through the runtime → remove →
  gone; an update changes an instruction → the diff is shown; a pack that needs mail shows
  "connect mail" when mail is off.
- **Generator:** a 20-job sample run with the scripted model in CI (shape and validators), a real
  run before launch with the report checked in.
- **e2e:** browse → listing → Add → new conversation with the bot; **Make a bot** with the scripted
  model; axe on the Bots page.
- **Directory:** MCP `find_bots` from a scripted agent; `bots.json` schema; a submission that fails
  validation is refused with the reason.

---

## 9. Risks and open questions

- **Quality of AI-made bots.** The judge and the dry run catch broken ones, not dull ones. The
  "not yet used by anyone" label and retirement after 90 days keep the shelf honest; the first
  200 launch bots are read by a person.
- **Licence of generated content.** Packs are published MIT; the repository's contributing guide
  says submissions are MIT too. Model terms for generated output are vendor-specific
  (**UNVERIFIED** per vendor; use a model whose terms allow it for the batch).
- **Hosting.** Someone runs the directory server. The static index needs nothing; the server is
  small, but submissions and counts are a service with abuse to handle (rate limits, GitHub sign-in,
  review before listing).
- **Name.** "Bot" matches the request and meetmybot; Steward's UI says "agent" elsewhere. Proposal:
  "bot" in the directory and the picker ("Ask Rent Scout"), "agent" in the docs and code.
- **Vendor neutrality.** Nothing in a pack names a model vendor; `needs.model` is a capability
  ("uses tools well"), so a bot works on Claude, Grok, Nemotron or a local model.
- **Overlap with tenants.** A tenant pack remains the way to re-brand Steward; bots are what one
  person adds. A tenant can pin a directory and pre-install bots.
