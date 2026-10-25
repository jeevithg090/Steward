# tempo-hub: every device, any brand, one database, one model

A working prototype of Tempo's sync layer. Devices **join without QR codes** and **push their data automatically** into one event database (SQLite). A **model** answers questions over that database with tools, using a local model by default, so no paid keys are needed.

```
 phones · laptops · watches (via their apps) · location · notifications
        │  join (safe by default), push events
        ▼
 ┌───────────────────────────────┐      ┌──────────────────────────────┐
 │ hub (FastAPI + SQLite)        │ ───▶ │ model (Ollama / any OpenAI-  │
 │ one event log, hub_seq cursor │      │ compatible API) + tempo-me   │
 └───────────────────────────────┘      │ MCP server for other agents  │
                                        └──────────────────────────────┘
```

## Run it (about 1 minute)

```bash
cd tempo-hub
./run.sh          # creates .venv on first run (uv, or python3 ≥ 3.10), starts the hub on :8787
```

The hub prints:
- **Its address on your Wi-Fi.**
- **How to get your personal link.** The link itself is never printed, because terminals end up on projectors and in logs.
- **What joins automatically right now** (see below).

`run.sh` turns the access log off, because app URLs carry `?key=…`. It also makes `data/` readable by you only.

**First device:** on the hub computer, open `http://localhost:8787`. It joins by itself as *this computer*. Use that page to let your other devices in.

**Model:** the hub picks, in order: `TEMPO_LLM_BASE_URL` / `_MODEL` / `_API_KEY` if set (env, `data/kairos.env` or
`voice/.env`); else **Gemini** when a `GEMINI_API_KEY` exists (the agents' key: copy it in AI Studio, then run
`agents/set_gemini_key.sh`, which saves it from the clipboard into `agents/.env` and never shows it); else local Ollama
`qwen2.5:7b`. Write for me uses the same model unless `BRIDGE_LLM_*` is set. Restart the hub (`./run.sh`) after a change.
`KAIROS_LOCAL_MODELS=0` (set in `data/kairos.env` on 25 Oct) means API keys only: no model on this Mac is ever called;
with no key yet, `/api/ask` gives the hub's own summary and Write for me offers "send it as you said it?".
```bash
TEMPO_LLM_MODEL=llama3.2:3b ./run.sh
TEMPO_LLM_BASE_URL=https://api.example.com/v1 TEMPO_LLM_API_KEY=... TEMPO_LLM_MODEL=... ./run.sh
```
How the hub uses the model:
- Each question gets one deadline (`TEMPO_LLM_BUDGET`, default 25 s).
- The model is told the person's local time ("Now: …").
- Vault data (health, location, notifications, desktop) only goes to a model on this computer or the local network, unless `TEMPO_LLM_ALLOW_VAULT=1`. That holds for the fallback model too: a hosted fallback is skipped while vault data is in the conversation.
- A spoken question (the voice agent) has a 10 s budget on an API model, including any wait for a free slot; each model call is cut off by the wall clock (5 s), and a model that failed once goes behind the fallback for the rest of that question.
- If no model answers, `/api/ask` still replies with a plain summary of what the hub knows.

## Joining: safe by default

A device with no token joins **by itself** only in the cases below, and every join is announced to all devices as a `device.joined` event.

| When | Who joins by itself | `joined_via` |
|---|---|---|
| Always | **This computer:** anything that connects from 127.0.0.1 or from the hub's own LAN address | `this-computer` |
| For 2 minutes after you tap **Add a device now** on a joined device | Any device on the local network that opens the hub address (the desktop agent keeps retrying, so it gets in too) | `join-window` |
| While you have no phone or computer yet | The first device on `TEMPO_HOME_CIDR` | `first-device` |
| With `TEMPO_LAN_AUTOJOIN=1` **and** `TEMPO_HOME_CIDR` | Any device on that subnet. Use only your own hotspot or router, never venue Wi-Fi. | `home-network` |
| Anywhere, once | A device that opens your **personal link** (`/join#t=…`). Without `TEMPO_PUBLIC_URL` the link is **same Wi-Fi only**. | `link` |

**Never auto-joins:**
- Requests that arrive through a proxy or tunnel (any forwarding header).
- Anything at all while `TEMPO_PUBLIC_URL` is set. Raw TCP tunnels look like 127.0.0.1, so they're covered too.
- Requests addressed to a host name that isn't the hub's own (its LAN IP, `<hostname>.local`, `tempo-hub.local`, `localhost`). This stops DNS rebinding.
- Shared or venue Wi-Fi, by default.

