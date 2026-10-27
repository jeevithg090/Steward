# Architecture

Steward is a TypeScript monorepo: a web app, a server, and six packages the server wires together.
It runs as two processes in development (Vite and the server) and one in production (the server
serves the built web app). Everything it keeps is in one SQLite file. There are no containers and
no other services.

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
   └─ @steward/db           one SQLite file (node:sqlite), migrations per package
```

## Packages

| Package               | Owns                                                                                                                                                                                                        | Main exports                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `@steward/shared`     | The contracts every other package agrees on: tool calls, decisions, approvals, the record, live events, mail and calendar, tasks, routines, the computer's protocol, every REST route. No logic beyond ids. | `TOOLS`, `ROUTES`, the types, the zod request bodies                                       |
| `@steward/db`         | One SQLite database on `node:sqlite`. Each package hands it its own migrations, with ids prefixed by the package name.                                                                                      | `Db`, `memoryDb`, `Migration`                                                              |
| `@steward/gateway`    | The one door: decides, records, asks, acts. Rules, approvals and the hash-chained record.                                                                                                                   | `createGateway` → `{ governance, rules, approvals, audit }`                                |
| `@steward/computer`   | The agent's computer: a persistent Chromium profile, accessibility snapshots with stable refs, the live screen, take the wheel, the secret box, the workspace and the shell.                                | `createComputerManager`                                                                    |
| `@steward/connectors` | Mail and calendar (a demo Google server and a client that speaks Gmail's and Calendar's API shape), MCP clients, and `web_fetch`/`web_search` behind an address guard.                                      | `createDemoGoogleApp`, `createGoogleMailCalendar`, `createMcpManager`, `createWebTools`    |
| `@steward/proactive`  | What Steward does without being asked: triage, the morning brief, suggestions, tasks, routines on a schedule, memory, skills, notifications. Also the triage eval.                                          | `createProactive`                                                                          |
| `@steward/agent`      | The agent: model providers and the scripted model, the tool registry, the system prompt, the governed middleware, the tenant loader.                                                                        | `loadTenant`, `resolveModelConfig`, `createModel`, `createTextModel`, `createStewardAgent` |
| `apps/server`         | Wiring, REST routes, the CopilotKit runtime endpoint, the live event stream, the computer's WebSocket, background workers.                                                                                  | the program                                                                                |
| `apps/web`            | The app: Today, Chat, Tasks, Computer, Routines, Rules, Record, Connections, Skills, Memory, Settings, Welcome.                                                                                             | the program                                                                                |

Packages depend on each other only through `@steward/shared`. The factories' signatures are fixed in
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

One file, `.steward-data/steward.db`, holds everything, in tables prefixed by the package that owns
them: `gateway_rules`, `gateway_approvals`, `gateway_audit`; `proactive_tasks`,
`proactive_routines`, `proactive_briefs`, `proactive_memory`, `proactive_skills`,
`proactive_notifications`, `proactive_triage_cache`; `connectors_mcp_servers`; and the server's
`runner_threads`, `runner_runs`, `thread_meta` and `server_settings`. Migrations run at start-up,
each once, each in its own transaction. The database is in WAL mode. The agent's browser profiles
and workspaces are folders beside it. See [configuration.md](configuration.md#the-data-folder).

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

| Decision                                          | Why                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node and SQLite, no containers                    | `pnpm install && pnpm dev` on any machine with Node 24. `node:sqlite` ships with Node.                                                            |
| Governance in a middleware, not in tool executors | One place decides every call, and no tool can be registered in a way that skips it.                                                               |
| Approvals end the run                             | A run waiting on a person would be lost on restart. An interrupt plus a stored approval survives anything, and the answer can come from anywhere. |
| The gateway trusts the database, not the resume   | The browser is not trusted to say what was approved.                                                                                              |
| Every provider through Chat Completions           | One code path, and any OpenAI-compatible server works.                                                                                            |
| A scripted model built in                         | The product, the demo and the end-to-end tests run with no key and no network.                                                                    |
| CEL for rules                                     | Small, safe, readable, and not Turing-complete: a rule cannot loop or reach anything.                                                             |
| A hash-chained record                             | Edits are detectable, and the chain can be verified by anyone with the file.                                                                      |
| Tenant packages in YAML                           | The product is configuration; the code stays shared.                                                                                              |
| No telemetry                                      | Steward sends nothing anywhere except to your model provider.                                                                                     |

The full list, with the research behind it, is in [PLAN.md §4](../PLAN.md).
