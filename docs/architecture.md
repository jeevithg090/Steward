# Architecture

Steward is a TypeScript monorepo: a web app, a server, and thirteen packages the server wires
together, plus two programs you can host yourself if you want them: the bot directory and the
phone app's relay. Steward runs as two processes in development (Vite and the server) and one in
production (the server serves the built web app). Everything it keeps is in one SQLite file. There
are no containers.

```text
apps/web  (Vite · React 19 · Tailwind 4 · CopilotKit React v2)
   │
   │  AG-UI over HTTP (SSE)        REST /api/*        SSE /api/events        WS /ws/computer/:agent
   ▼
apps/server  (Hono on Node, 127.0.0.1:8787)
   ├─ CopilotKit runtime v2 at /api/copilotkit, threads persisted by NodeSqliteAgentRunner
   │     └─ one BuiltInAgent per agent profile, wrapped in GovernedToolsMiddleware
   │            │ every tool call
   │            ▼
   ├─ @steward/gateway      policy (CEL) → record (hash chain) → approval → act → record outcome
   │            │ only then
   │            ▼
   ├─ @steward/computer     Playwright Chromium per agent, workspace files, restricted shell
   ├─ @steward/connectors   demo Google (mounted at /demo-google), Gmail/Calendar client, MCP, web tools
   ├─ @steward/proactive    triage, morning brief, tasks, routines, memory, skills, notifications
   ├─ @steward/agent        model providers, tool registry, system prompt, tenant loader
   ├─ @steward/harnesses    Claude Code, Gemini CLI and Codex as agents, their permissions as approvals
   ├─ @steward/bots         bot packs, their checks, the directory client
   ├─ @steward/phone        the phone catalogue; @steward/shortcuts builds and signs iPhone shortcuts
   ├─ @steward/remote       the phone app's crypto and protocol
   └─ @steward/db           one SQLite file (node:sqlite), migrations per package

phone port (127.0.0.1:8788)   /device/* only, a key per paired phone; the one port to tunnel
   │
   └─ dials out to apps/relay (optional)   the phone app's end-to-end encrypted relay

apps/directory (optional, hosted)   the bot directory: search, an MCP connector, submissions, review
```

## Packages

| Package               | Owns                                                                                                                                                                                                                | Main exports                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `@steward/shared`     | The contracts every other package agrees on: tool calls, decisions, approvals, the record, live events, mail and calendar, tasks, routines, the computer's protocol, every REST route. No logic beyond ids.         | `TOOLS`, `ROUTES`, the types, the zod request bodies                                       |
| `@steward/db`         | One SQLite database on `node:sqlite`. Each package hands it its own migrations, with ids prefixed by the package name.                                                                                              | `Db`, `memoryDb`, `Migration`                                                              |
| `@steward/gateway`    | The one door: decides, records, asks, acts. Rules, approvals and the hash-chained record.                                                                                                                           | `createGateway` → `{ governance, rules, approvals, audit }`                                |
| `@steward/computer`   | The agent's computer: a persistent Chromium profile, accessibility snapshots with stable refs, the live screen, take the wheel, the secret box, the workspace and the shell.                                        | `createComputerManager`                                                                    |
| `@steward/connectors` | Mail and calendar (a demo Google server and a client that speaks Gmail's and Calendar's API shape), MCP clients, and `web_fetch`/`web_search` behind an address guard.                                              | `createDemoGoogleApp`, `createGoogleMailCalendar`, `createMcpManager`, `createWebTools`    |
| `@steward/proactive`  | What Steward does without being asked: triage, the morning brief, suggestions, tasks, routines on a schedule, memory, skills, notifications. Also the triage eval.                                                  | `createProactive`                                                                          |
| `@steward/agent`      | The agent: model providers and the scripted model, the tool registry, the system prompt, the governed middleware, the tenant loader.                                                                                | `loadTenant`, `resolveModelConfig`, `createModel`, `createTextModel`, `createStewardAgent` |
| `@steward/harnesses`  | External coding agents as Steward agents: Claude Code and Gemini CLI over the Agent Client Protocol, Codex through its app server, each in the agent's workspace, every permission it asks for sent to the gateway. | `loadHarnesses`, `HarnessAgent`, `HarnessSessionStore`                                     |
| `@steward/bots`       | The bot pack format: reading and writing packs and `SKILL.md` skills, the checks a pack must pass, what a bot may do, the directory client and the index builder.                                                   | `validatePack`, `parseBotFolder`, `DirectoryClient`, `buildIndex`                          |
| `@steward/bots-gen`   | The generator behind the directory's AI-made bots and **Make a bot**, the quality judge, and the converters for the LobeChat and OpenBot seeds.                                                                     | `generateBatch`, the `seed` CLI                                                            |
| `@steward/phone`      | The phone catalogue, built from the person's skills, routines, bots and the tenant's `shortcuts.yaml`.                                                                                                              | `buildCatalogue`, `loadTenantShortcuts`                                                    |
| `@steward/shortcuts`  | Builds, checks and signs the iPhone shortcuts Steward hands out.                                                                                                                                                    | `buildStewardShortcut`, `buildLauncher`, `sign`                                            |
| `@steward/remote`     | The crypto and protocol the server's bridge, the relay and the phone app share. Runs in Node and in the browser.                                                                                                    | `encryptPayload`, `decryptPayload`, the pairing helpers                                    |
| `apps/server`         | Wiring, REST routes, the CopilotKit runtime endpoint, the live event stream, the computer's WebSocket, background workers, the phone port and the bridge to the relay.                                              | the program                                                                                |
| `apps/web`            | The app: Today, Chat, Tasks, Computer, Routines, Rules, Record, Connections, Bots, Skills, Memory, Shortcuts, Settings, Welcome.                                                                                    | the program                                                                                |
| `apps/directory`      | The hosted bot directory: search, an MCP connector so other agents can find bots, GitHub sign-in for submissions, and review. Optional.                                                                             | the program                                                                                |
| `apps/relay`          | The end-to-end encrypted relay between the server and the phone app. It only ever holds ciphertext. Optional.                                                                                                       | the program                                                                                |

