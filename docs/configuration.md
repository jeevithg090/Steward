# Configuration

Steward is configured in three places, each for a different kind of setting:

| Where                                 | What goes there                                                                                                | Changed by                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Environment variables, usually `.env` | Keys, ports, folders, and switches for this machine.                                                           | Editing the file and restarting.                                             |
| A tenant package, `tenants/<id>/`     | The product: name, agent, skills, rules, default model.                                                        | Editing YAML and restarting. See [make-it-your-own.md](make-it-your-own.md). |
| The app's Settings page               | Your preferences: model, plain language, brief time, time zone, how long approvals wait, and display settings. | You, in the app, at once.                                                    |

## Where environment variables are read from

The server reads, in this order, and the first value found for each name wins:

1. The environment Steward was started in (your shell, CI, a process manager).
2. The file named by `STEWARD_ENV_FILE`, if set. Keep your keys outside the repository this way:
   `STEWARD_ENV_FILE=~/.config/steward/.env pnpm dev`.
3. `.env` at the repository root. Copy `.env.example` to start one. It is in `.gitignore`.

Blank values count as unset, so `OPENROUTER_API_KEY=` in `.env` means "no key", not "an empty key".
A switch or number Steward cannot read (`STEWARD_WORKERS=none`) is named when the server starts,
and its default is used. Relative paths (such as `STEWARD_DATA_DIR`) are resolved from the
repository root, so `pnpm dev` and `pnpm --filter @steward/server dev` find the same data.

## Every variable

### The model

| Variable                   | Default                                       | Read by                                        | What it does                                                                                                             |
| -------------------------- | --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `STEWARD_MODEL_PROVIDER`   | the tenant's `model.yaml` (`openrouter`)      | `packages/agent/src/model.ts`                  | `openrouter`, `openai`, `anthropic`, `nvidia`, `gemini`, `xai`, `ollama`, `openai-compatible` or `scripted`.             |
| `STEWARD_MODEL`            | the tenant's model, or the provider's default | `packages/agent/src/model.ts`                  | The model id, such as `anthropic/claude-sonnet-5.5`.                                                                     |
| `STEWARD_MODEL_BASE_URL`   | the provider's endpoint                       | `packages/agent/src/model.ts`                  | Overrides the endpoint. Required for `openai-compatible`.                                                                |
| `OPENROUTER_API_KEY`       | none                                          | `packages/agent/src/model.ts`, the triage eval | Key for OpenRouter.                                                                                                      |
| `OPENAI_API_KEY`           | none                                          | `packages/agent/src/model.ts`                  | Key for OpenAI.                                                                                                          |
| `ANTHROPIC_API_KEY`        | none                                          | `packages/agent/src/model.ts`                  | Key for Anthropic.                                                                                                       |
| `GEMINI_API_KEY`           | none                                          | `packages/agent/src/model.ts`                  | Key for Gemini.                                                                                                          |
| `NVIDIA_API_KEY`           | none                                          | `packages/agent/src/model.ts`                  | Key for NVIDIA.                                                                                                          |
| `XAI_API_KEY`              | none                                          | `packages/agent/src/model.ts`                  | Key for xAI.                                                                                                             |
| `STEWARD_MODEL_API_KEY`    | none                                          | `packages/agent/src/model.ts`                  | Key for an `openai-compatible` server.                                                                                   |
| `STEWARD_MODEL_MAX_TOKENS` | 4096                                          | `apps/server/src/runtime/agents.ts`            | The most one reply may write (256 to 65536). Providers judge credit against it, so lower it on a small balance.          |
| `STEWARD_NVIDIA_THINKING`  | off                                           | `packages/agent/src/model.ts`                  | `1` lets NVIDIA's reasoning models think before replying. Off by default: thinking makes each tool call take about 20 s. |

With no key for the chosen provider, Steward runs the scripted demo model and labels it. See
[models.md](models.md).

### The server

