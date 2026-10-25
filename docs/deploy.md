# Deploying Tempo

Tempo is two deployables. The **web app** (`apps/web`, a Vite + React single-page app) is static
files and goes on Vercel. The **Gateway** (`apps/gateway`, FastAPI) is a long-running container and goes on Render,
Fly, or any Docker host. Everything the Gateway needs for the demo runs **offline in replay
mode** with no keys; vendor keys are switched on one at a time afterwards.

| Piece | Where | Config |
|---|---|---|
| Web app | Vercel, Root Directory `apps/web` | the one-click button or `make deploy-web` |
| Gateway | Render | [`deploy/render.yaml`](../deploy/render.yaml) (Blueprint) |
| Gateway | Fly | [`deploy/fly.toml`](../deploy/fly.toml) |
| Gateway | Docker anywhere | [`deploy/gateway.Dockerfile`](../deploy/gateway.Dockerfile) |
| Everything on one machine | Local mode | `make local` ([`deploy/local`](../deploy/local/docker-compose.local.yml)) |

The Gateway is **not** a Vercel target. It holds a WebSocket open to every screen (`/events`),
runs a 30-second scheduler for the Watchdog's durable timers, and writes mission checkpoints and
the Mesh device list to disk. None of that fits a serverless function.

## 1. The web app on Vercel

The app is a Vite SPA with hash routes: the build is static files in `dist/`, and
[`apps/web/vercel.json`](../apps/web/vercel.json) already declares the framework (`vite`), the
build (`npm run build`), the output (`dist`), a rewrite of every path to `index.html`, and the
security headers (a CSP, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, and a
Permissions-Policy that allows the camera and microphone for the app itself only).

### The button

The README's button opens Vercel with everything filled in:

```
https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgitlab.com%2Fna-group4693543%2FTempo&root-directory=apps%2Fweb&project-name=tempo&env=VITE_TEMPO_SHOWCASE&envDescription=Set%20to%201%20to%20run%20the%20recorded%20showcase%20with%20no%20backend
```

Vercel clones the repository into your account, sets the Root Directory to `apps/web` and asks
for one variable. Enter `1`. You get the **showcase**: every page runs on recorded Gateway
responses from `apps/web/src/showcase/*.json`, Margaret's missions walk through their recorded
states as the buttons are pressed, the chat answers from the same recordings, and the badge reads
**SHOWCASE · recorded replay · no Gateway**. A deployment that is attached to a Gateway can still
show the showcase for one visit with `?showcase=1` on the URL, or per browser with the switch in
Settings.

### By hand

1. Vercel → *Add New…* → *Project* → import the repository (fork it first if you don't have
   access).
2. *Root Directory*: **`apps/web`**. The framework preset is Vite (`vercel.json` says so), the
   build command `npm run build`, the output directory `dist`. Node 22.
3. *Environment Variables*: `VITE_TEMPO_SHOWCASE` = `1` for the no-backend showcase.
4. Deploy.

The lockfile is `package-lock.json`, so Vercel installs with `npm ci`. The build's `prebuild` step
(`node scripts/build-catalog.mjs --if-present`) regenerates the profile and skill catalogue from
`profiles/*.yaml` and `skills/*/skill.yaml` when they are in the clone and keeps the committed
`src/showcase/catalog.json` when they are not, so a Root-Directory build works either way. Run
`make catalog` after changing a profile or a manifest and commit the result.

### Attaching a real Gateway

Once a Gateway is up (section 2), replace the showcase variable with two others and redeploy.
**Vite bakes `VITE_*` values into the bundle at build time**, so a change needs a redeploy, not a
restart:

| Variable | Value |
|---|---|
| `VITE_GATEWAY_URL` | the Gateway's URL, e.g. `https://tempo-gateway.onrender.com` |
| `VITE_TEMPO_TOKEN` | the same string as the Gateway's `TEMPO_API_TOKEN` |

The team's public showcase is the Vercel project `tempo-showcase` at https://tempo-showcase.vercel.app (root `apps/web`, `VITE_TEMPO_SHOWCASE=1` for Production and Preview; `apps/web/.vercelignore` keeps the CLI's `.env.local` token out of every upload). Redeploy it with `make deploy-web` or `npx vercel deploy --prod` from `apps/web`.