The contracts live in `@steward/shared`, and packages agree through them. Some packages also build
on another's public entry point: `@steward/agent` on the gateway, the computer, the connectors, the
proactive layer and bots; `@steward/bots` on the gateway, to work out what a bot may do. None
reaches into another's internals. The factories' signatures are fixed in
[PLAN.md §5.1](../PLAN.md); `apps/server` is the only place that knows about all of them.

## One turn of a conversation

1. **The browser** sends the conversation to `POST /api/copilotkit` with CopilotKit's `useAgent`.
   AG-UI events stream back over the same response.
2. **The runtime** hands the run to the agent for that thread, through `NodeSqliteAgentRunner`, which
   stores the thread and its events in SQLite so a reload, another tab or a server-started run sees
   the same conversation.
3. **The agent** is CopilotKit's `BuiltInAgent`, given an AI SDK model built with
   `createOpenAI({ baseURL, apiKey }).chat(model)`. Every provider is reached through the OpenAI Chat
   Completions API.
4. **The middleware.** Steward's tools are not given to the `BuiltInAgent` as executable tools,
   because those would run ungoverned. `GovernedToolsMiddleware` (adapted from OpenBot's
   `HeadlessToolsMiddleware`) offers them to the model as client-side AG-UI tools with no executor,
   so the model stops at each call. The middleware then builds the gateway's view of the call (the
   tool, its kind and surface from the catalogue, the target it resolves, whether the conversation
   is tainted, the text that would leave) and calls `governance.execute(call, act)`.
5. **The gateway** decides (see [governance.md](governance.md)), writes `tool.decided`, and:
   - **allow:** runs `act`, which calls the computer, a connector or a store; writes
     `tool.completed` or `tool.failed`; returns the result.
   - **deny:** returns a refusal sentence that names the rule.
   - **ask:** opens an approval and returns `parked`.
6. **The result** goes back to the model as `TOOL_CALL_RESULT` (results from untrusted tools are
   wrapped and labelled as untrusted), and the model runs again, until it answers in words.
7. **A parked call** ends the run with `RUN_FINISHED` carrying an AG-UI interrupt
   (`reason: "steward_approval"`, keyed by the tool call id). The chat draws the approval card with
   `useInterrupt`. The answer is posted to `POST /api/approvals/:id/decision`, and the browser
   resumes the run; the resumed run calls `governance.resume`, which claims the answer once and acts
   only if it was Allow and the call is unchanged. If no browser resumes within 3 seconds of an
   answer, the server's resume sweep starts the run itself.

## Runs nobody typed

Routines, tasks and the resume sweep start runs from the server, through the same runner, so a
browser that is open on that thread sees them live. A run's initiator is `person` unless the run's
`forwardedProps.steward` carries `{ token, initiator }` with the server's random per-boot token,
which a browser cannot know. That is how a rule can treat a routine differently from a person, and
why a browser cannot claim to be a routine.

Background workers in the server:

| Worker       | Every     | Does                                                    |
| ------------ | --------- | ------------------------------------------------------- |
| Routines     | 30 s      | Starts the routines that are due, on their own threads. |
| Brief        | 60 s      | Makes the day's brief once the brief time has passed.   |
| Approvals    | 60 s      | Expires approvals past their deadline.                  |
| Resume sweep | on answer | Resumes answered approvals no browser has resumed.      |

## Live updates

- **`GET /api/events`** is a Server-Sent Events stream of `LiveEvent`s: approvals created and
  decided, new record entries, task, brief and routine changes, notifications. The web app uses it
  to refresh what is on screen and to announce what needs you.
- **`WS /ws/computer/:agent`** carries the agent's screen: JPEG frames from Chromium's own
  screencast (quality 70, up to 1280 × 800), status and activity from the server; take, release,
  mouse, keyboard, navigation and secret-box messages from the person. Input is accepted only while
  the person holds the wheel.

## The computer

One per agent, started the first time the agent needs it.

- **The browser** is a Playwright persistent Chromium context, so its sign-ins survive restarts. Its
  traffic goes through a small local proxy that checks every request, redirect hop and WebSocket
  against the address policy.
- **Snapshots** come from Playwright's accessibility snapshot, rewritten with refs that are unique
  for the life of the computer, so a ref from an old page is "stale" rather than silently pointing at
  something else. Password, code and card fields are masked.
- **Take the wheel** is a small state machine with an action barrier: taking control waits for the
  agent's current action to finish, refuses the agent's actions while you drive, and makes the agent
  look again when you hand back.
- **The workspace** is a folder per agent, with path containment for the file tools.
- **The shell** is `bash -c` in the workspace, with an allow-listed environment, a time limit and an
  output cap. It asks before every command by default.

## Data

One file, `.steward-data/steward.db`, holds everything, mostly in tables prefixed by the package
that owns them: `gateway_rules`, `gateway_approvals`, `gateway_audit`; `proactive_tasks`,
`proactive_routines`, `proactive_briefs`, `proactive_memory`, `proactive_skills`,
`proactive_notifications`, `proactive_triage_cache`; `connectors_mcp_servers`; the harnesses'
`harness_sessions`; and the server's `runner_threads`, `runner_runs`, `thread_meta`,
`server_settings`, `installed_bots`, `delegations`, `delegation_interrupts`, `devices`,
`pairing_codes` and `remote_nonces`. Migrations run at start-up, each once, each in its own
transaction. The database is in WAL mode. The agent's browser profiles and workspaces are folders
beside it. See [configuration.md](configuration.md#the-data-folder).

## The web app

Vite, React 19, Tailwind 4, React Router and TanStack Query, with only CopilotKit's v2 React package
(`@copilotkit/react-core/v2`):

- `useAgent` for the conversation, with Steward's own transcript and composer.
- `useRenderTool` for each Steward tool, so every call draws as an action card, plus a wildcard for
  tools from connected apps.
- `useInterrupt` for approvals.
- Generative UI cards for tables, charts, comparisons and choices, drawn from the tool's arguments
  and never from HTML the model wrote.

REST calls go through one typed client (`apps/web/src/lib/api.ts`) built on the routes in
`@steward/shared`.

## Decisions, and why

| Decision                                          | Why                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node and SQLite, no containers                    | `pnpm install && pnpm dev` on any machine with Node 24.2. `node:sqlite` ships with Node.                                                           |
| Governance in a middleware, not in tool executors | One place decides every call, and no tool can be registered in a way that skips it.                                                                |
| Approvals end the run                             | A run waiting on a person would be lost on restart. An interrupt plus a stored approval survives anything, and the answer can come from anywhere.  |
| The gateway trusts the database, not the resume   | The browser is not trusted to say what was approved.                                                                                               |
| Every provider through Chat Completions           | One code path, and any OpenAI-compatible server works.                                                                                             |
| A scripted model built in                         | The product, the demo and the end-to-end tests run with no key and no network.                                                                     |
| CEL for rules                                     | Small, safe, readable, and not Turing-complete: a rule cannot loop or reach anything.                                                              |
| A hash-chained record                             | Edits are detectable, and the chain can be verified by anyone with the file.                                                                       |
| Tenant packages in YAML                           | The product is configuration; the code stays shared.                                                                                               |
| No telemetry                                      | Steward reports nothing about its use. Besides your model provider, it reaches only what you or the agent ask for. See [security.md](security.md). |

The full list, with the research behind it, is in [PLAN.md §4](../PLAN.md).