| Variable                              | Default         | Read by                                     | What it does                                                                                                                                                                |
| ------------------------------------- | --------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEWARD_PORT`                        | `8787`          | `apps/server/src/config.ts`                 | The server's port.                                                                                                                                                          |
| `STEWARD_HOST`                        | `127.0.0.1`     | `apps/server/src/config.ts`                 | The address the server listens on. Steward has no sign-in, so it listens only on this machine unless you change this. See [security.md](security.md#local-only-by-default). |
| `STEWARD_ALLOWED_HOSTS`               | none            | `apps/server/src/http/security.ts`          | Comma-separated host names accepted besides this machine's own, for when you put Steward behind a proxy you control. Everything else is refused, which stops DNS rebinding. |
| `STEWARD_DEVICE_PORT`                 | `8788`          | `apps/server/src/config.ts`                 | The phone port: only `/device/*`, every call with a device token. Point tunnels here, never at `STEWARD_PORT`; set it to `off` to switch it off.                            |
| `STEWARD_DEVICE_HOST`                 | `127.0.0.1`     | `apps/server/src/config.ts`                 | Where the phone port listens. `0.0.0.0` for a phone on the same Wi-Fi (plain http, with a warning).                                                                         |
| `STEWARD_DEVICE_HOSTS`                | none            | `apps/server/src/device/listener.ts`        | Host names the phone port answers besides loopback and the phone address set in Settings → Phone.                                                                           |
| `STEWARD_DEVICE_URL`                  | none            | `apps/server/src/device/phone.ts`           | The address phones use, until one is set in Settings → Phone.                                                                                                               |
| `STEWARD_DEVICE_ACCESS_CLIENT_ID`     | none            | `apps/server/src/config.ts`                 | With `_SECRET`: a Cloudflare Access service token for the tunnel in front of the phone port. A phone gets it in its pairing reply. See [phone.md](phone.md).                |
| `STEWARD_DEVICE_ACCESS_CLIENT_SECRET` | none            | `apps/server/src/config.ts`                 | The secret half of that token. Both must be set.                                                                                                                            |
| `STEWARD_RELAY_URL`                   | none            | `apps/server/src/config.ts`                 | The phone app's relay, `wss://`. Steward dials out to it; nothing listens beyond this machine.                                                                              |
| `STEWARD_RELAY_TOKEN`                 | none            | `apps/server/src/config.ts`                 | The token Steward presents to the relay (the relay's `RELAY_MACHINE_TOKEN`), 24+ characters.                                                                                |
| `STEWARD_DATA_DIR`                    | `.steward-data` | `apps/server/src/config.ts`                 | Where Steward keeps everything. See [the data folder](#the-data-folder).                                                                                                    |
| `STEWARD_TENANT`                      | `steward`       | `apps/server/src/config.ts`                 | Which folder under `tenants/` to load.                                                                                                                                      |
| `STEWARD_WORKERS`                     | on              | `apps/server/src/config.ts`                 | Background work: routines, the morning brief, approval expiry. Set to `0` to switch it off (the tests do).                                                                  |
| `STEWARD_ENV_FILE`                    | none            | `scripts/dev.mjs`, `apps/server/src/env.ts` | A `.env` file to read before the repository's own.                                                                                                                          |
| `NODE_ENV`                            | none            | `apps/server/src/config.ts`                 | `production` refuses `STEWARD_DEV_ORIGINS` and `STEWARD_ALLOW_PRIVATE_HOSTS`.                                                                                               |

### Bots and handing work on

| Variable                         | Default                | Read by                        | What it does                                                                                                                                                                                    |
| -------------------------------- | ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEWARD_DIRECTORY_URL`          | `directory/index.json` | `apps/server/src/config.ts`    | Where the Bots page finds bots: an `https://` address, or a path to an `index.json`. The default is the directory in the repository, so the page works offline. `http://` only on this machine. |
| `STEWARD_DIRECTORY_COUNTS`       | off                    | `apps/server/src/config.ts`    | `1` tells the directory each time a bot is added: one request per install, with nothing about you. Never sent to a directory read from a file.                                                  |
| `STEWARD_DELEGATION_DEPTH`       | `1`                    | `apps/server/src/bootstrap.ts` | How far a task may be handed on: `1` lets a conversation hand a task on, but not that task hand it on again. 1 to 10.                                                                           |
| `STEWARD_DELEGATION_CONCURRENCY` | `2`                    | `apps/server/src/bootstrap.ts` | How many tasks one run may have handed on and running at once: 1 to 10.                                                                                                                         |

### Mail and calendar

| Variable              | Default | Read by                     | What it does                                                                                                                                                                        |
| --------------------- | ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEWARD_DEMO_GOOGLE` | on      | `apps/server/src/config.ts` | Serves a made-up inbox and calendar at `/demo-google` and connects Steward to it. Everything in it is invented and labelled "Demo inbox" on screen. Set to `0` to run with no mail. |

The mail client speaks the shape of Gmail's and Google Calendar's APIs, but connecting a real
Google account (OAuth) is not wired up in v0.1. See the [roadmap](../README.md#roadmap).

### The computer

| Variable                      | Default | Read by                                                                  | What it does                                                                                                                                                                                                                                         |
| ----------------------------- | ------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEWARD_HEADFUL`             | off     | `apps/server/src/config.ts` → `packages/computer`                        | Shows the agent's browser as a window on this machine instead of running it headless. The live screen in the app works either way.                                                                                                                   |
| `STEWARD_ALLOW_PRIVATE_HOSTS` | off     | `apps/server/src/config.ts` → `packages/computer`, `packages/connectors` | Lets the agent's browser, `web_fetch` and MCP over HTTP reach this machine and your local network. Off, they refuse loopback, private and link-local addresses. Cloud metadata addresses are refused either way. Refused when `NODE_ENV=production`. |

### The web app (development)

| Variable               | Default             | Read by                     | What it does                                                                                                                                                                                                                   |
| ---------------------- | ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STEWARD_SERVER_URL`   | from `STEWARD_PORT` | `apps/web/vite.config.ts`   | Where the Vite dev server sends `/api` and `/ws`. Unset, it follows `STEWARD_PORT` and `STEWARD_HOST` from your shell or `.env`, as the server does, so moving the port in `.env` moves both.                                  |
| `VITE_STEWARD_API_URL` | none                | `apps/web/src/lib/api.ts`   | Makes the web app call a server at this address directly instead of through Vite's proxy. The server must then trust the Vite ports with `STEWARD_DEV_ORIGINS`.                                                                |
| `STEWARD_DEV_ORIGINS`  | off                 | `apps/server/src/config.ts` | `1` lets pages on `localhost` or `127.0.0.1` ports 5173 and 4173 call the API from their own origin. Only for `VITE_STEWARD_API_URL`: any page on those ports could then use Steward. Says so at start. Refused in production. |

### Voice

Voice has no variables. Reading aloud and dictation use your browser's own speech. See
[accessibility.md](accessibility.md).

### The triage eval

| Variable                | Default                                      | Read by                       | What it does                                          |
| ----------------------- | -------------------------------------------- | ----------------------------- | ----------------------------------------------------- |
| `STEWARD_EVAL_BASE_URL` | none                                         | `packages/proactive/src/eval` | An OpenAI-compatible endpoint for `pnpm eval:triage`. |
| `STEWARD_EVAL_MODEL`    | `anthropic/claude-haiku-5.5` with OpenRouter | `packages/proactive/src/eval` | The model to measure.                                 |
| `STEWARD_EVAL_API_KEY`  | none                                         | `packages/proactive/src/eval` | Its key, if it needs one.                             |

### End-to-end tests

| Variable                  | Default                                     | Read by                          | What it does                                                                                     |
| ------------------------- | ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `STEWARD_E2E_REUSE`       | off                                         | `tests/e2e/playwright.config.ts` | `1` reuses a server and web app you already started instead of starting fresh ones. Never in CI. |
| `STEWARD_E2E_DATA_DIR`    | a new folder under `test-results/e2e-data/` | `tests/e2e/playwright.config.ts` | The data folder the test server uses.                                                            |
| `STEWARD_E2E_SERVER_PORT` | `8787`                                      | `tests/e2e/env.ts`               | The test server's port, to run beside `pnpm dev`.                                                |
| `STEWARD_E2E_WEB_PORT`    | `5173`                                      | `tests/e2e/env.ts`               | The test web app's port. Any free port works.                                                    |
| `STEWARD_E2E_DEVICE_PORT` | the server's port + 1                       | `tests/e2e/env.ts`               | The test server's phone port.                                                                    |
| `CI`                      | none                                        | `tests/e2e/playwright.config.ts` | Set by CI services. Forbids `test.only`, retries once, never reuses servers.                     |

### Set by Steward itself

The server sets `COPILOTKIT_TELEMETRY_DISABLED=true` and `DO_NOT_TRACK=1` at boot, so nothing is
sent anywhere but your model provider, and removes any blank `*_BASE_URL` variables, which some
libraries would otherwise use as an empty address.

## The data folder

Everything Steward keeps is in one folder, `.steward-data/` by default, which is in `.gitignore`.
Only your user account can open it: Steward makes the folder `0700` and the database `0600`, and
tightens them if an older version left them readable by others.

```text
.steward-data/
├── steward.db                      one SQLite file: rules, approvals, the record, tasks, routines,
│                                   memory, skills, settings, conversations, connections
└── computers/
    └── <agent id>/
        ├── profile/                the agent's Chromium profile: its cookies and sign-ins
        └── workspace/              the agent's files, and where its shell runs
```

To start over, stop Steward and delete the folder. To back it up, stop Steward and copy the folder.
The `profile/` holds whatever sites the agent was signed in to, so treat a copy of it like a copy
of your browser profile. `steward.db` also holds the secret settings and access tokens you saved for
connected apps on `/connections` (in their own table, never shown again on screen), so treat a copy
of it the same way.

## Ports

| Port   | What                                                                                                                        | Bound to                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `5173` | The web app in development (Vite).                                                                                          | `127.0.0.1`                         |
| `8787` | The server: `/api`, the CopilotKit runtime at `/api/copilotkit`, `/ws/computer/:agent`, `/demo-google`.                     | `127.0.0.1` (`STEWARD_HOST`)        |
| `8788` | The phone port: only `/device/*`, and every call needs a device token. Tunnels point here. `STEWARD_DEVICE_PORT`, or `off`. | `127.0.0.1` (`STEWARD_DEVICE_HOST`) |
| `4173` | `vite preview` of a built web app, if you use it. It proxies `/api` and `/ws` like the dev server.                          | `127.0.0.1`                         |

Once `pnpm build` has made `apps/web/dist`, the server also serves the web app itself at `/` on
port 8787, so one process is all you need.

The server answers pages from its own origin only. Vite's proxy passes the browser's address
through, so a page from `pnpm dev` counts as the server's own; a page on any other port or site is
refused, reads included.

The scripted demo model and the agent's browser proxy also take a free loopback port each, chosen
at start-up.

## Settings in the app

These are saved in Steward's database and apply at once:

| Setting        | Default              | What it does                                                                                       |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| Model          | from the environment | Provider, model and endpoint. Overrides the environment; the key still comes from the environment. |
| Plain language | off                  | Asks Steward for short sentences and everyday words.                                               |
| Brief time     | `08:00`              | When the morning brief is made each day.                                                           |
| Time zone      | this machine's       | For the brief, routines and dates.                                                                 |
| Approvals wait | 24 hours             | How long an unanswered approval stays open before it expires (1 to 168 hours).                     |

Display settings (text size, contrast, motion, theme, font, read aloud) are saved in your browser,
because they belong to the screen you are using. See [accessibility.md](accessibility.md).