Delete `VITE_TEMPO_SHOWCASE`: set to `1`, it keeps the app in showcase mode and Settings cannot
switch it off. The token is a demo convenience and ends up in the browser bundle
(`apps/web/.env.example` says so); passkey-signed approvals are the real authentication: once a browser has Face ID or a fingerprint
on the Devices page (`#/devices`), the Gateway takes a yes for that person only signed with it, on every door (a no or STOP is still taken anywhere). WebAuthn needs
https or localhost, and `MESH_RP_ID` on the Gateway must equal the web app's host. Settings can also point a deployed app at another
Gateway at runtime (kept per browser, no rebuild).

On the Gateway side, `WEB_ORIGINS` must list the Vercel URL exactly (section 3), or the browser's
requests and the `/events` WebSocket are refused by CORS.

### The CLI instead of the button

```bash
npx vercel login                 # once
npx vercel --cwd apps/web        # a preview deployment
npx vercel --cwd apps/web --prod # production; `make deploy-web` runs exactly this
```

Set variables with `npx vercel env add VITE_TEMPO_SHOWCASE production --cwd apps/web`.

## 2. The Gateway

The image is [`deploy/gateway.Dockerfile`](../deploy/gateway.Dockerfile): a `uv sync --frozen`
build stage, then `python:3.12-slim` with only the virtualenv (`/app/.venv`), the rule packs
(`skills/`), the replay fixtures the Gateway needs, and `alembic/`. It runs as uid 10001, listens
on 8000, answers `GET /health`, and expects a writable `/data` (`CHECKPOINT_DIR=/data/checkpoints`,
`MESH_FILE=/data/mesh.json`). There is no `uv` in the runtime image; `alembic` is at
`/app/.venv/bin/alembic`.

Nothing about the Gateway changed for the new web app. Two settings matter to it: `WEB_ORIGINS`,
set to the Vercel host exactly, and, for spoken replies from the server, `ELEVENLABS_API_KEY`:
`POST /voice/tts` proxies ElevenLabs with the Gateway's key (the browser never holds it), and
`GET /voice/tts` tells the app whether it is configured. Without the key the route answers 404 and
the browser's own voice speaks; the avatar still moves.

### Render (Blueprint)

[`deploy/render.yaml`](../deploy/render.yaml) declares a Docker web service in Frankfurt with a
1 GB disk at `/data`, a `/health` check, a pre-deploy migration, and a managed Postgres wired to
`DATABASE_URL`.

1. Render reads a Blueprint from `render.yaml` at the repository root; ours lives in `deploy/`
   to keep the root tidy. Copy it there on a branch first (`cp deploy/render.yaml render.yaml`),
   or use the Blueprint file-path option if your Render account offers one. Then Render → *New* →
   *Blueprint* → pick the repository.
2. Fill in the four `sync: false` values when prompted: `TEMPO_API_TOKEN`, `WEB_ORIGINS`,
   `MESH_RP_ID`, `PUBLIC_URL` (section 3 says what each must be).
3. Apply. The database is created, the image is built, `alembic upgrade head` runs before the
   first start (`preDeployCommand`), then the service starts and `/health` goes green.

pgvector: migration `alembic/versions/0003_personal_memory.py` runs
`CREATE EXTENSION IF NOT EXISTS vector`. The extension is on Render's list for Postgres 13 and
later and the Blueprint's user owns the database, so it should need no manual step. If it ever
does, run `CREATE EXTENSION vector;` once from the database's *PSQL Command*.

Render's free Postgres expires after 30 days; the Blueprint says so next to `plan: free`. A
persistent disk needs a paid web service and turns off zero-downtime deploys (Render stops the old
instance before starting the new one); the Gateway is single-instance by nature, so that is the
right trade.

### Fly

[`deploy/fly.toml`](../deploy/fly.toml) describes the same service for Fly: London, one shared
CPU with 512 MB, a volume at `/data`, a `/health` check, HTTPS forced. Run from the repo root:

```bash
fly launch --copy-config --config deploy/fly.toml --no-deploy   # picks the app name and region
fly volumes create tempo_data --size 1 --config deploy/fly.toml
fly secrets set --config deploy/fly.toml \
  TEMPO_API_TOKEN=<any long random string> \
  WEB_ORIGINS=https://<your-vercel-host> \
  MESH_RP_ID=<your-vercel-host> \
  PUBLIC_URL=https://<app-name>.fly.dev
fly deploy --config deploy/fly.toml
```

The `[build] dockerfile` path is relative to the config file, which is why the file says
`gateway.Dockerfile` rather than `deploy/gateway.Dockerfile`; the build context is the directory
you run `fly deploy` in, so run it from the repo root.

There is no database by default: replay mode runs in memory and survives on its checkpoints.
When you add `DATABASE_URL` as a secret (Fly Postgres or any provider), run the migration once:
`fly ssh console --config deploy/fly.toml -C "/app/.venv/bin/alembic -c /app/alembic.ini upgrade head"`,
or uncomment the `[deploy] release_command` in the file so every deploy does it.

### Plain Docker

```bash
docker build -f deploy/gateway.Dockerfile -t tempo-gateway .
docker volume create tempo-data
docker run -d --name tempo-gateway -p 8000:8000 \
  --read-only --tmpfs /tmp -v tempo-data:/data \
  -e TEMPO_API_TOKEN=<any long random string> \
  -e WEB_ORIGINS=http://localhost:3000 \
  -e MESH_RP_ID=localhost \
  -e PUBLIC_URL=http://localhost:8000 \
  tempo-gateway
curl -s localhost:8000/health
```

Add `-e DATABASE_URL=...` and run the migration with
`docker run --rm --entrypoint alembic -e DATABASE_URL=... tempo-gateway upgrade head` (that is
what [`deploy/local/install.sh`](../deploy/local/install.sh) does). The whole local stack, with
Ollama as the model, is `make local`.

### `/data` must be writable by uid 10001

The image runs as a non-root user and does not create `/data`; the platform mounts the disk
there. Whether a fresh volume's mount point is writable by uid 10001 differs by platform and
neither Render's nor Fly's docs say. The first symptom is a `PermissionError` on
`/data/checkpoints` or `/data/mesh.json` in the log when a mission starts or a device pairs;
`/health` will not show it. On Fly: `fly ssh console --config deploy/fly.toml -C "chown 10001 /data"`
and restart. On Docker: `docker run --rm -u 0 -v tempo-data:/data alpine chown 10001 /data`. On
Render there is no root shell, so the durable fix is a `/data` directory created and owned by
10001 in the Dockerfile; that change is not part of this track (the Dockerfile is unchanged).

## 3. Environment matrix

The minimum set (SHIPPING.md §4.7) and what breaks when each is wrong. Every variable is
documented in [`.env.example`](../.env.example) and read by `tempo_adapters.settings.Settings`.