**Demo setup:** run the hub on a phone hotspot, e.g. `TEMPO_HOME_CIDR=172.20.10.0/28 ./run.sh` (an iPhone hotspot's range). Then use **Add a device now** for each device.

**Removing a device sticks:**
- A removed phone or computer gets 401. It can only join again the normal way: **Add a device now**, the personal link, or from the hub computer itself.
- A removed app (Health Connect, OwnTracks…) gets **410** on every delivery until you unblock it (`POST /api/devices/{id}/unblock`).

## How each kind of device connects

| Device | What the person does | Then it's automatic |
|---|---|---|
| **Phone or laptop browser** | Taps **Add a device now** on a joined device, then opens the hub address within 2 minutes (or opens the personal link once) | Syncs while the page is open |
| **Laptop (Mac / Windows / Linux)** | `python agent/desktop_agent.py --install` once ([desktop agent](#desktop-agent)) | Starts at every login and streams the current app, idle time and battery |
| **Android health** (Galaxy Watch, Pixel/Fitbit, Garmin, Oura, CMF via Gadgetbridge…) | Pastes the "Health Connect" URL into HC Webhook once | The app posts on its own schedule and shows up as a device |
| **iPhone health** (Apple Watch and anything in Apple Health) | Pastes the URL into Health Auto Export (REST automation) or a Shortcut automation once | Posts on its own schedule |
| **Location** | OwnTracks → HTTP mode → paste the URL once | Automatic (fixes, plus entering/leaving a region as `location.transition`) |
| **Notifications** (e.g. a GWR delay) | Tasker / AutoNotification → POST `{app, title, text}` to the URL once | Each one is stored as a single `notification.signal` event |

App URLs are on the web page under **Add another device or app**:
- The key in them is masked (`abcd••••••`), so the page is safe on a projector.
- **Show full app URLs** reveals them (`POST /api/integrations/reveal`). Don't do that on a shared screen. Every reveal is announced as a `hub.ingest_key_shown` event.
- For iPhone apps that refuse plain HTTP to a bare IP, use the `.local` URL.

## Desktop agent

```bash
python agent/desktop_agent.py --install                                 # on the hub computer: joins as this computer
TEMPO_HUB_URL=http://192.168.1.20:8787 python agent/desktop_agent.py --install   # another laptop: tap "Add a device now" first
python agent/desktop_agent.py --rejoin --install                        # after it was removed, or the hub was reset
```

It needs only the standard library (Python 3.9+). zeroconf and psutil are used if installed.

**Install**
- `--install` creates `~/.tempo/` and joins once in the foreground, so you see the result straight away.
- It then writes a LaunchAgent (macOS), a systemd user unit (Linux) or a Startup script (Windows). This passes every `TEMPO_*` setting through to the service. The join token is left out once the computer has joined.
- macOS logs go to `~/.tempo/agent.log`.
- Uninstall on macOS: `launchctl unload ~/Library/LaunchAgents/io.tempo.agent.plist`, then delete the file.

**Finding the hub**
- The agent uses `TEMPO_HUB_URL` if it is set. Otherwise it looks for an mDNS advert, which the hub sends only with `TEMPO_MDNS=1` on `TEMPO_HOME_CIDR`. Otherwise it tries `http://127.0.0.1:8787`.
- `TEMPO_JOIN_TOKEN` (from your personal link) is only ever sent to the hub named in `TEMPO_HUB_URL`, never to something that answered on the network.

**Pinned to your hub**
- After the first join the agent remembers your person id.
- A later mDNS answer counts only if its TXT `pid` matches (`sha256(person_id)[:12]`, which the hub advertises). A teammate's hub or a fake one is ignored.

**Reliability**
- After 4 failed sends in a row the agent looks for the hub again, because the hub's IP can change with DHCP.
- While the hub can't be reached it queues up to **1000** events (oldest dropped first) and sends at most 500 per request.
- `seq` is saved as soon as it's assigned, so it is never reused.

**Stops on 401**
- If the hub no longer knows the computer (you removed it, or the hub's database was reset), the agent logs `STOPPED: …` and exits cleanly.
- It stays stopped across restarts and logins, and never re-joins in a loop. To connect again, run `--rejoin --install` (or just `--rejoin` to run it in a terminal).
- A 403 while joining means "not let in yet": it waits politely and retries every 10 s.

**Privacy**
- `app` is always the process name (macOS `lsappinfo`, Windows process image, Linux `/proc/<pid>/comm`). It is never parsed from a window title.
- Titles are sent only with `TEMPO_AGENT_TITLES=1`, and then they're marked `untrusted-external`.

**Time**
- Every event has `event_time` as local time with its offset (`2026-10-25T01:30:00+01:00`) plus `tz`, the IANA zone read from the system (`Europe/London`).
- Override the zone with `TEMPO_AGENT_TZ`.

## Time, and tonight's clock change

UK clocks go back at **02:00 BST on Sunday 25 October 2026**, to 01:00 GMT, so **01:00–01:59 happens twice**:
- First pass: BST, 00:00–00:59Z.
- Second pass: GMT, 01:00–01:59Z.

The hub keeps the two 01:30s as two different events.

**What's stored for every event**
- `event_time_utc`: the instant.
- `event_offset`: the person's clock offset at that instant (`+01:00` / `+00:00`), or null if unknown.
- `event_tz`: the IANA zone, if the sender said.
- `event_fold`: `earlier` / `later` inside a repeated hour. This is set automatically when the zone is known.

**How times are read**
- **A local time without an offset** (`"2026-10-25T01:30:00"`) is read in the event's `tz`, or `TEMPO_HOME_TZ` (default `Europe/London`). `fold: "later"` picks the second pass.
- **A `Z` time** says nothing about the local clock. Its offset stays unknown unless `tz` is given. Events from your own devices get the home zone's offset.
- Health Connect's envelope `timezone` and its records' zone offsets are kept. A `timezone` of `UTC` is treated as unknown.
- Health Auto Export dates carry their own offset.
- The desktop agent sends offset + `tz`.

The model and the MCP tools see each event's `local` time, e.g. `Sun 01:30 BST (1st)` and `Sun 01:30 GMT (2nd)`, next to its UTC `time` and `offset`. The model is also told the current local time.

```bash
curl -X POST localhost:8787/api/events -H "Authorization: Bearer <device_token>" -H 'Content-Type: application/json' -d '{"events":[
  {"kind":"health.heart_rate","payload":{"value":58},"event_time":"2026-10-25T01:30:00","tz":"Europe/London","fold":"earlier"},
  {"kind":"health.heart_rate","payload":{"value":61},"event_time":{"local":"2026-10-25T01:30:00","tz":"Europe/London","fold":"later"}}]}'
# → accepted 2: 00:30Z (+01:00, earlier) and 01:30Z (+00:00, later)
```

The envelope v1 object form of `event_time` (`{utc|local, offset, tz, fold}`) is accepted, as above.

## Try it without real devices

```bash
.venv/bin/python scripts/simulate.py http://127.0.0.1:8787 <ingest_key>
.venv/bin/python scripts/simulate.py '<an app URL copied from the page>'          # same thing
.venv/bin/python scripts/simulate.py http://127.0.0.1:8787 <ingest_key> --clock-change
```

This pretends to be:
- A Nothing Phone (HC Webhook format, phone zone Europe/London).
- An iPhone (Health Auto Export, offsets from the home zone, so they're right after 02:00 too).
- OwnTracks.
- A GWR delay notification. It's stored as **one `notification.signal`**, `untrusted-external`, class `vault`, so the search "train delay" finds it.
- The hub's **mock Conductor rule** then turns it into one `mission.suggested` event: *"Claim £14.20 Delay Repay for the 08:12 to London Paddington (34 min late)?"* (labelled as a mock rule, written by the "Conductor (mock rule)" device; the fare is `TEMPO_DEMO_FARE_GBP`). Remove that device to turn the rule off.

Everything is sent with `?simulated=1`. The hub marks each event `payload._simulated = true` and its source `<app>:simulated`. It doesn't use a special trust level.

`--clock-change` also sends one reading at 01:30 BST and one at 01:30 GMT on the clock-change night: last night's on Sunday, tonight's before then. They're stored as two events an hour apart.

**Getting the key:** copy an app URL from the page (**Show full app URLs**), or on the hub computer:
```bash
TOKEN=$(curl -s -X POST localhost:8787/api/devices/register -H 'Content-Type: application/json' -d '{"name":"Terminal"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["device_token"])')
curl -s -X POST localhost:8787/api/integrations/reveal -H "Authorization: Bearer $TOKEN"
```

Then ask on the page, or:
```bash
curl -X POST localhost:8787/api/ask -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"question":"Did anything happen with my train today?"}'
```

## Secrets

- **Device tokens** are bearer secrets. Each one belongs to one device, and removing the device kills it. The desktop agent keeps its token in `~/.tempo/agent.json` (mode 600).
- **The personal link** (`join_token`) lets a device join from anywhere the hub is reachable.
  - It is never printed in the banner.
  - The page shows it only to joined devices, labelled *same Wi-Fi only* unless `TEMPO_PUBLIC_URL` is set.
- **The ingest key** sits in every app URL (`?key=…`).
  - It is masked in `/api/integrations` and on the page.
  - The full URLs come from `POST /api/integrations/reveal`, and each reveal is announced.
  - There is no access log, so the key doesn't end up in log files.
- **Rotate** with **Make a new link and app key** on the page, or `POST /api/keys/rotate` with the body `{"join_token": true, "ingest_key": true}`.
  - Old links and app URLs stop working at once. Joined devices keep working.
  - After rotating the ingest key, paste the new URLs into each app.
  - Rotate after any key was shown on a projector or shared screen.
- `data/` (the database and its backups) is readable by you only.
- **The Kairos iPhone app** gets its own token from `scripts/device_admin.py add-device --name "Kairos iPhone app" --token-file data/kairos_app.token` (reads and asks, never admin). `device_admin.py app-link --token-file data/kairos_app.token --copy` puts the app's setup link (`kairos://setup?k=…&u=…&t=…`) on the clipboard without showing it: paste it into Safari or Notes on the iPhone and tap it, then copy something else. Owner-only capabilities (`vault`, `hands`, `guardian`) come only from this script, never from a device signing itself up.
- **Write for me drafts** are encrypted with `data/bridge.key` (or `KAIROS_DRAFT_KEY`), last 24 hours, belong to the device that made them, and go with **Forget everything**. Changing the key retires open drafts.

## Forget

**On the page**
- Each fact under what Tempo knows has a button such as **Forget all heart-rate data**. It forgets that whole topic, so the next reading can't take the forgotten one's place.
- **Forget me** forgets everything. Your devices stay connected.
- The **Agent requests** card lists what agents asked to forget, with **Approve** and **Decline**.
- The **Waiting for your OK** card lists steps agents want to take (`approval.requested`, the Conductor's `mission.suggested`), with **Approve** and **Decline**.

**`POST /api/forget`** must say what to forget, or you get 400:
- `{"ids": ["#42", "<id>"]}`
- `{"kinds": ["health.heart_rate", "health.resting_heart_rate"]}` (exact kinds; a fact's `forget.kinds`)
- `{"kind_prefix": "location."}`
- `{"device_id": "d_…"}`
- `{"all": true}`. This first saves a backup to `data/backups/<UTC time>.db`, on purpose, as an undo. Delete the backup yourself when you're sure.

Unknown fields are rejected, so a typo can't wipe everything.

**What happens after a forget**
- Forgotten records **don't come back**: a tombstone drops them when an app sends them again (`forgotten` in the reply counts them).
  - A `kind_prefix` forget also drops anything of that prefix sent again with an event time at or before the forget.
  - ids, kinds, device and "all" forgets tombstone exactly the records they deleted, so new records still arrive: a fresh demo seed, another phone's history, an agent's offline queue.
- Events derived from a forgotten one go too, e.g. the `mission.suggested` made from a forgotten rail notification. The receipt lists them as `derived_refs`, and `TEMPO_CONDUCTOR_URL` gets the receipt.
- Deleted rows are overwritten on disk (`secure_delete`), and the WAL is checkpointed.
- The hub appends a `forget.done` receipt with only the refs or selector and a count, never the content. Open pages drop those rows, and agent caches can drop theirs.

**Agents can't delete; they ask.** MCP `request_forget` writes a `forget.requested` event. The person reviews it and decides:
- `GET /api/forget/requests` lists pending requests, each with a summary such as "everything under 'location.' (312 events now)".
- `POST /api/forget/requests/{hub_seq}/approve` forgets exactly that selector and records `forget.approved`.
- `POST /api/forget/requests/{hub_seq}/decline` records `forget.declined`.

Only exact requests can be approved: event refs, a kind like `location.`, or a device. An agent can never ask to forget everything.

**Approvals work the same way.** MCP `request_approval` writes `approval.requested`; the mock Conductor writes `mission.suggested`.
- `GET /api/approvals` lists the pending ones.
- `POST /api/approvals/{hub_seq}/approve` or `…/decline` records hub-only `approval.granted` / `approval.denied {request: '#N'}`. Any of the person's own devices may decide; ask-only devices can't.
- The agent gets the decision by sending the same `request_approval` again (or the same `idempotency_key`). `TEMPO_CONDUCTOR_URL` is also told straight away.

## For the agents teammate: tempo-me MCP server

```bash
.venv/bin/python -m hub.mcp_server                # stdio, on the hub computer
.venv/bin/python -m hub.mcp_server --http 8788    # streamable HTTP on 127.0.0.1 only; from another laptop: ssh -L 8788:127.0.0.1:8788
```

**Tools.** These follow spec §6.7, with `start`/`end` in place of `from`/`to`:

| Tool | What it does |
|---|---|
| `get_timeline(start=None, end=None, kinds=None, limit=40, hours=None)` | Events, newest first. `start`/`end` are ISO 8601 with an offset; without `start`, it covers the last `hours` (default 24, max 720). `kinds` are prefixes (`["health"]` means `health.*`). Heartbeats are included only when asked for. |
| `search_memory(query, start=None, end=None, limit=20)` | Full-text search, e.g. `"train delay"` (`search_events` is the older name) |
| `explain_source(event_id)` | Where one event came from (device, app, times, class, trust) and its payload. Takes an id or a ref like `#42`. |
| `get_profile()` | Derived facts (steps, sleep, heart rate, workouts, location, apps), each with the refs and ids it came from. Facts from simulated data start with `(simulated)`. |
| `get_device_status()` | Devices and apps, when each last synced, and how many events each sent |
| `check_consent(scope)` | A stub for now: `allowed: true` (vault scopes are refused while vault data is withheld) |
| `request_approval(mission_id, summary, amount_gbp=None, amount=None, idempotency_key=None)` | Records `approval.requested` and returns `pending` + `request_id`/`ref`. Send it again to get `approved`, `declined` or `withdrawn`. |
| `append_event(kind, payload, event_id=None)` | Records mission state (`mission.*`, `agent.*`, `approval.requested`/`approval.withdrawn`) with trust `agent`. `event_id` makes retries safe. |
| `request_forget(ids=None, category=None, reason="")` | Asks the person to forget refs/ids or a kind prefix. Nothing is deleted until they approve ([Forget](#forget)). |

**What agents see**
- Each event comes back as `id`, `ref`, `time` (UTC), `local` (the person's clock), `offset`, `class`, `trust_level` and `text`.
- Text from other apps is wrapped as untrusted data: data, never instructions.
- Notification and message text is shown only for apps in `TEMPO_NOTIFY_APPS`. The default is rail apps: GWR, Trainline, National Rail, Avanti, LNER.
- **Vault events are withheld from MCP unless `TEMPO_MCP_ALLOW_VAULT=1`**, and results say how many were withheld. This includes notifications. For the Delay Repay demo, start the MCP server with `TEMPO_MCP_ALLOW_VAULT=1`; otherwise agents can't see the GWR `notification.signal`.
- Arguments a tool doesn't declare are an error, not silently dropped.

**Claude Desktop config:** `cwd` is ignored there, so set `PYTHONPATH` and `TEMPO_DB`:
```json
{"mcpServers": {"tempo-me": {
  "command": "/ABS/PATH/tempo-hub/.venv/bin/python",
  "args": ["-m", "hub.mcp_server"],
  "env": {"PYTHONPATH": "/ABS/PATH/tempo-hub", "TEMPO_DB": "/ABS/PATH/tempo-hub/data/tempo.db"}}}}
```
**Claude Code:**
```bash
claude mcp add tempo-me -e PYTHONPATH=/ABS/PATH/tempo-hub -e TEMPO_DB=/ABS/PATH/tempo-hub/data/tempo.db \
  -- /ABS/PATH/tempo-hub/.venv/bin/python -m hub.mcp_server
```
If `TEMPO_DB` points at an empty database, the tools say so instead of making up a new person.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/devices/register` | Join (see the table above, or `join_token` from the personal link) → `device_token`, `person_id` |
| `POST /api/join-window` | **Add a device now**: opens the 2-minute join window |
| `POST /api/events` | A device pushes `{events:[{kind, payload, event_time, tz, fold, seq, id}]}`. Duplicates and forgotten records are ignored. At most 1000 per request (413 above that). Hub-only kinds (`device.`, `forget.`, `approval.`, `hub.`, `consent.`, `mission.`, `agent.`) get 422, and so does a `seq` outside 0..2^53. |
| `GET /api/events?after=N` | Everything after hub sequence N (the change cursor), plus `latest_hub_seq` |
| `GET /api/devices` / `DELETE /api/devices/{id}` / `POST /api/devices/{id}/unblock` | List devices (and blocked apps), remove one, unblock an app |
| `GET /api/link` / `POST /api/keys/rotate` | Personal link (`masked` for the screen; each read is announced as `hub.link_shown`) / new link and/or ingest key |
| `GET /api/integrations` / `POST /api/integrations/reveal` | App URLs, masked / in full (announced) |
| `POST /api/ingest/{source}?key=…` | Apps push here: `health-connect`, `health-auto-export`, `shortcut`, `owntracks`, `tasker`, `generic`. Removed apps get 410; bodies over 20 MB get 413. |
| `POST /api/forget`, `GET /api/forget/requests`, `POST /api/forget/requests/{n}/approve`, `…/decline` | Forget, and agents' forget requests |
| `GET /api/approvals`, `POST /api/approvals/{n}/approve`, `…/decline` | Steps agents want to take, and the person's decision |
| `GET /api/timeline?hours=24` or `?start=…&end=…` (ISO 8601), `&kinds=health,location` | The model's view of the log (400 for a bad time or kind) |
| `GET /api/profile`, `POST /api/ask` | Memory and model. `/api/ask` takes `{question, language?}` (e.g. `"cy"`, `"en_GB"`), and allows 20 questions/min per device with 2 in flight (429 + `Retry-After`). Ask-only callers get the answer without `#42` refs (they're in `refs`), since a voice agent reads it aloud. |
| `/docs`, `/openapi.json` | API docs, served only on the hub computer itself (404 from other devices) |

Event fields follow envelope v1 in `research/Tempo-Sync-Methods.md` §6.3: `hub_seq`, `seq`, `hlc`, `kind`, `event_time_utc`, `event_offset`, `event_tz`, `event_fold`, `class`, `trust_level`, `payload`, `consent_scope`, `v`, `sig`, `body_raw`.

**Rules the hub applies to every event**
- Kinds are lower-cased.
- Client ids are stored per device (`<device_id>:<id>`).
- Only `health.`, `location.`, `node.`, `desktop.` and `device.` events keep device/app trust. Everything else from a device or app is `untrusted-external`.
- `health`, `location`, `desktop`, `notification`, `sms`, `email` and `message` events are always class `vault`. A client can raise an event's class, never lower it.
- NaN and Infinity are stored as null. `deps` comes back as the list that was sent.
- A device's `seq` numbers are checked for gaps; the device list shows "N missed" when some never arrived.
- After new notifications are stored, the mock Conductor rule runs on them (rail delays only), and with `TEMPO_CONDUCTOR_URL` set the hub also POSTs `{signals, suggestions}` there in the background. Only notifications from `TEMPO_NOTIFY_APPS` apps are sent.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `TEMPO_PORT` | 8787 | Hub port |
| `TEMPO_DB` | `data/tempo.db` | Database file (the MCP server needs it too) |
| `TEMPO_HOME_CIDR` | unset | Your own network, e.g. `172.20.10.0/28`: first-device join, LAN auto-join, mDNS |
| `TEMPO_LAN_AUTOJOIN` | 0 | 1 = any device on `TEMPO_HOME_CIDR` joins by itself |
| `TEMPO_MDNS` | 0 | 1 = advertise `_tempo._tcp` (only when this computer is on `TEMPO_HOME_CIDR`) |
| `TEMPO_PUBLIC_URL` | unset | A tunnel/HTTPS URL; when set, nothing joins automatically and the personal link works anywhere |
| `TEMPO_HOME_TZ` | Europe/London | Zone for local times that come without one |
| `TEMPO_LLM_BASE_URL` / `_MODEL` / `_API_KEY` / `_TIMEOUT` / `_BUDGET` | Ollama, qwen2.5:7b, 60 s, 25 s | The model |
| `TEMPO_LLM_ALLOW_VAULT` | 0 | 1 = also send vault data to a model that isn't on this computer or the local network |
| `TEMPO_LLM_FALLBACK_BASE_URL` / `_MODEL` / `_API_KEY` | unset | A second provider, tried when the first fails |
| `GEMINI_API_KEY` | `agents/.env` | Gemini via its OpenAI-compatible endpoint when no `TEMPO_LLM_BASE_URL` is set |
| `KAIROS_GEMINI_MODEL`, `KAIROS_GEMINI_FALLBACK_MODEL`, `KAIROS_BRIDGE_MODEL` | gemini-3.5-flash-lite, gemini-2.5-flash (thinking off), gemini-3.5-flash | Voice/ask model, its backup on the same key, and the Write for me writer (measured 25 Oct: ~0.7 s tool pick, ~1.5 s spoken answer, ~5 s Telugu draft; gemini-3.8-flash was overloaded) |
| `KAIROS_LOCAL_MODELS` | 1 | 0 = API keys only, never Ollama |
| `KAIROS_SERVER_MODE` | 0 | 1 = the app's server: through the tunnel only `/api/me`, `/api/ask`, `/api/voice/session`, `/api/bridge/*` and `/api/consents` answer (by token), never admin, never a device that joined via 'Add a device now' |
| `KAIROS_KILL_VOICE`, `KAIROS_KILL_SEND` | 0 | 1 = stop voice calls/answers, or Write for me approvals, at once (also live from `voice/.env`) |
| `KAIROS_VOICE_SESSIONS_PER_DAY`, `KAIROS_DRAFTS_PER_DAY`, `KAIROS_REVISIONS_PER_DAY`, `KAIROS_READBACKS_PER_DAY`, `KAIROS_SENDS_PER_DAY`, `KAIROS_NEW_RECIPIENTS_PER_DAY` | 4, 60, 120, 60, 30, 5 | Daily (UTC) limits, counted before each paid call; `scripts/reset_demo.py --yes` resets today's |
| `KAIROS_DRAFT_KEY` | `data/bridge.key` | Write for me draft encryption key: base64 of exactly 32 bytes |
| `TEMPO_MCP_ALLOW_VAULT` | 0 | 1 = MCP tools also return vault events |
| `TEMPO_NOTIFY_APPS` | GWR,Trainline,National Rail,Avanti,LNER | Apps whose notification text the model, agents, `/api/timeline` and the page's live timeline may show (`*` = all) |
| `TEMPO_CONDUCTOR_URL` | unset | The agents teammate's Conductor: new allow-listed notification signals are POSTed there |
| `TEMPO_DEMO_FARE_GBP` | 28.40 | Fare the mock Conductor rule assumes for Delay Repay |
| `TEMPO_HUB_URL`, `TEMPO_JOIN_TOKEN` | unset | Desktop agent: which hub, and the personal-link token for it |
| `TEMPO_AGENT_TITLES`, `TEMPO_AGENT_INTERVAL`, `TEMPO_AGENT_TZ`, `TEMPO_AGENT_STATE` | 0, 15 s, system zone, `~/.tempo/agent.json` | Desktop agent |

## The honest limits (v0: harden before real users)

- **Every phone OS asks its owner to tap "Allow" once** for health, notifications or location. No third-party app can skip that. Everything after that one tap is automatic.
- **Plain HTTP on the LAN.** Tokens and events cross the Wi-Fi in clear text. HTTPS needs a tunnel (`TEMPO_PUBLIC_URL`), and then only the personal link joins. Events aren't signed or end-to-end encrypted yet: `sig` and `body_raw` are stored so they can be verified later.
- **Any joined device is the owner.** Every device token can read everything over HTTP (vault included), forget, remove devices and rotate keys. There are no per-device scopes yet.
  - Only the MCP server is limited: it can *request* a forget and has vault withheld.
  - An agent that needs HTTP (the ElevenLabs voice agent) gets an **ask-only** token from `scripts/device_admin.py add-agent --name … --token-file …`: `/api/ask` and `/api/me` only, never vault data. Anything arriving through a tunnel is ask-only too, whatever its token.
  - Ask-only callers can still answer travel questions. A delay or cancellation from an allow-listed rail app (`TEMPO_NOTIFY_APPS`) becomes one L1 `signal.rail_delay` per train per day, holding only the operator, service, delay and cancellation, never the message text. Forgetting the notification forgets it too.
  - Rail alerts are read by rules, not a model, tested on 189 realistic alerts (`tests/test_rail_corpus.py`). New wordings will still be misread sometimes, so the hub is careful in what it says:
    - A **Delay Repay suggestion** is made only from a high-confidence alert: the delay or cancellation is stated plainly in the sentence about your train, with no hedging, no money, receipt or correction wording, and a plausible date.
    - A low-confidence alert is still recorded, but spoken as "GWR sent an alert about the 08:12 …: it may be delayed; check the app".
    - The test asserts that none of the 41 alerts a fresh fuzzer wrote produces a wrong high-confidence claim.
  - A rail signal needs a named train (its departure time) **and** an actual delay or cancellation. "Departs in 15 minutes", adverts, line-wide warnings and Delay Repay claim updates don't count. A newer alert updates the signal ("now 41 minutes late", "cancelled", "now running on time"); an older one arriving late doesn't.
  - On ask-only channels, questions about private topics (steps, sleep, heart, location, messages) get the hub's fixed reply, "That's private on this channel…", without asking the model, so it can't invent numbers. Welsh train questions are answered by the hub in Welsh. Private data is never searched there, and no counts reveal what it holds.
  - To let one ask-only device's answers use private data (health, location, notification text, desktop), run `scripts/device_admin.py vault <device_id> on`. For the voice agent, those answers are then spoken via ElevenLabs. Only the hub computer's owner can do this; a device can't ask for it when it joins.
- **WhatsApp (optional, via [wacli](https://github.com/openclaw/wacli) on the hub computer).**
  - Run `scripts/wacli_secret.py` once. Then `wacli sync --follow --webhook-allow-private --webhook "http://127.0.0.1:8787/api/ingest/whatsapp?key=$KEY" --webhook-secret "$(cat data/wacli.secret)"`. Without `--webhook-allow-private`, wacli refuses a localhost webhook and nothing arrives.
  - The hub accepts it only from loopback, and only with a valid `X-Wacli-Signature`.
  - Messages are `message.whatsapp`, always vault and untrusted. Their text is hidden unless WhatsApp is in `TEMPO_NOTIFY_APPS`.
  - Phone numbers become keyed pseudonyms, and media keeps its type and size but never the file name.
- **Hands audit log.** Every task Tempo's agents carry out on the phone or laptop is logged with `POST /api/hands/log`, as private (vault) `hands.task` events: the task, whether you confirmed it, its status, short step labels and the answer.
  - Only a write-only device made with `scripts/device_admin.py add-hands --name … --token-file data/hands.token` can write it. It can't read anything, works only from this computer, and the `hands.` kind is reserved for it.
  - The voice agent, the tunnel, remote models and MCP agents never see it.
- **Device tokens are stored hashed** (`sha256:`), in the database and its backups. This is one-way: going back to hub code from before 24 Oct 20:40 would make every device token stop working (re-join the devices, and re-run `device_admin.py add-agent` for the voice agent).
- **Still plaintext in `data/`:** the personal-link join token and the ingest key (the page has to show them). Never copy, zip or AirDrop `data/`; if a copy leaks, use "New link and app key" (`POST /api/keys/rotate`).
- **Rotating the ingest key stops WhatsApp silently**: wacli keeps the old URL and gets 401. Restart wacli with the new key. Its secret and URL sit on wacli's command line, which other local users can read with `ps`; that's fine on a personal Mac. A token is shown once: in the join response, or in `device_admin.py`'s token file.
- **The join window trusts the local network for 2 minutes.** Anyone on the same Wi-Fi who opens the hub in that time gets in. It's announced as `device.joined`; remove anything you don't recognise.
- **One ingest key for all apps.** Removing an app blocks that app, but a leaked key means rotating it and re-pasting the URL into every app.
- **Addresses move.** App URLs and the personal link contain the hub's LAN IP, so after a DHCP change they break.
  - Use a hotspot with a fixed IP, or the `.local` URLs.
  - The desktop agent finds a moved hub only through mDNS (`TEMPO_MDNS=1` on `TEMPO_HOME_CIDR`), or after you change `TEMPO_HUB_URL`.
  - Venue Wi-Fi with client isolation blocks phones entirely.
- **Clocks are trusted.** A device's own event time is believed as sent. The model's and agents' views leave out events more than 5 minutes in the future.
- **Consent is a stub.** `check_consent` allows everything except vault scopes. Approvals are real, but there is no push notification yet: the card shows up on open pages.
- **Hidden notification text is still stored**, as class `vault`. It's hidden from the model, agents, `/api/timeline` and the page's live timeline (which shows `[notification from WhatsApp hidden]`). But every joined device can still read the raw text through `/api/events` (each such event carries `hidden: true` and a `display_text`). On stage, forward only the notifications you'd project (e.g. the GWR app).
- **Backups keep forgotten data.** `data/backups/` holds the copy taken before each forget-all.
- **Desktop agent:** the Linux version needs X11 (`xdotool`; Wayland isn't supported). Windows zone names cover common zones; install `tzlocal` for the rest.
- **Re-sending after a forget:** after rehearsing "Forget me", the exact records it deleted stay forgotten, so `simulate.py` can't re-store the same ones. Run `scripts/reset_demo.py --yes` before re-seeding. It clears tombstones and simulated Delay Repay suggestions, plus any Approve/Decline you tapped on them, so the claim card comes back. Real data is never touched. Full reset for a rehearsal: Forget me, then `reset_demo.py --yes`, then `simulate.py`.
- **Removed devices get 410.** The page then waits for a **Join now** tap instead of re-joining by itself, so a forgotten tab can't take the next join window.
- **One person per hub.**

## Agents inside the app: the letter reader

The helpers that work for a person from inside the Kairos app live in [`agents/`](agents/README.md). The first
one reads a photographed letter, bill or form and says, in the person's language and dialect, what it is, what
it means, whether they owe money and what to do by when; it then remembers the summary and each deadline here
in the hub (`document.read`, `document.deadline`, class vault) so Kairos can answer "what's due this week?".

```bash
agents/set_gemini_key.sh    # once: Gemini key from the clipboard into agents/.env (the agents' model)
agents/run.sh               # 127.0.0.1:8789; phones reach it via voice/token_server.py at /voice/agents/*
.venv/bin/python agents/scripts/join_hub.py   # once: gives it a device here (owner's way, like device_admin.py)
```

## Guardian: the vault and the blue team

Scammers steal with urgency; Kairos defends with time. [`guardian/`](guardian/README.md) is the part that makes the other
agents safe to trust: an **encrypted vault** of what Kairos learns about the person (a key per category, so "forget my
payees" destroys the key; blind-index search; a hash-chained, Ed25519-signed log of every read and write), the person's
**rhythm** (usual payees, hours, apps, struggles → "unusual for you" scoring and a spoken monthly review with the time
returned), and a **blue team** of watchers over the agents (no payment without the owner's tap and a verified name, no
approval from an agent, no code read aloud, each agent on its own rails, canary payees, a sentinel for text in and out,
a signed manifest of the agents' code). A **lockdown** file stops the Navigator and the hands; the phone's Shield shows why,
and only the owner (Face ID) lifts it. Design: `research/Kairos-Guardian-Architecture.md`; research: `research/Kairos-Guardian-Threats-and-Defence.md`.

```bash
.venv/bin/python -m guardian run       # separate process: tails the hub, watches, writes guardian.* events + data/guardian_status.json
.venv/bin/python -m guardian seal      # after any deliberate code change (otherwise the Guardian locks down on "code changed")
.venv/bin/python -m guardian attack    # the red team: ten attacks, each caught, in plain words (--live against the running hub)
.venv/bin/python -m pytest -q tests/test_guardian_*.py
```

Hub routes: `GET /api/guardian/status|alerts|catalogue|pubkey` (own devices), `GET /api/guardian/profile|review|integrity|vault|vault/log`,
`POST /api/guardian/lock|unlock|vault/forget` (admin), `GET /api/guardian/vault/export` (admin, this computer only). The voice
server serves `GET /voice/guardian/status` and `POST /voice/guardian/unlock` to the Kairos app with the phone key.

## Tests

```bash
.venv/bin/python -m pytest -q tests
```

## Navigator: banking and mobile money, with the owner's Yes in the middle

"Pay the electricity bill." "Send fifty pounds to my son." `navigator/` drives the person's bank app on their own
phone, fills in the exact details, reads the bank's review screen back, checks the recipient's name against the
payee book (Confirmation of Payee), and presses Confirm only after the owner taps Yes on the Kairos card and passes
Face ID. Every step is a time-stamped `money.*` event here in the hub (`GET /api/money/ledger`, shown on the page
as "Payments by the Navigator"). The demo bank lives at `/oxbank/`. See [navigator/README.md](navigator/README.md).

```bash
.venv/bin/python -m navigator "send fifty pounds to my son for rent" --mock --approve
.venv/bin/python -m navigator "send fifty pounds to my son" --mock --mode cop_mismatch   # the bank shows another name: stops
```
