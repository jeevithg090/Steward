# @steward/server

One Hono process on Node that wires every Steward package together and serves:

- the **CopilotKit runtime** (AG-UI over SSE) at `/api/copilotkit/*`, hosting one agent per tenant profile;
- the **REST API** at `/api/*` (every route in `packages/shared/src/api.ts`);
- **live events** at `GET /api/events` (SSE) and the agent's **screen** at `WS /ws/computer/:agentId`;
- the **demo inbox and calendar** at `/demo-google` (when on);
- the **built web app** at `/`, when `apps/web/dist` exists.

It also runs the background work: routines, the daily brief, approval expiry and the resume sweep.

## Run it

```sh
pnpm dev:server                     # from the repo root: tsx watch, reads .env
pnpm --filter @steward/server start # once, no watch
```

With no model key it still starts: it runs the scripted demo model, labels it as such, and the setup
checklist says what to add. It listens on `http://127.0.0.1:8787` by default.

## Settings

The server reads `STEWARD_ENV_FILE` (when set), then `.env` from the repository root. Values already in
the environment win, then the first file; a blank value (`KEY=`) counts as unset wherever it is.
Relative paths resolve from the repository root, not the working directory.

| Variable                                                                           | Default                | What it does                                                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `STEWARD_PORT`                                                                     | `8787`                 | Port. `0` picks a free one.                                                                                             |
| `STEWARD_HOST`                                                                     | `127.0.0.1`            | Address to listen on. Loopback by default: Steward has no sign-in.                                                      |
| `STEWARD_ALLOWED_HOSTS`                                                            |                        | Extra host names to answer on (comma separated), for example a LAN name.                                                |
| `STEWARD_DATA_DIR`                                                                 | `.steward-data`        | Where `steward.db` and each agent's computer live.                                                                      |
| `STEWARD_TENANT`                                                                   | `steward`              | Which folder under `tenants/` to load.                                                                                  |
| `STEWARD_DEMO_GOOGLE`                                                              | on                     | Serve and read the demo inbox and calendar. `0` turns it off.                                                           |
| `STEWARD_HEADFUL`                                                                  | off                    | Show the agent's browser window.                                                                                        |
| `STEWARD_ALLOW_PRIVATE_HOSTS`                                                      | off                    | Let the agent's browser and `web_fetch` reach this machine and private networks. Refused when `NODE_ENV=production`.    |
| `STEWARD_WORKERS`                                                                  | on                     | Background workers. `0` turns them off.                                                                                 |
| `STEWARD_DIRECTORY_URL`                                                            | `directory/index.json` | The bot directory: an https URL or a path to an `index.json`. The bundled one works offline.                            |
| `STEWARD_DIRECTORY_COUNTS`                                                         | off                    | Tell the directory when a bot is installed (one POST per install, no identity). Never for a directory read from a file. |
| `STEWARD_MODEL_PROVIDER`, `STEWARD_MODEL`, `STEWARD_MODEL_BASE_URL`, provider keys |                        | See the root `.env.example`. A model picked in Settings overrides them.                                                 |

At boot the server deletes blank `*_BASE_URL` values (an empty base URL breaks every model request)
and sets `COPILOTKIT_TELEMETRY_DISABLED=true` and `DO_NOT_TRACK=1`. Steward sends nothing anywhere
except to the model provider you chose.

## How the pieces fit

```
createApp(config)
 ├─ Db (one SQLite file) ← migrations: gateway, connectors, proactive, server
 ├─ EventBus ─────────────────────────────────────────────► GET /api/events (SSE)
 ├─ createGateway(db, bus, tenant rules)       governance · rules · approvals · audit
 ├─ createComputerManager(dataDir, audit)      ◄──────────► WS /ws/computer/:agentId
 ├─ connectors: demo Google app, mail client ("Demo inbox"), MCP manager, web tools
 ├─ createProactive(db, bus, mail, model, timezone)       tasks · memory · skills · routines · triage · brief · notifications
 ├─ AgentHost: resolveModelConfig → createModel → createStewardAgent per profile
 ├─ NodeSqliteAgentRunner (runs and threads in the same SQLite file)
 ├─ CopilotRuntime({ agents, runner }) ─► app.all("/api/copilotkit/*")
 ├─ ServerRuns (routines, tasks, the resume sweep) ─► the same runner
 └─ Workers: routines every 30 s, the brief each minute, approvals each minute
```

`src/` layout:

| Path                                    | What                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                              | Entry point: reads `.env`, builds the app, listens, closes on SIGINT/SIGTERM. Importing it as a library has no side effects beyond `runtime-env.ts`.    |
| `bootstrap.ts`                          | `createApp(config)`: the wiring above. Tests use it directly.                                                                                           |
| `config.ts`, `env.ts`, `runtime-env.ts` | Settings from the environment; `runtime-env.ts` is imported first by `bootstrap.ts` so the runtime never sees a blank base URL or telemetry on.         |
| `runtime/runner.ts`                     | `NodeSqliteAgentRunner`, adapted from `@copilotkit/sqlite-runner` (MIT).                                                                                |
| `runtime/server-runs.ts`                | `runOnThread`: runs the server starts itself.                                                                                                           |
| `runtime/agents.ts`                     | The model and the agents, one per tenant profile and one per installed bot; swaps them when the model changes in Settings or a bot is added or removed. |
| `bots/service.ts`                       | The bot directory in this Steward: what a pack may do here (decided by the gateway's dry run), install, update, remove. Audit rows `bot.*`.             |
| `runtime/lifecycle.ts`                  | Thread titles and task states follow each run; `run.started` and `run.finished` go out as live events.                                                  |
| `runtime/frames.ts`                     | The fixed opening words of turns nobody typed (a routine firing, a task starting).                                                                      |
| `routes/*`                              | The REST API.                                                                                                                                           |
| `live/*`                                | The event bus, the SSE route and the computer's WebSocket.                                                                                              |
| `setup/checks.ts`                       | The setup checklist.                                                                                                                                    |
| `workers/*`                             | Routines, the brief, approval expiry, the resume sweep.                                                                                                 |
| `http/*`                                | Errors, security guards, static files.                                                                                                                  |
| `store/*`                               | The server's own tables: settings, what it knows about each conversation, and the installed bots with what each one brought.                            |

## Runs the server starts

Routines, **Start** on a task and the resume sweep all go through `ServerRuns.start` (the
`runOnThread` of the plan). It clones the agent, loads the thread's history from the runner, adds the
new user message (framed, so the model and the app know nobody typed it), and runs it **through the
runner**, so it lands in the thread's history and any browser watching that thread sees it live
(`run.started` and `run.finished` tell an open conversation to follow it). A thread with a run in
flight is refused (409); a due routine waits for its thread to be free. A new turn is also refused
(409) while the thread's last run still waits for an answer, since the answer would then land after
it: a due routine records that firing as skipped (`refused`). Resume runs always go through.

A browser that missed one of these runs sends a stale history with its next message. The runner puts
the stored turns back first, so the model sees them and the stored snapshot never loses them.

The run carries `forwardedProps.steward = { token, initiator }`. The token is random per boot and
only the server knows it, so a browser cannot claim to be a routine. The runner strips it before
anything is stored or replayed.

## Approvals and the resume sweep

A call that needs the person ends its run with an AG-UI interrupt. The web app shows the card,
posts the answer to `POST /api/approvals/:id/decision` and resumes the run itself. If no browser has
resumed within 3 seconds (the answer came from Tasks or a notification, or the run was a routine's),
the server resumes it through the runner, with every answer the run was waiting on. The gateway
claims each answer exactly once, so a sweep racing a browser does nothing twice. Each minute the
server also expires old approvals and picks up answers nobody claimed (after a restart, say).

## Security

Steward is one person's assistant on one machine. The server:

- listens on loopback by default and answers only requests addressed to a loopback name, the bound
  address or `STEWARD_ALLOWED_HOSTS` (no DNS rebinding);
- refuses state-changing requests from other sites (`Origin` / `Sec-Fetch-Site`) and takes only JSON
  bodies, on the API and on the demo inbox; allows CORS only for the Vite dev and preview servers
  (`:5173`, `:4173`);
- checks the `Origin` of WebSocket upgrades (browsers do not apply CORS to them);
- limits body sizes (256 KiB for the API, 10 MiB for agent runs) and computer input frames (64 KiB);
- answers every error as `{ "error": "<a sentence>" }`, never with a stack trace;
- never logs what was typed into the computer, and never echoes a secret in an error;
- sends `X-Frame-Options: DENY` so approval cards cannot be clickjacked, and a CSP that loads images
  only from itself, `data:` and `blob:`, so an image in a reply cannot carry data to another host.

Adding an MCP server with a `stdio` command runs that command on this machine. That is why the guards
above matter: only this machine's own pages may add one.

## Data

All in `<STEWARD_DATA_DIR>/steward.db`. The server's own tables: `server_settings` (key-value),
`thread_meta` (title, agent, kind of each conversation), `runner_threads` and `runner_runs` (the
runner's record of every run, compacted AG-UI events). The packages own the rest.

## Tests

```sh
pnpm vitest run apps/server/test          # from the repo root
pnpm --filter @steward/server typecheck
pnpm biome check apps/server
```

The integration tests boot the whole server on a free port with a temporary data folder and the
scripted model: REST routes, SSE, the WebSocket, an AG-UI run, and the send-email flow (parked,
refused, resumed by a browser or by the sweep, and allowed and sent).
