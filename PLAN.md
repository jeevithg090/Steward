# Steward — plan and record

> An open-source, proactive AI steward with a computer of its own.
> It does the work, asks before it acts, and keeps a record you can read.

This file is the plan, the contracts and the status log. Read §1–§4 before changing anything; §9 is the log.

Started 27 Oct 2026. Inspired by, and partly adapted from, three MIT-licensed CopilotKit projects:
[OpenBot](https://github.com/CopilotKit/openbot) (the governed agent platform),
[OpenDuet](https://github.com/CopilotKit/OpenDuet) (the proactive layer on top of it) and
[CopilotKit](https://github.com/CopilotKit/CopilotKit) (the runtime and React client we build on).
See `NOTICE`.

---

## 1. Why Steward exists, and what is different

OpenBot and OpenDuet are excellent, but they need Docker, Bun, PostgreSQL and a CopilotKit
Intelligence account before the first message. Steward keeps their best ideas and removes the
setup wall:

|               | OpenBot / OpenDuet                          | Steward                                                                                                                                                  |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs with     | Docker, Bun, Postgres, Intelligence project | `pnpm install && pnpm dev` on Node ≥ 24. SQLite file, no containers                                                                                      |
| Model         | OpenAI by default                           | Any OpenAI-compatible endpoint: OpenRouter, NVIDIA, OpenAI, Anthropic, Gemini, Ollama, or a scripted model for tests                                     |
| Computer      | One container per Bot                       | One Playwright Chromium profile + workspace per agent, in-process                                                                                        |
| Record        | Audit table                                 | **Hash-chained** audit: every row seals the one before; the UI verifies the chain                                                                        |
| Injection     | Untrusted-content guidance                  | Guidance **plus taint**: once a run has read the web or an email, anything that sends, pays, signs or deletes asks you, whatever the rules say           |
| What leaves   | Sensitive-data check on messages            | Same, with named findings (card number by Luhn, IBAN by mod-97, NI/SSN, keys, health words) shown on the approval card                                   |
| Access        | Web, Slack, Teams                           | Web first, **accessible first**: voice in and out, large text, high contrast, reduced motion, plain-language mode, full keyboard and screen-reader paths |
| Make it yours | Tenant package folder                       | Same idea: `tenants/<name>/` YAML. Ships `steward` and `tempo`                                                                                           |

## 2. Product

**One line:** Steward reads your mail and calendar, tells you each morning what needs you, does the
work on a computer of its own while you are away, and never sends, pays, signs or deletes anything
without showing you exactly what and waiting for your answer.

**Rules that never bend**
1. Every tool call goes through one gateway: resolve the target → decide against policy → write the
   audit row → only then act → record the outcome. No other path acts.
2. Fail closed: unknown tool → treated as a write; broken rule → refuses; no policy → permits nothing.
3. Secrets never enter the transcript. The secret box sends the value to the page; the record keeps
   only that a secret was requested and its length.
4. Never call the person by a name they did not give. Demo data is labelled as demo data.
5. Honest labels: demo inbox, scripted model and replayed data say so on screen.

**Screens** (web app, `apps/web`)

| Route              | What it shows                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` Today          | The morning brief (needs you / can wait / today's calendar / could not check), the newest suggestion with **Start** and **Hide**, a composer                                                        |
| `/chat/:threadId?` | The conversation. Every tool call renders as an action card; ones that need you show **Refuse / Allow once / Always allow**. Side panel: the live **Computer** with Activity and **Take the wheel** |
| `/tasks`           | Needs you · Suggested · Working · Ready for review · Needs input · Resolved                                                                                                                         |
| `/computer`        | The agent's screen full size, its workspace files, its shell history, take the wheel                                                                                                                |
| `/routines`        | Standing routines, next run, last result; stop or delete                                                                                                                                            |
| `/rules`           | What Steward may do without asking: presets, your standing rules, deny rules, a "would this be allowed?" tester                                                                                     |
| `/record`          | The audit trail: permitted, asked, refused, failed; each refusal names its rule; chain verification badge                                                                                           |
| `/connections`     | Google (demo inbox or real), MCP servers, built-in tools; grant tools to agents                                                                                                                     |
| `/skills`          | Instructions written once and called with `/`                                                                                                                                                       |
| `/memory`          | What it remembers about you; add or forget facts                                                                                                                                                    |
| `/settings`        | Model, voice, accessibility, setup checklist                                                                                                                                                        |
| `/welcome`         | First run: what Steward is, connect mail, choose voice/text size, ends on the setup checklist                                                                                                       |

## 3. Architecture

```
apps/web (Vite + React 19 + Tailwind 4 + CopilotKit React v2)
   │  AG-UI over HTTP (CopilotKit runtime)   REST /api/*   WS /ws/computer/:agent   SSE /api/events
   ▼
apps/server (Hono on Node)
   ├─ CopilotKit runtime (v2) hosting the Steward agent(s)
   ├─ @steward/agent       model provider, tool registry, system prompt, the AG-UI agent
   │      every tool call ──► @steward/gateway  policy (CEL) → audit (hash chain) → approval → act
   ├─ @steward/computer    Playwright Chromium per agent, snapshot+refs, screencast, take the wheel,
   │                       workspace files, restricted shell
   ├─ @steward/connectors  Google (demo server + real API shape), MCP client manager, web tools
   ├─ @steward/proactive   triage, morning brief, suggestions, tasks, routines (croner), memory
   └─ @steward/db          one SQLite file (node:sqlite), migrations per package
```

Ports: web 5173 (dev), server 8787, demo Google mounted at `/demo-google` on the server.
Data lives in `.steward-data/` (gitignored): `steward.db`, `computers/<agent>/{profile,workspace}`.

## 4. Contracts and decisions

`packages/shared/src` is the single source of truth: `governance.ts` (calls, decisions, approvals,
the record, live events), `domain.ts` (mail, calendar, triage, brief, tasks, routines, memory,
skills, tenants, setup), `computer.ts` (the computer and its WebSocket protocol), `tools.ts` (the
built-in tool catalogue with kinds and surfaces), `api.ts` (every REST route and its bodies),
`services.ts` (the interfaces each package implements). Packages depend on these, never on each
other's internals; `apps/server` wires them.

**Decisions from the research phase (27 Oct 2026)**

1. **Runtime.** CopilotKit v2 runtime in SSE mode, no Intelligence. `createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" })`
   mounted with `app.all("/api/copilotkit/*", c => handler(c.req.raw))` (never `createCopilotHonoHandler`
   at a prefix: it doubles the path). `COPILOTKIT_TELEMETRY_DISABLED=true` is set by the server at boot.
2. **Agent.** One CopilotKit `BuiltInAgent` per agent profile, model passed as an AI SDK model built with
   `createOpenAI({ baseURL, apiKey }).chat(id)` (always `.chat()`; OpenRouter, NVIDIA, Ollama and aimock
   speak Chat Completions). Anthropic and Gemini go through OpenRouter or their OpenAI-compatible endpoints.
   Blank `*_BASE_URL` env values are deleted at boot.
3. **Governance lives in a middleware, not in tool executors.** `GovernedToolsMiddleware` (adapted from
   OpenBot's `HeadlessToolsMiddleware`) owns every Steward tool and offers them to the model as
   client-style AG-UI tools (no executor), so the AI SDK stops at each call; the middleware runs
   `governance.execute`, emits `TOOL_CALL_RESULT`, and re-runs the model. No Steward tool is ever put in
   `BuiltInAgent.tools` (those would run ungoverned).
4. **Approvals are AG-UI interrupts.** A parked call ends the run with
   `RUN_FINISHED.outcome = { type: "interrupt", interrupts: [{ id: toolCallId, toolCallId, reason: "steward_approval", metadata }] }`.
   The chat renders it with `useInterrupt`; the card posts the answer to `POST /api/approvals/:id/decision`
   and then calls `resolve`/`cancel`, which starts the resume run. The middleware trusts the database,
   never the resume payload: `governance.resume` claims the answer exactly once. When no browser resumes
   within 3 s of an answer (decided from Tasks, a notification, or for a routine), the server's resume
   sweep starts the resume run itself through the runner. Double resumes are harmless.
5. **Taint.** A conversation is tainted once any tool whose catalogue entry has `taints: true` has
   returned in it. Tainted calls of kind `send`, `pay`, `sign`, `delete` or `shell` always ask, and
   "Always allow" is not offered for them.
6. **Precedence.** deny rules → the safety floor (pay and credential entry always ask, never
   always-allowed) → taint → ask rules → allow rules (presets, tenant, person, always) → defaults by kind
   (`read`/`ui` allow; `write` allow on browser/file/memory/task, ask on calendar and MCP; `send`/`pay`/
   `sign`/`delete`/`shell` ask). Any error deciding refuses. Browser clicks on elements named like
   Send/Pay/Buy/Delete/Sign/Place order are escalated to that kind before deciding.
7. **Threads.** Our `NodeSqliteAgentRunner` (port of `@copilotkit/sqlite-runner` to `node:sqlite`, with
   the local thread routes on) persists runs; the web app lists threads from `GET /api/threads` and
   switches with `useAgent({ agentId, threadId })` + `connectAgent`. Server-initiated runs (routines,
   tasks, resume sweep) go through the same runner so a connected browser sees them live.
8. **Web client.** Only `@copilotkit/react-core/v2` (+ `v2/styles.css`). Custom chat on `useAgent`,
   `useRenderTool` per Steward tool plus a wildcard, `useInterrupt` for approvals, `useComponent` for
   display-only cards. `useThreads`/`CopilotThreadsDrawer` are not used (they need Intelligence).
9. **Computer.** Playwright 1.64 persistent context per agent, `page.ariaSnapshot`-based AI snapshots with
   `aria-ref` targeting, CDP screencast (JPEG q70, 1280×800, ack every frame), take-the-wheel state machine
   with an action barrier, secret box (values masked in snapshots), workspace path containment with
   `realpath`, shell via `bash -c` with an allow-listed environment, 120 s timeout, 64 KiB tail cap.
   Loopback, private ranges and cloud metadata are refused for the agent's browser and `web_fetch`
   unless `STEWARD_ALLOW_PRIVATE_HOSTS=1`.
10. **Scripted model.** `STEWARD_MODEL_PROVIDER=scripted` starts aimock's `LLMock` in-process with Steward's
    demo fixtures, so the whole product runs, and e2e tests pass, with no key.
11. **Telemetry.** None. Steward sends nothing anywhere except to the model provider you chose.

## 5. Work breakdown (build phase)

Each track owns its directories exclusively. Nobody runs `pnpm install`; missing dependencies are
reported back to the lead, who adds them.

| Track      | Owns                                                                   | Done when                                                                                                                  |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| gateway    | `packages/gateway`                                                     | policy, approvals with waiters, hash-chained audit, outbound check, target checks, taint, dry run; unit tests              |
| computer   | `packages/computer`                                                    | Playwright manager, snapshot+refs, browser tools, screencast, input, secret fill, files, shell; tests against a local page |
| connectors | `packages/connectors`                                                  | demo Google server + client, MCP manager, web_fetch/web_search; tests                                                      |
| agent      | `packages/agent`                                                       | model providers, tool registry, prompt, AG-UI agent with the gate, tenant loader; tests with a scripted model              |
| proactive  | `packages/proactive`, `evals/triage`                                   | tasks, triage, brief, suggestions, routines, memory; eval set + runner                                                     |
| server     | `apps/server`                                                          | wiring, REST, runtime endpoint, WS, SSE, worker; integration tests                                                         |
| web shell  | `apps/web` (app, ui, lib, pages)                                       | layout, theming, accessibility settings, every page but chat                                                               |
| web chat   | `apps/web` (features/chat, features/computer, features/voice, gallery) | chat, generative UI, approval cards, computer panel, voice                                                                 |
| docs       | `README.md`, `docs/`, `tenants/`, `.github/`, `tests/e2e`              | quick start, guides, tenant packages, CI, e2e specs                                                                        |

### 5.1 Wiring contract (what each package exports for `apps/server`)

Every package with tables exports `migrations: Migration[]` (ids prefixed with the package name).

```ts
// @steward/gateway
export function createGateway(opts: {
  db: Db;
  bus?: EventBus;
  tenantRules?: TenantPackage["rules"];
  expiryHours?: number;
}): GatewayServices; // { governance, rules, approvals, audit }

// @steward/computer
export function createComputerManager(opts: {
  dataDir: string; // computers/<agentId>/{profile,workspace} live under it
  headful?: boolean;
  allowPrivateHosts?: boolean;
  audit?: AuditLog; // writes computer.help_requested / control_taken / control_released / secret.*
}): ComputerManager;

// @steward/connectors
export function createDemoGoogleApp(opts?: { now?: () => Date }): Hono; // mounted at /demo-google
export function createGoogleMailCalendar(opts: {
  baseUrl: string;
  accessToken?: string;
  label: string;
  isDemo: boolean;
}): MailCalendar;
export function createMcpManager(opts: { db: Db; allowPrivateHosts?: boolean }): McpManager;
export function createWebTools(opts?: { allowPrivateHosts?: boolean }): WebTools;

// @steward/proactive
export function createProactive(opts: {
  db: Db;
  bus?: EventBus;
  mail: () => MailCalendar | undefined;
  model: () => TextModel | undefined;
  timezone: () => string;
  tenantSkills?: Skill[];
}): {
  tasks: TaskStore;
  memory: MemoryStore;
  skills: SkillStore;
  routines: RoutineStore;
  triage: Triage;
  brief: BriefService;
  notifications: NotificationStore;
};

// @steward/agent
export function loadTenant(dir: string): TenantPackage;
export function resolveModelConfig(tenant: TenantPackage, env: NodeJS.ProcessEnv): ModelConfig;
export function createModel(
  cfg: ModelConfig,
  env: NodeJS.ProcessEnv,
): Promise<{
  model: LanguageModel;
  label: string;
  scripted: boolean;
  close(): Promise<void>;
}>;
export function createTextModel(model: LanguageModel, label: string): TextModel;
export function createStewardAgent(deps: AgentDeps): AbstractAgent; // a BuiltInAgent with the governed middleware
export interface AgentDeps {
  profile: AgentProfile;
  tenant: TenantPackage;
  model: LanguageModel;
  governance: Governance;
  computers: ComputerManager;
  mail: () => MailCalendar | undefined;
  web: WebTools;
  mcp: McpManager;
  stores: {
    tasks: TaskStore;
    memory: MemoryStore;
    skills: SkillStore;
    routines: RoutineStore;
    brief: BriefService;
    triage: Triage;
  };
  bus?: EventBus;
  settings: () => { plainLanguage: boolean; timezone: string };
  actorId: string; // "local" in single-user mode
  serverRunToken: string; // random per boot; see below
}
```

**Initiator.** A run's initiator is `person` unless `input.forwardedProps.steward` is
`{ token: serverRunToken, initiator: Initiator }`, which only the server can produce (routines, tasks,
resume sweep). A browser cannot claim to be a routine or the system.

**Tenant package layout** (`tenants/<id>/`, read by `loadTenant`, validated with zod):

```yaml
# brand.yaml
name: Steward
tagline: Does the work, asks before it acts, keeps a record you can read.
accent: "#0f6e66"
voice: Plain, warm, brief. Says what it did and what it needs.
starters: ["What needs me today?", "Open news.ycombinator.com and tell me the top story."]
# agents.yaml
agents: [{ id: steward, name: Steward, title: Your steward, instructions: "...", skills: [], tools: ["*"] }]
# skills.yaml
skills: [{ name: weekly-review, description: "...", instructions: "...", tools: [] }]
# rules.yaml
rules: [{ name: "...", effect: ask, when: 'tool.surface == "calendar"', description: "..." }]
# model.yaml (env STEWARD_MODEL_PROVIDER / STEWARD_MODEL / STEWARD_MODEL_BASE_URL override it)
provider: openrouter
model: anthropic/claude-sonnet-5.5
```

**Web app ownership.** The shell track owns `apps/web/{index.html,vite.config.ts,src/main.tsx,src/app,src/components,src/lib,src/pages,src/styles}`;
the chat track owns `apps/web/src/{features/chat,features/computer,features/voice,gallery}`. Cross-imports
are by these names only:
- shell → chat: `StewardCopilotProvider` (`@/features/chat/provider`), `ChatPage` (`@/features/chat/ChatPage`),
  `ComputerPage` (`@/features/computer/ComputerPage`), `ComputerPanel` (`@/features/computer/ComputerPanel`),
  `useSpeak`, `useDictation` (`@/features/voice`).
- chat → shell: `api` + query hooks (`@/lib/api`), `useLiveEvents` (`@/lib/live`), `cn` (`@/lib/utils`),
  UI primitives (`@/components/ui/*`: `Button`, `Card`, `Badge`, `Pill`, `Dialog`, `Tabs`, `Spinner`,
  `VisuallyHidden`), cards (`@/components/cards/*`: `ApprovalCard({ approvalId, initial?, onDecided? })`,
  `BriefCard({ brief, onStart? })`, `TaskCard({ task })`, `EmailList({ emails })`, `CalendarDay({ events })`),
  and `useAccessibility()` (`@/app/accessibility`).

## 6. Verification

`pnpm check` (typecheck, biome, vitest) · `pnpm e2e` (Playwright, scripted model) · a live walk
in the browser pane with a real model · `pnpm eval:triage`.

## 7. Security model

See `docs/security.md`. Summary: loopback by default; a single-user local mode; the gateway is the
only path to act; CEL deny-before-allow; taint; outbound check; secret box; hash-chained record;
shell runs in the workspace with a scrubbed environment, a timeout and an output cap, and asks by
default.

## 8. Out of scope for v0.1

Planned next, each in its own file under `docs/plans/`:

- [phone-and-shortcuts.md](docs/plans/phone-and-shortcuts.md): Steward on your phone and personalised iPhone Shortcuts.
- [bot-directory.md](docs/plans/bot-directory.md): a free directory of ready-made bots, seeded by AI, one tap to add.
- [orchestration.md](docs/plans/orchestration.md): several agents and models in one app, with delegation.

Multi-user sign-in, Slack/Teams channels, mobile apps, real Google OAuth verification (the client
speaks Google's API shape; pointing it at Google needs your own OAuth client), container isolation
for the computer.

## 9. Status log

- **27 Oct 2026** — Research fan-out over CopilotKit 1.81, AG-UI, OpenBot and OpenDuet sources
  (briefs in the session scratchpad). Repo scaffolded: pnpm workspaces, pinned dependencies
  (CopilotKit 1.81.0, AI SDK 6, Hono 4, Playwright 1.64.0, Vite 8, React 19.3, Tailwind 4.3).
- **27 Oct 2026, build (3ca2ee6).** Nine parallel tracks built every package against the contracts:
  about 55,000 lines of TypeScript, 1,035 tests. Each track owned its own directories, so no two
  agents touched the same file.
- **27 Oct 2026, integration (85972d0).** Contract gaps closed:
  - email headers and cc;
  - MCP `connecting` status and saved config;
  - `setupCheck` / `notificationsReadAll` routes;
  - `InboxEmail`;
  - frames moved to shared, and the chat draws framed turns as a quiet line;
  - approvals keep their initiator.

  Injection defences added: after untrusted content, memories and routines ask, and a link that
  carries personal values asks. The agent's browser can never reach Steward's own ports. The web
  app takes its agent from `/api/info`, so `tenants/tempo` works. Local OpenAI-compatible servers
  need no key. Chromium's background traffic is quieted.
- **27 Oct 2026, live walk (7fb0be2).** Real model through NVIDIA Nemotron 3 Ultra. OpenRouter was
  out of credit, which surfaced the next two fixes.
  - Replies are now capped at 4096 tokens.
  - Model errors read as plain sentences.
  - NVIDIA runs with thinking off.

  Verified live:
  - the brief from the demo inbox;
  - Hacker News opened on the agent's own computer with the live screen;
  - an email that stopped on an approval card and was sent on Allow once;
  - an injected "forward the invoices" instruction refused;
  - the record chain verified.

  Bugs found and fixed:
  - a second conversation was created per visit;
  - focus was stolen on first load (the skip link was not the first stop);
  - web pages were labelled "demo data".

  e2e: 25/25 including an axe audit.
- **27 Oct 2026, review.** Five finders and 23 skeptics. All 23 findings were confirmed. They are
  fixed in six package-owned tracks (next entry).
- **27 Oct 2026, review fixes (63b6b33, 9b76364).** Six package-owned tracks fixed all 23 review
  findings, each with a regression test.
  - Enter and Space are judged by the control they activate; unknown means ask.
  - Secret fields are recognised by type and autocomplete, and keys pressed one at a time into
    them count as credential entry.
  - No remote images in replies; the CSP sets `img-src 'self' data: blob:`.
  - A resumed routine keeps its initiator.
  - A resumed browser action is refused if the page changed.
  - Settings never sends a key to another provider's address.
  - Runs started by the server appear live in an open conversation.
  - `htmlToText` is linear.
  - Routines skipped while an answer is owed do not count as failures.
  - The setup check reserves the same room a reply does.

  Final state:
  - typecheck clean, biome clean, about 1,170 unit tests, e2e 25/25 with axe;
  - a live walk on NVIDIA Nemotron 3 Ultra (brief, computer, approval, injection, table with
    sources).
- **27 Oct 2026, phone plan.** [docs/plans/phone-and-shortcuts.md](docs/plans/phone-and-shortcuts.md)
  covers remote control on the phone, adapted from Happy (MIT), and personalised iPhone Shortcuts.
  - Phase 0 is a devices layer: a device-only port, scoped tokens and pairing.
  - Phase 1 is Shortcuts: a generic signed thin client, pairing through `run-shortcut`, and a
    catalogue built from the person's profile.
  - Phase 2 is an encrypted relay and a PWA.
  - Phase 3 is an Expo app with App Intents.

  Research is in `docs/research/`. Nothing is built yet, and it needs a real iPhone for the
  device checks.
- **28 Oct 2026, bot directory plan.** [docs/plans/bot-directory.md](docs/plans/bot-directory.md),
  modelled on meetmybot.ai: bots as packs (profile, Agent Skills `SKILL.md`, rules that can only
  tighten, starters, routines, shortcuts), a static catalogue repository plus a small directory
  server with the same MCP tools meetmybot exposes, one-tap Add to Steward, and an AI generation
  pipeline that seeds about 2,000 bots behind validators and the gateway's dry run. Seeds from
  LobeChat's MIT agent index and OpenBot's catalogue. Nothing built yet.
- **28 Oct 2026, orchestration plan.** [docs/plans/orchestration.md](docs/plans/orchestration.md):
  Claude, Codex, Grok and ~40 other agents in one app. External coding agents arrive as AG-UI
  agents through one Agent Client Protocol client (plus a Codex app-server client ported from
  Happy), every permission prompt parks as a Steward approval, delegation through a governed
  `delegate_task` tool with AG-UI subagent events, usage in the record. "Use your subscription"
  means running the vendor's own unmodified tool with your own login; Steward never touches a
  vendor credential. Research in `docs/research/happy-orchestration.md`. Nothing built yet.
- **28 Oct 2026, bot directory built.** Four tracks, each owning its own directories:
  `packages/bots` (the pack format, validators, directory client, `directory_find`),
  `apps/server` (installed bots, routes, agents rebuilt without a restart), `apps/web` (the Bots
  page, listing, add page, agent picker), `packages/bots-gen` and `directory/` (generator,
  converters, 247 seeded bots). The gateway accepts rules from bots and refuses any `allow`.
  Verified: typecheck and biome clean, 1,286 unit tests, 28/28 e2e, and a live walk on NVIDIA
  Nemotron: open a listing, Add, and the installed bot sorted the demo inbox.
- **28 Oct 2026, orchestration Phase 1 built.** [docs/plans/orchestration.md](docs/plans/orchestration.md)
  §4.1, §7 and §8 "Picker and profiles":
  - a direct `xai` provider (`https://api.x.ai/v1`, `XAI_API_KEY`, `grok-4.7`), in Settings too;
  - per-profile models: a bare `model` runs on the tenant's provider, `provider/model` on the
    provider it names, and a pinned agent keeps its model whatever Settings says. OpenRouter's and
    NVIDIA's vendor-named ids (`anthropic/…`, `openai/…`, `nvidia/…`) stay on those providers;
  - a profile whose provider has no key becomes a notice agent on its own; the others are untouched;
  - `GET /api/agents` lists every agent with its provider, model, `available`, `signIn` and reason;
  - the picker is a radio group that shows each agent's model and greys out unavailable ones with
    the reason as their description;
  - "Steward on Claude" and "Steward on Grok" in `tenants/steward/agents.yaml`;
  - every finished run gets a `run.finished` row in the record, with the run's
    `RUN_FINISHED.usage` summed across model calls per provider and model; the Record page shows
    the tokens on those rows.
- **28 Oct 2026, orchestration Phase 2 built.** `packages/harnesses` runs external coding agents
  over the Agent Client Protocol (`@agentclientprotocol/sdk` 2.0.2, the stdout filter and process
  handling adapted from Happy, MIT):
  - `HarnessAgent` is an AG-UI agent with one process per conversation in
    `computers/<agent>/workspace`. Its resume handle is in `harness_sessions`, and it reopens with
    `session/load`. It stops after 15 idle minutes or when the conversation is deleted, and its
    processes are kept across agent rebuilds while the profile is unchanged.
  - Every `session/request_permission` is a `GateCall` with `tool.source` `harness:<id>`, the kind
    from the ACP tool kind (a command is always `shell`), the target from `locations` and
    `rawInput` only, and `tainted: true`. A parked request keeps its process open across the
    interrupt and is answered on resume by option kind. Stop and moving on answer `cancelled`.
  - `tenants/<id>/harnesses.yaml` (Claude Code via `claude-agent-acp`, Gemini CLI), availability
    from PATH, `GET /api/harnesses`, and the picker line "via <tool> (your login)". The loader
    refuses bypass flags and keys in `env`.
  - The gateway trusts a harness call's mapped kind, as it does an MCP tool's, and summarises it
    from the structured target.
  - Bot listings move readme headings below the section's, so the page keeps one h1.
- **28 Oct 2026, orchestration Phase 3 built.** `packages/harnesses/src/codex`: a Codex app-server
  client ported and trimmed from Happy's `codexAppServerClient.ts` (MIT).
  - It speaks newline-delimited JSON-RPC to `codex app-server --listen stdio://`, with
    `thread/start` and `thread/resume` set to `untrusted` and `workspace-write`.
  - Command, file-change and MCP-elicitation requests become Steward approvals, answered `accept`,
    `acceptForSession` (Always only), `decline` or `cancel`.
  - `turn/interrupt` has a 3 s forced restart, and the next message resumes the thread.
  - `thread/tokenUsage/updated` fills `RUN_FINISHED.usage`.
  - Unknown server requests get a JSON-RPC error.
  - Tests replay a transcript reconstructed from the protocol (Codex is not installed here), and a
    live check runs only with `codex` on PATH and `STEWARD_LIVE_CODEX=1`.
- **28 Oct 2026, orchestration Phase 4 built.** Delegation (plan §5):
  - `delegate_task` (`write`, `task`, tainting) is offered with the agents that can answer now.
  - The child runs in a conversation of its own through `ServerRuns`, with the parent's initiator.
    Its events are forwarded tagged with `subagentRunId` (`sub-<toolCallId>`) between
    `SUBAGENT_STARTED` and `SUBAGENT_FINISHED`/`SUBAGENT_ERROR`, and the parent's model sees only
    the tool result, worded as Happy does and wrapped untrusted.
  - A child's approval ends the parent's run with `interrupts[].subagentRunId` and
    `metadata.askedBy`. The parent's resume (browser or sweep) resumes the child.
  - Depth 1 and two at once by default (`STEWARD_DELEGATION_DEPTH`, `STEWARD_DELEGATION_CONCURRENCY`);
    stop stops the subtree.
  - The `delegations` table holds them, child conversations are out of the list, and the record
    gains `delegation.started`/`finished`.
  - The chat folds a child's work under "<Agent> is working on: <task>", and the approval card says
    who asks.
- **28 Oct 2026, the rest of the plans built and merged.** Three sessions in their own worktrees,
  merged into `main` by the lead (dbe1ae8, 55b6636, 0bd541f, 65a4300):
  - **Phone (`phone`):** Phase 0 devices (phone port 8788 with hashed tokens and codes, device
    presets, `via device:<id>` in the record, Settings → Phone), Phase 1 iPhone Shortcuts (catalogue
    from the profile, TypeScript shortcut builder, a signed generic "Steward" shortcut and launchers,
    `/shortcuts`), Phase 2 the encrypted relay (`apps/relay`), the bridge and the phone web app.
    Nothing has run on an iPhone; the device checklist is in `docs/phone.md`. Phase 3 (native app)
    needs an Apple Developer account.
  - **Orchestration (`orchestration-phase-2`):** coding agents over the Agent Client Protocol
    (`packages/harnesses`), the Codex app-server client, `delegate_task` with subagent events.
    Tested against fake agents and a reconstructed Codex transcript; no vendor tool was run live, and
    the vendor-terms review (plan §4.2) is still owed before "use your own login" ships.
  - **Directory (`directory-leftovers`):** retirement after 90 days, duplicate checks by meaning
    (NVIDIA embeddings with a judge band), 642 bots (455 AI-made of the 2,000 planned; the rest is a
    resumable run, see `directory/REPORT.md`), Make a bot downloads a submittable pack.
  - Merge notes: both phone and orchestration had numbered a table `server.005`; delegations is now
    `server.007`. Two sessions had fixed the same heading bug differently; the directory version was
    kept. After merging, the main port answered `/device/*` with the web app's page; it is now a
    plain 404.
  - Verified on `main`: typecheck and biome clean, 1,617 unit tests (1 skipped: live Codex), 37/37
    e2e.
- **29 Oct 2026, published on GitHub.** Steward now lives at github.com/jeevithg090/Steward, the
  repository that held Tempo. Steward reached `main` through a merge that keeps Steward's files and
  takes Tempo's last commit as its second parent, so the push was a fast-forward and nothing on
  GitHub was rewritten; Tempo's code is also on the `tempo` branch and the `tempo-final` tag.
  Before the push:
  - A scan of every local commit for the real key values and key-shaped strings found none (the
    key-shaped hits are fake test fixtures). Three local merge commits carried the machine's
    address as author; they were rewritten to the project identity before anything left the Mac.
  - The research briefs lost their local paths, and the Bots page no longer shows the path of the
    folder an installed bot came from ("from the directory on this computer").
  - Settings → Phone named the default ports (8787, 8788) even when Steward ran on others; the
    server now sends `mainPort`, and the page uses the real numbers.
  - 115 AI-made bots had lowercase names ("cc flagger"). The generator now writes names in sentence
    case with known short forms (`displayName`: "CC flagger", "Wi-Fi security"), and the shipped
    packs were fixed and rebuilt with their dates kept.
  - The README was rewritten for the bots, other agents and the phone, with new screenshots
    (`docs/images/README.md` says how each was taken), plus Dependabot, monthly and grouped.