| Variable | Where | What it does |
|---|---|---|
| `TEMPO_API_TOKEN` | Gateway | The bearer token the web app sends. Any long random string. Compared in constant time (`tempo_gateway/security.py:secret_matches`); without it every web route is 401. |
| `WEB_ORIGINS` | Gateway | Comma-separated origins allowed by CORS (REST and the `/events` WebSocket) **and** the origins a passkey assertion must come from (`Mesh(origins=...)`). **Must list the Vercel URL exactly**, scheme and host, no trailing slash, e.g. `https://tempo.vercel.app`; locally `http://localhost:3000,http://127.0.0.1:3000` (what `make demo` sets). The first entry is also the base of share links. |
| `MESH_RP_ID` | Gateway | The WebAuthn relying-party id passkeys are bound to. **Must equal the Vercel host** (no scheme, no port), e.g. `tempo.vercel.app`, or Face ID registration and approval fail with an rp id mismatch. A custom domain changes it. (Passkeys are not in the new web UI yet; the Gateway still wants the value.) |
| `PUBLIC_URL` | Gateway | The Gateway's own public URL. Twilio's signature is checked against `PUBLIC_URL + /sms/inbound`, and ElevenLabs is told to call the voice tools here. Wrong value: every SMS is rejected as unsigned. |
| `DATABASE_URL` | Gateway, Alembic | Postgres, pasted as the provider gives it (`postgres://...?sslmode=require` is fine). Without it missions live in memory and a restart loses them; with it, `make db-migrate` first. |
| `TEMPO_MODE` | Gateway | `replay` (default: recorded rail data, jurors, company; no network) or `live`. |
| `TEMPO_DEMO` | Gateway | `1` shows the honesty badge and enables the `/demo/*` routes (jump the clock, seed memories). `0` for anything real. |
| `TEMPO_DEPLOY` | Gateway | `cloud-standard`, `cloud-private`, `cloud-confidential` or `local`: which outside AI companies may see personal data (`tempo_core/config.py`). |
| `TEMPO_REGION` | Gateway | Where the data lives, shown as is on `/health` and the Privacy Proof panel. |
| `PAYMENT_CHECK_AFTER_S` | Gateway | How long the Watchdog waits before checking for the money. A week by default; `10` for a demo. |
| `CHECKPOINT_DIR`, `MESH_FILE` | Gateway | Set by the image to `/data/checkpoints` and `/data/mesh.json`; mount a disk at `/data`. |
| `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_TEMPO`, `ELEVENLABS_VOICE_TEMPO_LOW`) | Gateway | Server-side speech for the web app (`POST /voice/tts`). Optional: without it the browser's own voice speaks. |
| `VITE_TEMPO_SHOWCASE` | Vercel | `1`: recorded responses, no Gateway. |
| `VITE_GATEWAY_URL`, `VITE_TEMPO_TOKEN` | Vercel | Attach a Gateway; the token must equal its `TEMPO_API_TOKEN`. Build-time values: redeploy after a change. |

Live vendors (`ELEVENLABS_*`, `TWILIO_*`, `SNOWFLAKE_*`, `GEMINI_API_KEY`, `RTT_TOKEN`,
`HSP_*`, `VAPID_*`, `MANDATE_SIGNING_KEY`, the register keys) are optional and documented in
`.env.example`. Add them to the platform's secret store, never to a config file in the repo.

## 4. After the first deploy

```bash
curl -s https://<gateway>/health            # mode, what is simulated, deploy mode, region
make doctor                                 # one cheap call per vendor, with an owner and a fallback for each failure
DATABASE_URL=<external connection string> make db-migrate   # if the platform didn't run alembic for you
GATEWAY_URL=https://<gateway> TEMPO_API_TOKEN=<token> make seed  # the demo's people (TEMPO_DEMO=1 only)
```

`make doctor` reads `.env`, so run it with the deployed values exported, or from a shell where
`.env` is the deployment's copy. `/health` tells the truth about the run: `"simulated"` lists what
is recorded (`company`, and in replay mode `rail data`, `jurors`, `vision`).

## 5. The `.env` warning

`DATABASE_URL` in `tempo/.env` is read by **every** local Gateway start (`uv run tempo-gateway`),
by `make seed` (which writes people, memories and missions through the Gateway) and by
`make db-migrate` (which changes the schema). If you paste a production connection string there
to run a migration, the next `uv run tempo-gateway` on your laptop writes demo missions into
production. Keep a local database in `.env`, and pass the remote one on the command line for the
one command that needs it:

```bash
DATABASE_URL='postgres://...?sslmode=require' make db-migrate
```

Integration tests never read `DATABASE_URL`; they use `TEST_DATABASE_URL` or a throwaway Docker
container, and they reset the schema every test (`tests/integration/conftest.py`).

## 6. What this does not automate

- The Vercel import and the Render or Fly account are clicks the team makes with its own
  accounts; this page documents them.
- Live voice needs ElevenLabs keys and `make sync-voice` (it switches on the
  conversation-initiation webhook that makes the Patience Profile work on a real call).
- Signed images: `release-images` (GitLab and `.github/workflows/release-images.yml`) builds,
  signs and allowlists the images, but only once the cosign key pair exists
  ([`deploy/transparency/README.md`](../deploy/transparency/README.md)). Until then the Render
  and Fly deploys build from source on each platform.
