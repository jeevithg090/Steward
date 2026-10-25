# Tempo A–Z: one product, in the new UI's theme

*Started Sun 25 Oct 2026, 04:10 BST, in `tempo/` on `main` at 45e6f3f (GitHub pulled). This file is
the plan, the contracts every track builds against, and the status log. `SHIPPING.md` stays the
record of what shipped before tonight; this file is what turns the new UI and the existing
backend into one demo-ready product. Read §4 (contracts) before touching code.*

---

## 0. Where we start

The pull brought seven commits from Kyrylo (03:05–03:34): the Next.js site under `apps/web` was
replaced by a Vite + React 19 + Tailwind chat app ("Nexus AI Agent"). What it has, and what it
lacks:

| Has | Lacks |
|---|---|
| A theme worth keeping: dark navy sidebar (`#0d0066`), near-black canvas (`#0a0a0c`), charcoal cards (`#1f1f22`), indigo badges, rounded pills, lucide icons | A `MemoryPage` it imports but never committed, so it does not build |
| An avatar panel with a lip-synced SVG face, blink, level meter; four personas | `vite.config` with no `.ts`; the old pnpm `node_modules` next to a new `package-lock.json` |
| ElevenLabs text-to-speech straight from the browser, with browser speech as fallback | A browser-held ElevenLabs key: the Gateway's own key is never used |
| A chat that posts to `POST /missions`, shows the consent ask, approves, stops, and listens on `/events` | Every typed message starts the same hard-coded 08:12 Oxford→Paddington claim, whatever was typed |
| A sidebar of conversations, resizable panels, a settings page for model keys | Everything else Tempo does: Mission Control, Proof Trace, Court votes, Rights Decay, Passport, Memory Card, Profiles, Skills, Scam Shield, Read It To Me, Entitlement Check, Patience Profile, Privacy Proof, the story |
| A Tauri desktop config | The 92 web tests, the recorded showcase fixtures, CI for the web app, the Vercel path |

The Gateway (`apps/gateway`) is untouched and complete: 50 routes, 1,270 fast tests, ruff and
mypy clean, 7 skills, 12 rule packs, 7 profiles valid (checked at 04:05).

**Tonight's job:** keep the theme and the chat-first shape, and build the frontend and backend so
that every Tempo feature is reachable from it, works with no keys (replay) and with no Gateway
(showcase), and can be started with one command.

---

## 1. Decisions (settled; do not reopen at 05:00)

1. **The frontend is the teammate's Vite app**, kept and extended. No return to Next.js. The
   Nexus palette stays as the theme; the visible name becomes **Tempo** (title, sidebar, Tauri).
   The Tailwind tokens keep their `nexus-*` names so the existing components need no churn.
2. **npm, not pnpm, for the web app.** The teammate committed `package-lock.json`; CI, the
   Makefile and the docs switch to `npm ci`. Node 22+. (Python stays on uv.)
3. **Chat is the front door, pages are the depth.** Free text goes to a new `POST /chat` whose
   router is **code, not a model**: rules classify the intent and pull the facts out; a model
   (when a key exists) may only phrase small talk and never a number, a promise or an action.
   Each feature also has its own page, reachable from the sidebar, for judges who want to see
   the machinery.
4. **Hash routing** (`#/chat`, `#/missions/:id`, …): no router dependency, works as a static
   file on Vercel, in `vite preview`, and inside Tauri.
5. **Keys stay on the server.** A new `POST /voice/tts` proxies ElevenLabs with the Gateway's
   key; the browser falls back to the Web Speech API when the Gateway has no key. The teammate's
   "paste your own ElevenLabs key" stays as a second path for the desktop app.
6. **Speech in uses the browser** (`SpeechRecognition`, Chrome and Safari); no Whisper tonight.
   Where it is unsupported, the mic records a clip and the chat says so.
7. **Showcase mode returns.** `VITE_TEMPO_SHOWCASE=1` (or `?showcase=1`) serves the 38 recorded
   Gateway responses from the old site, restored under `apps/web/src/showcase/`, so the app runs
   on Vercel with no backend. The badge says **SHOWCASE · recorded replay · no Gateway**.
8. **Dev ports:** Vite on **3000** (the Gateway's default `WEB_ORIGINS`), Gateway on **8000**
   (the UI's default). The Gateway is always started **from a scratch folder**, never from
   inside `tempo/` (its `.env` points `DATABASE_URL` at a hosted database).
9. **Out of scope tonight:** Tempo Mesh in the new UI (device pairing, passkey approvals, push).
   Approvals use the bearer token, as the chat already does. The Mesh code and its Gateway
   routes stay; the old Playwright Mesh spec is replaced by a smoke spec. Tauri is configured
   but not built here (no Rust toolchain on this Mac).
10. **Honesty labels stay visible:** the health badge (REPLAY · SIMULATED company, rail data,
    jurors, vision), `demo-values` on skills, the showcase badge, and "Model keys here label
    the reply; the Gateway's deployment mode chooses the jurors" on the settings page.

---

## 2. The product: pages and the story

Margaret is 74, stammers, and rings from a landline. Her 08:12 to Paddington was 38 minutes
late. The chat tells that story in her words; each page shows one part of the machinery.

| Route | Page | What a judge sees | Gateway |
|---|---|---|---|
| `#/chat` | **Chat** (home) | Type or say "my 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40". Tempo understands, prices it, asks once (Proof Trace and Court votes inline), claims on Yes, waits for the money, says when it arrived. Paste a scam text and it warns. Ask what it remembers. Say STOP. Sample chips for every beat. | `POST /chat`, `/approvals`, `/missions/{id}/stop`, `WS /events`, `POST /voice/tts` |
| `#/missions`, `#/missions/:id` | **Mission Control** | Every mission with its state, timeline with latencies, Proof Trace (fact → rule → citation → amount), Consensus Court, Rights Portfolio (wait on purpose, with the date and the odds), Agent Passport card, outcome, trace link. Demo controls: check the payment now, jump the clock 31 days, the credit arrives. Ledger counters. | `/missions*`, `/ledger`, `/scheduler/tick`, `/demo/clock`, `/demo/credit/{id}`, `/mandates/{id}/revoke` |
| `#/memory` | **Memory** | The Memory Card by category with source, date and trust; the timeline with superseded facts struck through; Forget (everywhere), Correct, Erase all. | `/memories*`, `/timeline/{id}` |
| `#/profiles`, `#/profiles/:id`, `#/profiles/import` | **Profiles** | Who Tempo works for: seven starters, what each will do and may never do, the access settings, share as link or YAML, import a code with plain-word refusals. Pick one for the chat. | `/profiles*`, `/skills` |
| `#/skills` | **Skills** | The manifests: jobs in plain words, capabilities needed, status, operators, how to add one. | `/skills` |
| `#/shield` | **Scam Shield** | Paste a text, hear the verdict in six languages; zones warn/hold/quiet; the reasons and link findings; the Shield log; "that was real" feedback. | `/scam/check`, `/scam/shield`, `/scam/feedback` |
| `#/read` | **Read It To Me** | Photograph or pick a sample letter: what it is, what it says, who owes what, what to do by when, the clocks it starts; say your reply, get a plain draft that adds no facts. | `/letters/read`, `/letters/reply` |
| `#/owed` | **Am I Owed Anything?** | Ten plain questions, then what is worth claiming with the official page for each. Screening, not a decision. | `/entitlement/screen` |
| `#/callers` | **Who's calling?** | The Patience Profile for Margaret, Dilip and Joan: language, pace, voice, the words the voice agent is given, and the memories behind them. | `/voice/profile` |
| `#/privacy` | **Privacy Proof** | Deployment mode, region, outside AI companies, image digest against the allowlist, where the key is held, what an operator sees of a row. | `/privacy`, `/health` |
| `#/story` | **The story** | The ten beats (Hear, Read, Price, Check, Weigh, Time it, Ask once, Prove it, Remember only her words, Return the time), each linking to its page. | none |
| `#/settings` | **Settings** | Gateway URL and token (runtime, no rebuild), showcase switch, text size A/A+/A++, plain mode, reduced motion, language, the teammate's model and voice keys with an honest label. | `/health`, `GET /voice/tts` |

Shell: the teammate's sidebar (New chat, History, then the pages above in two groups: *Doing* and
*Trust*), the avatar panel on the chat page only, the honesty badge in the header of every page,
the showcase badge when no Gateway is used.

---

## 3. Architecture

```
apps/web (Vite SPA, hash routes)                 apps/gateway (FastAPI, unchanged routes + 3 new)
┌──────────────────────────────────┐              ┌──────────────────────────────────────────┐
│ src/App.tsx      shell + router  │  bearer/JSON │ POST /chat        tempo_gateway/chat.py  │
│ src/lib/api.ts   Gateway client ─┼──────────────┼▶  intent rules    tempo_core/intent.py   │
│ src/lib/showcase.ts  no-Gateway  │  WS /events  │  → MissionService / Shield / Memory /    │
│ src/showcase/*.json  recordings  │◀─────────────┼    Ledger / Entitlement (existing)        │
│ src/features/<page>/             │              │ POST /voice/tts   tempo_gateway/tts.py   │
│ src/components/{ui,layout,       │  audio/mpeg  │  → ElevenLabs with the server's key       │
│   mission}/                      │◀─────────────┤ GET  /voice/tts   {configured}            │
│ hooks/useSpeech  TTS + visemes   │              │ everything else as in SHIPPING.md §4.5    │
└──────────────────────────────────┘              └──────────────────────────────────────────┘
```

- **Models read and plan; code decides money, time and permissions.** `POST /chat` keeps that
  rule: the intent router is deterministic and tested on a vector file; the only thing a model
  may write is a small-talk sentence, and only when a chat key is configured and not in replay.
- **One answer for every door.** `/chat` calls the same `MissionService.start`, `shield.check`,
  `memory.recall` the SMS and voice doors call, so the web says what the phone says.
- **Showcase** is a `Gateway` subclass in the browser that answers from the recordings and walks
  Margaret's missions through their recorded states; the chat in showcase runs the same intent
  rules in TypeScript (a port of the Python table, checked against the same vectors).

---

## 4. Contracts

### 4.1 `POST /chat` (bearer)

Request (`ChatTurn`, `extra="forbid"`):

```json
{"user_id": "u_margaret", "display_name": "Margaret", "text": "my 08:12 Oxford to Paddington was 38 min late yesterday",
 "profile_id": null, "language": "en", "slots": {}}
```

`text` ≤ 2000 chars. `slots` is what the client already knows from earlier turns (the server is
stateless about conversations; the client echoes the merged slots back).

Response (`ChatReply`):

```json
{"intent": "rail_delay", "reply": "Your 08:12 from Oxford to Paddington on 24 October. I'll check how late it was.",
 "say": "…same or shorter, Flesch ≥ 60…",
 "slots": {"origin_crs": "OXF", "destination_crs": "PAD", "travel_date": "2026-10-24", "departure": "08:12", "fare_gbp": null},
 "needs": [{"field": "fare_gbp", "question": "What did the ticket cost?"}],
 "mission": null, "ask": null, "verdict": null, "memories": null, "ledger": null, "flags": null,
 "actions": [{"label": "Open Mission Control", "href": "#/missions"}],
 "simulated": ["company", "rail data", "jurors"]}
```

Intents (`tempo_core.intent.Intent`): `rail_delay`, `missed_visit`, `scam_check`, `letter`,
`memory_recall`, `memory_forget`, `ledger`, `entitlement`, `approve`, `decline`, `stop`,
`profiles`, `help`, `smalltalk`. Rules, in order: STOP wins; YES/NO when a question is pending
for this user; a URL, "scam", "is this real", "got a text" or a pasted message with pressure
words → `scam_check`; "forget …" → `memory_forget`; "remember" → `memory_recall`; "how much …
back", "ledger" → `ledger`; "letter", "read this" → `letter`; "engineer", "missed visit", "didn't
turn up", a provider name → `missed_visit`; "train", "late", "delay", a station or CRS, a time →
`rail_delay`; "owed", "benefit", "pension credit", "attendance allowance" → `entitlement`;
"profile" → `profiles`; "help", "what can you do" → `help`; else `smalltalk`.

Slot extraction (`tempo_core.intent.extract`): stations by name or CRS from a table
(Oxford OXF, Paddington PAD, Reading RDG, Didcot DID, Banbury BAN, Slough SLO, Swindon SWI,
Bristol Temple Meads BRI, Cardiff CDF, Birmingham New Street BHM, Manchester Piccadilly MAN,
Leeds LDS, Edinburgh EDB, King's Cross KGX, Euston EUS, Waterloo WAT, Victoria VIC, Liverpool
Street LST, Marylebone MYB, Bath Spa BTH); times `\d{1,2}[:.]\d{2}` or "8am"; dates "today",
"yesterday", "on 23 October", ISO; fares `£28.40`, "28 pounds"; the delay in minutes; providers
(Broadbandly, BT, Sky, Virgin, TalkTalk, Vodafone, EE, Plusnet, Now) and the visit date.

Behaviour: a `rail_delay` with all five facts starts the mission (`StartMission`, `profile_id`
through) and returns its view with `ask`; with a fact missing it asks **one** question (`needs`,
first missing in the order origin, destination, date, departure, fare) and never guesses the
fare. `missed_visit` likewise (provider, date). `approve`/`decline` answer the newest pending
request for this user (404 → "There's nothing waiting for your answer."). `stop` stops every
mission of this user. `scam_check` runs `shield.check(text, language, user_id, source="web")`
and returns `verdict`. `memory_*`, `ledger`, `entitlement` (reply + action to `#/owed`),
`profiles` (reply + action), `letter` (reply + action to `#/read`; the chat's camera button posts
to `/letters/read` directly), `help` (one plain paragraph listing the doors), `smalltalk` (a
canned line in replay or without a chat key; otherwise one model sentence under a prompt that
forbids amounts, promises and actions, checked by `InjectionShield`-style word rules before it
is returned).

Replay note: rail fixtures exist for OXF→PAD on 2026-10-22 07:58 and 2026-10-23 08:12, 09:12,
17:42. Other journeys run and fail safe with the Gateway's own message; the chat offers the demo
journey as a chip.

### 4.2 `POST /voice/tts` and `GET /voice/tts` (bearer)

`POST {text ≤ 600, persona: "tempo"|"negotiator"|"analyst"|"auditor"|"contractor" = "tempo",
voice: "default"|"low" = "default", language = "en"}` → `audio/mpeg`. Voice id: `voice=low` →
`ELEVENLABS_VOICE_TEMPO_LOW`, else `ELEVENLABS_VOICE_TEMPO`, else a built-in default per persona.
Model `eleven_multilingual_v2`. In-memory LRU of 200 clips keyed by sha256(voice|text). **404**
`{"detail": "voice is not configured"}` when `ELEVENLABS_API_KEY` is unset; **502** when
ElevenLabs fails. The text is never logged. `GET /voice/tts` → `{"configured": bool}`.

### 4.3 `/health` gains one field

`"chat": {"llm": "off" | "replay" | "<kind>"}` so the settings page can say honestly what phrases
small talk.

### 4.4 Web: environment and runtime config

| Variable | Default | Purpose |
|---|---|---|
| `VITE_GATEWAY_URL` | `http://127.0.0.1:8000` | the Gateway |
| `VITE_TEMPO_TOKEN` | `devtoken` | the demo bearer (passkeys are the real auth; Mesh is out of scope tonight) |
| `VITE_TEMPO_SHOWCASE` | unset | `1` → no Gateway, recordings only |

Runtime overrides in Settings, kept in `localStorage` (`tempo.gateway`, `tempo.token`,
`tempo.showcase`), read by `src/lib/config.ts` `gatewayConfig()`. `?showcase=1` on the URL also
switches showcase on for the session.

### 4.5 Web: the Gateway client (`src/lib/api.ts`)

The old typed client restored, with `@/` → `src/` and `import.meta.env`. Methods used by pages:
`health, missions, mission, ledger, start, startOfcom, readCard, answer, stop, tick,
advanceClock, creditArrives, revokeMandate, privacy, memories, forgetMemory, forgetEpisode,
correctMemory, voiceProfile, eventsUrl` plus tonight's `chat(turn): Promise<ChatReply>`,
`tts(text, persona, voice): Promise<ArrayBuffer>`, `ttsConfigured(): Promise<boolean>`,
`screen(answers): Promise<EntitlementResult>`. Shield, letters and profiles keep their own
clients (`src/lib/shield.ts`, `letters.ts`, `profiles.ts`, `catalog-client.ts`) as before.
`ShowcaseGateway` (`src/lib/showcase.ts`) overrides every one of them.

### 4.6 Web: routing and page props

`src/router.ts`: `useRoute(): {path: string; params: Record<string,string>; query: URLSearchParams}`
over `location.hash`; `navigate(path)`; `<Link to="#/…">`. Routes are matched by pattern
(`#/missions/:id`). Every page is a default-exported component with the props
`{ gateway: Gateway; user: { id: string; name: string; profileId: string | null }; showcase: boolean; speak?: (text: string) => void }`
and owns its own loading, empty and error states (`<EmptyState>` from `components/ui`). Pages
never read env or localStorage themselves; they get everything from props.

### 4.7 Web: theme tokens and conventions

Tailwind `nexus.nav #0d0066`, `nexus.nav-hi #120078`, `nexus.canvas #0a0a0c`, `nexus.card
#1f1f22`, `nexus.silver #a1a1aa`, `nexus.badge #2a1fa8`. Accents: indigo (primary, links),
emerald (yes, paid, ok), rose (stop, scam), amber (caution, demo values), purple (auditor,
proof). Shapes: cards `rounded-2xl bg-nexus-card border border-white/10 p-4`, pills
`rounded-full`, section labels `text-[10px] font-semibold uppercase tracking-wider
text-slate-400`, body `text-sm text-slate-200`, focus `focus-visible:outline
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`. Targets
≥ 44 px when `html[data-plain]`; `html[data-text-size="large|larger"]` scales the root font;
`prefers-reduced-motion` and the reduced-motion switch turn off the pulse, ping and blink.
Shared primitives in `src/components/ui/`: `Pill`, `Switch`, `ResizeHandle` (existing),
`Card`, `Button` (`primary|quiet|danger`), `Badge`, `SectionTitle`, `EmptyState`, `Spinner`,
`HonestyBadge`. Icons from lucide only. Every page: one `<h1>`, landmarks, `aria-live` for
state changes, visible focus, axe-clean in tests.

### 4.8 Web: tests

Vitest + Testing Library + jsdom + axe-core (`src/test/setup.ts`, `src/test/a11y.ts`). Each
page has at least one render test against a fake `Gateway` and one axe check. `npm run
typecheck && npm test && npm run build && VITE_TEMPO_SHOWCASE=1 npm run build` is the web check.

---

## 5. Tracks, owners, files, done-criteria

Agents create new files; the only existing files an agent edits are listed on its row. Nobody
else edits another track's files. Commits are made with `--no-verify` while sessions share the
tree (the hooks stash every unstaged file); `make check` is run by hand.

| Track | Owner | Files | Done when |
|---|---|---|---|
| **F. Foundation** | this session | `apps/web/{package.json,vite.config.ts,vitest.config.ts,tsconfig.json,tailwind.config.ts,index.html,.env.example,vercel.json,tauri.conf.json}`, `src/{main.tsx,App.tsx,index.css,router.ts}`, `src/types/types.ts`, `src/lib/*` (restored + `config.ts`), `src/showcase/*.json`, `src/components/{layout,ui}/*`, `src/features/settings/*`, `src/test/*`, `scripts/build-catalog.mjs` | `npm ci && npm run typecheck && npm run build` green with every page wired; showcase build green; stale 3000/8000 processes stopped; Gateway running from a scratch folder on 8000 |
| **A. Backend** | agent A | `packages/tempo_core/src/tempo_core/intent.py`, `apps/gateway/src/tempo_gateway/{chat.py,tts.py}`, `app.py` (wiring + health field), `main.py` (wiring), `settings.py` (new fields only), `tests/unit/test_intent.py`, `tests/integration/test_gateway_chat.py`, `tests/integration/test_gateway_tts.py`, `fixtures/chat/intents.json` (vectors), `.env.example` (one block), `docs/chat.md` | `make check` green (ruff, mypy --strict, fast suite); the two integration tests pass against `build()` through a TestClient in replay mode; `/chat` starts Margaret's mission from one sentence, asks one question when the fare is missing, warns on the HMRC text, answers YES/NO/STOP; `/voice/tts` 404s without a key and streams with one |
| **C. Chat + Mission Control** | agent C | `src/features/chat/*` (existing, extend), `src/features/missions/*`, `src/components/mission/*`, their tests | chat uses `/chat` (sample chips, one-question slot filling, consent card with Proof Trace and Court inline, camera → `/letters/read`, paste → verdict card, STOP, browser speech-to-text); the avatar speaks through `/voice/tts` first and the browser second; Mission Control shows timeline, Proof Trace, Court, Rights Portfolio, Passport, outcome, demo controls, ledger; both work in showcase |
| **D. The other pages** | agent D | `src/features/{memory,profiles,skills,shield,read,owed,callers,privacy,story}/*`, their tests | each page renders live and in showcase, is axe-clean, and matches §2's row |
| **E. Docs, CI, deploy, ops** | agent E | `.github/workflows/ci.yml` (web + security web step), `.gitlab-ci.yml` (web, e2e), `Makefile`, `README.md`, `SHIPPING.md` (§11 line + §12 pointer), `docs/{deploy,demo,accessibility,github-setup}.md`, `docs/web.md` (new), `tests/e2e/*`, `scripts/demo.sh`, `.claude/launch.json` | `actionlint` clean; the web job runs `npm ci`, typecheck, test, both builds; `make demo` brings up Gateway + seed + web from a clean clone; docs name only files that exist |
| **I. Integrate, verify, commit, push** | this session | wiring in `App.tsx`, fixes across the tree | `make check`, `make validate-skills`, the web check, a browser walk of every page with screenshots; logical commits on `main`; pushed to GitHub and GitLab |

Order: F first (the libs and primitives C and D import exist before they start), then A, C, D,
E in parallel, then I.

---

## 6. Demo (one command)

```bash
make demo        # Gateway from .tempo-demo/ (no .env) on 8000, seeded; web on http://localhost:3000
make showcase    # the web app alone, recorded data, no Gateway
```

`make demo` runs `scripts/demo.sh`: creates `../.tempo-demo/` next to the repo, starts
`uv run --project <repo> --no-sync uvicorn tempo_gateway.main:build --factory --port 8000` there
with `TEMPO_API_TOKEN=devtoken TEMPO_DEMO=1 TEMPO_MODE=replay PAYMENT_CHECK_AFTER_S=0
WEB_ORIGINS=http://localhost:3000,http://127.0.0.1:3000 TEMPO_HOME=<repo>`, waits for
`/health`, runs `scripts/seed.py` (Amir paid; Margaret's claim and broadband case waiting; her
memories; the three Patience Profile callers), then `npm run dev` in `apps/web`.

The beats, in the chat: (1) type the late train, (2) Yes, (3) "check the payment now" in Mission
Control, (4) money arrived and the ledger ticks, (5) "what do you remember?", (6) paste the HMRC
text, (7) "read this letter" → sample letter, (8) the broadband card → waiting on purpose → jump
31 days, (9) the Passport card on the mission, (10) Who's calling. `docs/demo.md` keeps the
long form.

---

## 7. Verification (in this order)

```bash
make check                       # ruff, format, mypy --strict, fast tests
make validate-skills
uv run pytest -m integration tests/integration/test_gateway_chat.py tests/integration/test_gateway_tts.py
cd apps/web && npm ci && npm run typecheck && npm test && npm run build && VITE_TEMPO_SHOWCASE=1 npm run build
make demo                        # then walk every page in a browser; screenshots in docs/screens/
```

---

## 8. Deployment

- **Web on Vercel:** framework Vite, root `apps/web`, build `npm run build`, output `dist`,
  `vercel.json` rewrites every path to `index.html` and sets the security headers (CSP allows
  the Gateway origin and `wss:`). Env `VITE_TEMPO_SHOWCASE=1` for the public showcase; or
  `VITE_GATEWAY_URL` + `VITE_TEMPO_TOKEN` for a live Gateway.
- **Gateway:** unchanged: `deploy/render.yaml`, `deploy/fly.toml`, `deploy/gateway.Dockerfile`;
  set `WEB_ORIGINS` to the Vercel host and `ELEVENLABS_API_KEY` for server-side speech.
- **Desktop:** `apps/web/tauri.conf.json` + `Cargo.toml` are Tempo-named; `npm run tauri dev`
  needs Rust, which this Mac lacks; documented, not built.

---

## 9. Honesty: what is not done, and limits

- ~~Tempo Mesh is not in the new UI~~ (phase 2 brought it in: Devices, Face ID approvals, Passport signing). Web Push still needs a VAPID key; tested with Chrome's virtual authenticator, not a real iPhone.
- Speech in is the browser's recogniser (Chrome, Safari); Firefox records a clip and says so.
- Speech out needs `ELEVENLABS_API_KEY` on the Gateway (or a key pasted in Settings); otherwise
  the browser's own voice speaks and the face still moves.
- Small talk is canned in replay; a model phrases it only with a chat key, under word rules.
- The model picker in Settings labels the reply; the Gateway's deployment mode chooses the jurors.
- Rule packs, clocks and benefit figures are demo values until a person checks each source.
- Tauri is not built here; GitHub Actions still fails at startup on the mirror account (billing).
- Translations of spoken warnings are `checked: false`.

---

## 10. Status log

- [x] 03:40 GitHub pulled (a801e7e → 45e6f3f, fast-forward); the teammate's Vite app surveyed; the Gateway baseline green (imports, ruff, 7 skills / 12 packs / 7 profiles valid)
- [x] 04:10 This plan written
- [x] 04:40 Foundation (track F) green: hash router, Tempo sidebar with the twelve pages, UI primitives in the theme, the typed client and 38 showcase recordings restored under `src/`, runtime Gateway settings, accessibility and language controls; `npm run typecheck && npm run build` in both modes
- [x] 04:45 The stale Gateway on 8000 (hosted DATABASE_URL) and the dead Next dev server on 3000 stopped; a replay Gateway started from `../.tempo-demo` and seeded; four tracks launched in parallel against this plan
- [x] 05:05 Track E done: CI on npm (`.github/workflows/ci.yml`, `.gitlab-ci.yml`), Makefile (`demo`, `demo-gateway`, `showcase`, `web-check`), `scripts/demo.sh` (tested on 8020 and against the running 8000), e2e smoke spec, README, `docs/web.md`, deploy/demo/accessibility docs on Vite
- [x] 05:10 Track D done: Memory, Profiles (+import, share), Skills, Scam Shield (+Margaret's Tuesday), Read It To Me, Am I Owed Anything?, Who's calling?, Privacy Proof, The story; 28 tests, axe-clean; share links moved to `#/profiles/import?p=`
- [x] 05:15 Track A done: `tempo_core.intent` (58 vectors, 94 unit tests), `POST /chat`, `GET/POST /voice/tts`, `/health.chat`; 1,263 fast tests, 18 integration tests, mypy --strict clean; the demo Gateway restarted on the new code and re-seeded; one sentence starts the claim with the £14.20 ask
- [x] 05:25 Track C done: the chat door on `/chat` (sample chips, one-question slot filling, consent inline with Proof Trace and Court, letter camera, browser speech in, Gateway voice → pasted key → browser voice), Mission Control (list, detail, Rights Portfolio, Passport, timeline, demo controls), the TypeScript intent port checked against the 58 shared vectors; 125 web tests in all
- [x] 05:40 Integrated (track I): recalled-memory type, `connected` page prop, dead mock removed; `make check` green (ruff, format, mypy --strict, 1,263 fast tests), 7 skills / 12 packs / 7 profiles valid, 18 chat and TTS integration tests, `npm run typecheck`, 125 web tests, both builds; the demo Gateway restarted on the new code and re-seeded
- [x] 05:50 Browser walk, live and in showcase: one sentence → the £14.20 ask with proof → Yes → claim filed → the live "waiting for the money" line → "paid you £14.20, 20 minutes of your time back"; Mission Control with the Rights Portfolio waiting on purpose, Proof Trace and the three jurors; Scam Shield speaks on the HMRC text; Memory, Profiles, Skills, Read It To Me, Am I Owed Anything?, Who's calling?, Privacy Proof, The story, Settings all render; screenshots in `docs/screens/`
- [x] 05:55 Committed as five logical commits (1ecb08b web foundation, cbd8278 the chat door and TTS, 09c9fff chat and Mission Control, a44c01c the nine pages, 010d33b docs, CI and ops) and pushed to GitHub and GitLab; a clean `git archive` export of HEAD builds, typechecks and passes the 125 web tests
- [x] 06:00 Found and fixed: the root `.gitignore` rule `memory/` (Mem0's local files) had silently ignored `apps/web/src/features/memory/`; anchored to `/memory/` and the Memory page committed (d2eddd8), pushed to both remotes

## 11. What the team does next

1. `make demo`, then walk §6's beats once before the judges; `make showcase` is the no-backend fallback.
2. Deploy the web app on Vercel (framework Vite, root `apps/web`, `VITE_TEMPO_SHOWCASE=1`); `docs/deploy.md` has the live-Gateway variant with `WEB_ORIGINS` and `ELEVENLABS_API_KEY`.
3. Set `ELEVENLABS_API_KEY` on the Gateway for the real voice; without it the browser's voice speaks and the face still moves.
4. Run the Playwright smoke suite once (`cd tests/e2e && npx playwright install chromium && npx playwright test`); it was written tonight but not run here.
5. Decide on Tempo Mesh in the new UI (pairing, passkeys, push): the Gateway routes and `src/lib/mesh.ts` are intact; the pages are the work.
6. Everything in §9 stays true until a person changes it.

---

## 12. Phase 2: excellent UI and UX, every feature fully working (started 05:10)

*Asked at 05:05: "make the UI and UX excellent and make all the features fully functioning, A–Z
ready". §1.9 is reopened: **Tempo Mesh comes into the new UI** (devices, Face ID approvals,
signing an Agent Passport mandate), because a feature that says "not in this UI" is not fully
working. Everything else in §1 stands.*

### 12.1 What the audit found (05:00–05:10, live Gateway, phone and desktop screenshots)

| # | Finding | Where | Fix (track) |
|---|---|---|---|
| 1 | **A profile is not enforced on the rail path.** Under "Read It To Me" (may: escalate only) the chat asked for consent and filed a £14.20 claim. Commuter would likewise run a broadband claim that needs `call`. | `/chat`, `/missions`, the claim tool | Refuse before asking, in plain words, when the profile's `may` lacks a skill's `needs`; `CapabilityGuard`/`BudgetGuard` on the claim tool too (P) |
| 2 | **The chat's "yes" bypasses passkeys.** `/approvals` refuses a bearer answer once the person has a passkey, but `/chat` "yes" calls `service.answer` directly. | `chat.py` | When the person has a passkey, reply "Confirm with Face ID" and return the ask unanswered (P) |
| 3 | A date with no recording leaks a Python tuple: "no recorded journey for ('OXF', 'PAD', datetime.date(2026, 10, 24), '0812')". The demo script tells presenters to type "yesterday" (24 Oct), which has no recording. | rail replay adapter, `scripts/demo.sh` | A plain sentence plus a suggestion chip with the recorded journey (P); the script's beat says "on 23 October" (lead) |
| 4 | Scam Shield's "no warning signs" line stays English when the person speaks Hindi. | `voice/warnings.yaml` | Add the missing lines in the six languages, `checked: false` (P) |
| 5 | On a phone the avatar panel takes half the screen before the conversation; sample chips are cut off mid-sentence. | chat | A compact avatar strip below `lg`; chips wrap (C2) |
| 6 | Mission Control shows "waiting on purpose" on a declined mission, and the raw tuple message. | mission list | Plan badges only while the mission is live; plain messages (C2) |
| 7 | The Agent Passport card says Mesh "is not in this UI"; no device pairing, no Face ID approvals. | missions, devices | Port the Mesh UI and Passport signing (M) |
| 8 | Read It To Me's camera only works with your own photo and a Gemini key; in replay there is nothing to photograph. | read, chat | Sample photos (the fixtures' PNGs) posted through the real vision path (D2) |
| 9 | The e2e smoke test looks for wording the chat no longer uses. | `tests/e2e/smoke.spec.ts` | Match "Claim filed / Waiting for the money / paid" (C2) |
| 10 | No toasts, no skeletons, no offline banner; errors appear in different places on each page. | everywhere | `toast`, `Skeleton`, `SkeletonCards` in `components/ui` (lead, done); every page uses them (C2, D2, M); offline banner (lead) |

### 12.2 Contracts added

- **`ChatReply.suggestions: list[str] | None`** (≤ 4, each ≤ 120 chars, Flesch ≥ 60): things the
  person could say next. The chat renders them as chips that send the text. The Gateway sets them
  after `help`, `smalltalk`, a fail-safe (e.g. the recorded journey "My 08:12 Oxford to Paddington
  was 38 minutes late on 23 October, ticket £28.40"), a profile refusal ("Show me my profiles"),
  and a finished claim ("How much have you got back for me?"). The showcase port mirrors it.
- **Profile refusal** (both `/missions` and `/chat`): if the turn's `profile_id` names a profile
  whose `may` lacks any capability in the skill's `needs`, nothing starts. `/missions` → **422**
  `{"detail": "<plain reason>"}`; `/chat` → 200 with `intent` as classified, `mission: null`, the
  plain reason as `reply` ("Your profile, Read It To Me, doesn't let me make claims, so I haven't
  started one. Choose another profile if you want me to claim."), an action to `#/profiles`.
  An amount above `limits.max_gbp_per_claim` still asks, and the ask says the profile's limit.
- **Passkey answers through the chat:** if `mesh.has_passkey(user_id)`, `approve` in `/chat`
  replies "Please confirm with Face ID or your fingerprint on this device." with the pending
  `ask` echoed and nothing answered. The web then signs with `useMesh().mesh.answer`. *(Since
  25 Oct 06:25 GMT, one rule for every door: a `decline` is answered, as STOP is; see §12.4.)*
- **`#/chat?say=<urlencoded text>`** sends that text once, as if typed, then clears the query.
  The story's "Try it" buttons, Profiles' "Try it with this profile" and the welcome card use it.
- **Mesh in the app** (`src/lib/mesh-context.tsx`): `<MeshProvider>` in App; `useMesh()` →
  `{mesh, devices, signs, canPasskey, showcase, refresh}`. **`answerAsk({gateway, mesh, signs},
  requestId, approved)`** (`src/lib/approve.ts`) is the only way the web answers an ask.
  `#/devices` is the Devices page; the QR link `<origin>/#pair=<id>.<secret>` routes to `/pair`
  with `params.link` = the full URL (the same page renders "Join"). `ConsentCard` takes
  `signed?: boolean` and says "You'll confirm with Face ID or your fingerprint" when true.
- **Toasts and skeletons:** `toast.success|error|info(text, action?)`, `<Skeleton>`,
  `<SkeletonCards count>` from `@/components/ui`. Every action that changes something confirms
  with a toast; every failure says what to do next in plain words.

### 12.3 Tracks (phase 2)

| Track | Owner | Files (only these) | Done when |
|---|---|---|---|
| **P. Backend correctness** | agent P | `apps/gateway/src/tempo_gateway/{chat.py,app.py,missions.py,main.py}`, `packages/tempo_core/src/tempo_core/{intent.py,profiles.py}` (helpers only), `packages/tempo_adapters/src/tempo_adapters/rail/replay.py` (message), `packages/tempo_harness/**` (guard wiring only), `voice/warnings.yaml`, `fixtures/chat/intents.json` (only if a vector changes), tests under `tests/{unit,policy,integration}/` for these, `docs/chat.md` | findings 1–4 fixed with tests; `make check`, `validate-skills`, all `tests/integration/test_gateway_*` green |
| **C2. Chat and Mission Control UX** | agent C2 | `src/features/chat/**`, `src/features/missions/**`, `src/components/mission/**` **except** `ConsentCard.tsx` and `PassportPanel.tsx`, `src/hooks/**`, `src/lib/showcase-chat.ts` (+ test), `tests/e2e/smoke.spec.ts` | findings 5, 6, 9; suggestions chips; `?say=`; answers through `answerAsk`; typing indicator; conversations survive a reload; toasts; phone and desktop screenshots clean; e2e smoke green |
| **M. Mesh and Agent Passport** | agent M | `src/features/devices/**`, `src/components/mission/{ConsentCard,PassportPanel}.tsx`, `src/lib/{mesh,passport,mesh-context,approve}.ts(x)`, `public/sw.js`, `apps/gateway/src/tempo_gateway/{mesh.py,mesh_routes.py}` (only if needed), `tests/e2e/mesh.spec.ts` | register this browser, add Face ID, pair a second device by QR with the 6-digit code, approve with Face ID (the ask disappears on the other screen), sign a mandate, let "the company" check it (allowed claim, refused out-of-scope action), revoke; e2e with a virtual authenticator green |
| **D2. Every other page** | agent D2 | `src/features/{memory,profiles,skills,shield,read,owed,callers,privacy,story,settings}/**`, `public/demo/*.png` | finding 8; toasts and skeletons on every page; the story becomes a guided demo with "Try it" buttons; Profiles shows and changes who Tempo works for, with "Try it with this profile"; phone and desktop screenshots clean; tests green |
| **S. Shell, integration, release** | lead | `src/App.tsx`, `src/router.ts`, `src/components/{layout,ui}/**`, `src/index.css`, `index.html`, `public/manifest.webmanifest`, `scripts/demo.sh`, docs, this file | compact header on phones, offline banner with "Use the showcase", 404 page, installable manifest; the full ten-beat rehearsal live and in showcase; e2e green; the showcase deployed to Vercel; committed and pushed |

### 12.4 Status log (phase 2)

- [x] 05:00 Audit: the chat door probed on twelve turns, the e2e suite run (11/12; the twelfth is stale wording), every page captured at 390×844
- [x] 05:10 Shared pieces landed for the tracks: `toast`, `Skeleton`, `SkeletonCards`, `<Toaster>` mounted, `MeshProvider`/`useMesh`, `answerAsk`, the `/devices` and `/pair` routes, `ChatReply.suggestions` in the TypeScript type
- [x] 05:20 Track S (lead): honesty badge compact on phones; a Gateway-offline banner with "Try again" and "Use the showcase"; the sidebar shows the profile's name (links to Profiles) and "Returned so far" from the Time Ledger, refreshed when money arrives; each page sets the tab title and takes focus on navigation; a real 404; an installable manifest with PNG icons; the demo script, `docs/demo.md` and the README say "on 23 October, ticket £28.40" instead of "yesterday"
- [x] 05:40 Track P done: profiles refused before anything starts (`/missions` 422, `/chat` plain reason + "Show me my profiles"), and every rail/Ofcom claim now runs `CapabilityGuard`/`BudgetGuard` (`tempo_harness/claims_guard.py`); a typed yes/no can't bypass a passkey; plain fail-safe with the recorded-journey chip; `suggestions`; the "no warning signs" line in six languages; 1,349 fast tests, 141 integration tests (41 skipped: no Postgres here), mypy clean. Demo Gateway restarted with it via `make demo-gateway` and verified live. Follow-ups sent back: declare `tempo-harness` in the Gateway's pyproject, persist mission profiles across a restart
- [x] 05:55 Track C2 done: phone layout with a 60px avatar strip, wrapping 44px chips, the welcome card grouped by beat, suggestion chips, `#/chat?say=`, every answer through `answerAsk` (Face ID when this device signs), typing dots, toasts, plain errors, STOP as a labelled button, conversations kept across a reload (`tempo.chat.v1`), Mission Control filters (Margaret/Everyone, Live/Finished/All), live-only plan badges, plain messages; 196 web tests, e2e smoke 12/12. Lead's calls on its four questions: "Check the payment now" shows whenever a mission waits (it only fires due checks); the showcase's fail-safe says "This showcase only has the 08:12 from 23 October." (only that day is recorded); one storage key for both modes (switching modes resets the chat); the welcome chip keeps its own wording
- [x] 06:05 Track P follow-ups: `tempo-harness` declared in `apps/gateway/pyproject.toml` (`uv lock --check` clean); the mission → profile map persists in `profiles.json` beside the checkpoints, so a restarted mission is still guarded (and an unreadable file refuses the claim rather than running it unguarded); 145 integration tests pass
- [x] 06:15 Track D2 done: Read It To Me reads the two sample photos through the Gateway's real vision path (and in the showcase by the same fingerprints); the story is a guided demo with "Try it" on every beat; Profiles shows who Tempo works for and "Try it with this profile"; skeletons, toasts and plain errors on every page; 198 web tests
- [x] 06:20 Track M done: the Devices page (this browser for approvals, Face ID, pair by QR with the 6-digit code, Join at `#/pair`), Face ID answers, the Agent Passport signed with Face ID and checked by "the company" (claim allowed, out-of-scope refused) and in the browser; Gateway fixes: passkeys now ES256 only (EdDSA keys made every mandate fail verification), `GET /mesh/mandates/{id}` for paired devices; e2e Mesh spec (two browsers, virtual authenticator) green
- [x] 06:30 Integrated: phone toasts moved under the header and capped; the welcome card picks one or two columns from its own width; docs no longer say Mesh is missing; `docs/web.md` documents the phase-2 behaviours; `uv sync` for the new dependency; demo Gateway restarted with clean devices and re-seeded. All green: ruff, format, mypy, fast and integration suites, skills, `uv lock --check`, 198 web tests, both builds, e2e 14/14 (smoke + Mesh)
- [x] 06:40 Live rehearsal of the beats: late train → ask with Proof Trace and three jurors → Yes → paid by the scheduler (ledger £28.40 → £42.60); broadband → waiting on purpose → +31 days → acting → paid (£74.91, 1.1 h); memory recall; HMRC verdict in the chat; a sample letter read through vision. Found and sent back: a second claim for the same journey (P), the floating stream badge covering buttons, a "Claim filed" toast on a wait-on-purpose case, "Acting now" after payment, no amount on a waiting card (C2)
- [x] 06:55 Fix round 2: one claim per journey (`/chat`, `POST /missions`, `/missions/ofcom` and the voice tool return the existing live or paid mission; "I'm already on this one."; persisted in `missions.json`), `scripts/seed.py` safe to run twice, `MissionView.amount_gbp` so a waiting claim keeps its amount; the stream badge in its own row, truthful toasts ("Saved. Tempo will wait on purpose until 19 November."), a settled Rights Portfolio after payment. Final: 1,354 fast and 152 integration tests, 203 web tests, both builds, e2e 14/14; re-walked live; `docs/screens/` refreshed with the current UI
- [x] 07:20 Committed and pushed (65e751e..9e40087 on both remotes): the guardrail and chat fixes, the Mesh fixes, the shell, Mesh and Passport in the web app, chat and Mission Control UX, every other page, docs and fresh screenshots, a flaky Devices test made deterministic (three cold clean-export runs: 203/203 each), the showcase's own one-claim rule, and a catalog script that no longer dirties the tree
- [x] 07:30 **Deployed: https://tempo-showcase.vercel.app** (Vercel project `tempo-showcase`, root `apps/web`, `VITE_TEMPO_SHOWCASE=1` for Production and Preview; `.vercelignore` keeps the CLI's token file out of uploads). Checked in a browser: HTTP 200, CSP and frame headers, manifest and sample photos served; the chip → £14.20 ask → Yes → Mission Control walk works with no backend, and a repeat of the journey says "I'm already on this one."
- [x] 25 Oct 06:25 GMT **The two guardrail gaps of §12.5 closed.** *One rule for yes on every door:* once a person has a passkey, only the passkey says yes. SMS `YES` and the voice tool `record_consent` now answer nothing, say so in plain words (Flesch 93–98: "Tempo: You set up Face ID, so I can't take a yes by text. Open Tempo on your device and say yes with Face ID or your fingerprint. …") and wake the device that can sign; a no and STOP are taken on every door, chat and bearer `/approvals` included, because ending a claim binds nobody (STOP already declined on every door). The web's 403 line now says "only takes a yes signed". *No double claim at the same instant:* `MissionService.start_once` holds a lock per (person, `mission_key`) around the duplicate check and the start, on `/chat`, `POST /missions`, `/missions/ofcom`, `/missions/ofcom/read` (it had no duplicate check at all) and the voice `create_mission`; two identical turns fired together make one mission, and a control test shows the old check-then-start claims twice under a store that yields like Postgres. Tests: `tests/integration/test_passkey_parity.py` (8), `tests/integration/test_one_claim_at_once.py` (7), the chat's passkey test split into yes and no, the Flesch eval +4. Rule written into `docs/security.md` (threats 18 and 19, "One rule for yes") and `docs/chat.md`

### 12.5 What the team does next (replaces §11)

1. **Demo:** `make demo`, open http://localhost:3000 (not 127.0.0.1: Face ID needs `localhost`), and follow the story page's "Start the demo", or `docs/demo.md`. The public fallback is https://tempo-showcase.vercel.app.
2. **Real voice:** set `ELEVENLABS_API_KEY` on the Gateway; until then the browser's voice speaks and the face still moves.
3. **Live Gateway for the public site:** deploy the Gateway (`deploy/render.yaml` or `deploy/fly.toml`), set `WEB_ORIGINS` and `MESH_RP_ID` to the Vercel host, then set `VITE_GATEWAY_URL` and `VITE_TEMPO_TOKEN` on the Vercel project, remove `VITE_TEMPO_SHOWCASE`, and redeploy.
4. **Push notifications:** generate VAPID keys (`scripts/gen_vapid.py`) and set them on the Gateway.
5. **Known limits, stated:** ~~SMS `YES` and the voice `record_consent` tool still answer without a passkey (separate channels); two chat turns sent at the same instant could both start a claim (no lock between the check and the start)~~ (both closed 25 Oct 06:25 GMT, §12.4); the one-claim lock holds within one Gateway process (several processes would need a unique index on the live claim in the database); Face ID was tested with Chrome's virtual authenticator, not a real iPhone; Tauri is not built here; the rule packs are demo values until a person checks each source.

---

## 13. A real GPU behind the live demo (started 07:45)

*Asked at 07:40, with a screenshot of RunPod Serverless: "for this demo let's run a real one, no
mock: run the GPU on RunPod and route that to Vercel, serverless pod."*

### 13.1 What becomes real, and what cannot

| Part | Before | Now | Why |
|---|---|---|---|
| Consensus Court (three jurors) | recorded verdicts | **three votes from our own model on a RunPod GPU** | the model reads the rule and the facts; it still never sets an amount |
| Chat small talk | canned line | **one sentence from the same model**, under the existing word rules | |
| Reading photos (letters, the missed-visit card) | recorded readings for two sample photos | **the same model reads any photo** (a vision-language model) | |
| Voice | ElevenLabs (real since 07:25) | unchanged | |
| Scam Shield's text model | already real (runs on the Gateway) | unchanged | |
| Rail data, the company, registers, link sandbox | recorded | **still recorded, and the badge says so** | a GPU can't stand in for National Rail, GWR, Companies House or the FCA; those need their own keys (`make doctor`) |

### 13.2 Architecture

```
Vercel (tempo live site) ──https──▶ Cloudflare quick tunnel ──▶ Gateway on this Mac (port 8100)
                                                                   │  bearer token (fresh, per run)
                                                                   ├──▶ ElevenLabs (voice)
                                                                   └──▶ RunPod Serverless vLLM (GPU)
                                                                          Qwen2.5-VL-7B-Instruct,
                                                                          served as "tempo-private"
```

- **The GPU is a RunPod Serverless queue endpoint** running the official vLLM worker
  (`runpod/worker-v1-vllm:v2.30.1`), OpenAI-compatible at
  `https://api.runpod.ai/v2/<endpoint>/openai/v1`. Its key stays on the Gateway; no browser or
  Vercel build ever sees it.
- **The Gateway is not on RunPod or Vercel**: it holds a WebSocket, a scheduler and the missions in
  memory, which serverless workers would lose between requests. It runs here, from a scratch folder
  (`../.tempo-live`), and a Cloudflare quick tunnel gives it a public https address with WebSockets.
- **A new deployment mode, `cloud-gpu`**: the model and vision are our own vLLM on RunPod, the
  voice is ElevenLabs. It is not `cloud-private` (that mode promises no outside AI company, and
  ElevenLabs is one).
- **`TEMPO_MODELS=live`** makes the model-backed parts real while `TEMPO_MODE=replay` keeps the
  data recorded. `/health` drops "jurors" and "vision" from `simulated` only when they really ran
  on the model, and names the model.
- **A second Vercel project, `tempo-live`**, built with the tunnel's address; the showcase
  (`tempo-showcase`) stays as the no-backend fallback.

### 13.3 Work

| # | Piece | Files |
|---|---|---|
| 1 | `cloud-gpu` profile; `TEMPO_MODELS`; jurors, small talk and vision on the model when live; `/health` honesty | `tempo_core/config.py`, `tempo_adapters/settings.py`, `tempo_adapters/vision.py` (an OpenAI-compatible vision reader), `tempo_gateway/main.py`, `chat.py` (`simulated_in`), tests |
| 2 | The worker settings and a Dockerfile for RunPod's GitHub flow | `deploy/runpod/worker.gpu-demo.env`, `deploy/runpod/Dockerfile` |
| 3 | `make live-demo`: Gateway on 8100 with the scheduler, a warm-up call, the tunnel, the Vercel deploy, one printed URL; `--stop` | `scripts/live_demo.sh`, `Makefile`, `tempo_gateway/main.py` (`TEMPO_PORT`) |
| 4 | The badge says "AI: our GPU" when the model is real | `apps/web/src/components/ui/HonestyBadge.tsx`, `lib/api.ts` |
| 5 | Docs: the RunPod form, costs, the run, honesty | `docs/gpu-demo.md`, `deploy/runpod/README.md`, README |

### 13.4 Status log

- [x] 07:45 Surveyed: Private mode already talks to RunPod vLLM (`tempo_adapters/runpod_llm.py`, `deploy/runpod/`); jurors already ask for JSON by schema (vLLM enforces it); live mode would also switch rail, registers and the sandbox to services with no keys here, hence `TEMPO_MODELS`
- [x] 08:20 Built: the `cloud-gpu` profile and `TEMPO_MODELS` (jurors, small talk and photo reading on the model while the data stays recorded); `OpenAIVision` for our own vision-language model; `/health` names the model and drops "jurors"/"vision" only when they really run on it; the RunPod client always goes through our own httpx client (its timeout, and testable); the badge says "AI: our own model on a RunPod GPU"; `deploy/runpod/{worker.gpu-demo.env,Dockerfile}` (Qwen2.5-VL-7B-Instruct as `tempo-private`, `runpod/worker-v1-vllm:v2.30.1`); `scripts/live_demo.sh` (`make live-demo`, `live-demo-stop`); `docs/gpu-demo.md`. Tests: 1,365 fast, 173 integration (4 new against a stand-in RunPod route), 205 web. Checked by hand: a quick tunnel carries `/health` and the event WebSocket
- [ ] Waiting on the team: the RunPod endpoint (the console form, `docs/gpu-demo.md` §1) and its endpoint id and API key in `../.tempo-live/.env`; then `make live-demo` and a walk of the beats on the live site
- [x] 09:00 RunPod endpoint `awx2uv9y1h6qvi` created by the team; its key and id are in `../.tempo-live/.env` (mode 600). First jobs failed: "ran out of disk during startup" (the container disk is smaller than the worker image plus the ~17 GB model); the restricted key can't change endpoint settings, so the team is raising the container disk to 50 GB in the console
- [x] 09:05 The live acceptance suites, ready for the GPU: `tests/live/test_live_demo.py` (26 checks through the public tunnel) and `tests/e2e/live.spec.ts` (18 on the live Vercel site, own config); `make live-test` runs both and then `scripts/live_demo.sh --restart-gateway` (new: a clean, seeded Gateway on the same tunnel, site and token); the script now records each run in `../.tempo-live/live.json`

### 13.5 The fallback: hosted models (added 09:30)

The RunPod workers kept failing with "ran out of disk during startup", so the live demo gained a
second mode that needs no GPU. `cloud-apis`:
- **Jurors** (as of 12:05): by default Gemini 3.5 Flash-Lite, NVIDIA's Nemotron 3.5 Bolt (with `NVIDIA_API_KEY`) and Gemini 3.1 Flash-Lite preview; without NVIDIA's key, three Gemini checkpoints; OpenRouter's Dots 3 is an opt-in seat. The live demo seats Gemini 3.5 Flash-Lite, Nemotron 3.5 Bolt and MiniMax M3.1 Flash (`GEMINI_JUROR_MODELS`, `NVIDIA_MODELS` in `../.tempo-live/.env`), so Gemini 3.1 Flash-Lite is left to photos. The Court still needs two to agree.
- **Small talk:** the first Gemini model.
- **Photos:** Gemini (`GEMINI_MODEL`).
- **Outside AI companies:** Gemini, ElevenLabs and whichever of NVIDIA or OpenRouter really sits on the Court; the Privacy Proof names exactly those.

`make live-switch MODE=apis|gpu` swaps the running Gateway's AI without touching the tunnel or the
site. `/health` now reports whether the model **answers** (`answering`, `answers`, `failures`), not
only whether it is configured, and the badge says "(not answering yet)" when the last call failed.

- [x] 09:20 Probed: the OpenRouter key is on the free tier. NVIDIA's free Nemotron models are blocked by the account's privacy setting (free endpoints that may train on inputs). Xing is rate-limited upstream. Most other popular `:free` slugs are now paid only. Dots 3 answered in 5 s with valid JSON. The Gemini key works; `gemini-2.5-flash` is closed to new users, `gemini-3.1-flash-lite` answered in 4 s with valid JSON, and `gemini-3.5-flash` worked but returned 503 once
- [x] 09:40 Built `cloud-apis`, `juror_clients`, `openai_compat_client`, `ModelStatus`/`RecordingClient`, the badge's "not answering yet", the live script's modes and `make live-switch`; live suites aware of both modes; tests 1,365 fast, 177 integration, 207 web
- [x] 09:55 **Found by the real models: the jurors were asked with no facts.** Both missions built the Court's question with `facts=()` and Tempo's own result line ("38 min late → 50% of £28.40 …") as the rule; three real models rightly ruled Amir's and Margaret's claims "not covered (3/3)". The recorded jurors had hidden it. Now the jurors read the operator's rule in plain words (`tempo_core/rules/words.py`, from the pack) and sourced facts (the delay from the rail records, the journey, the fare; for Ofcom the provider, the date and what happened). Live: 3/3 eligible on all three seeded claims
- [x] 10:05 Juror roster from measurements on the real question: Gemini 3.1 Flash-Lite 1.5 s, 3.5 Flash-Lite 1.0 s, 3 Flash Preview 5.2 s, all correct, so these three are the default; OpenRouter's free Dots 3 is correct but 17.7 s (beyond the 20 s juror limit under load) and its free tier allows about 50 requests a day, so it is an opt-in seat (`OPENROUTER_MODELS`, with `JUROR_TIMEOUT_S`). The Privacy Proof names OpenRouter only when it sits on the Court (`Profile.extra_ai`)
- [x] 10:10 **The GPU answered**: after the team raised the container disk, a job completed on `tempo-private` (vLLM 0.32.0) in 0.6 s, after a 5 min 47 s cold start
- [x] 10:55 **Live, the engineer's card was read as 2020-10-19.** It says "Mon 19 Oct", no year, and 19 Oct was a Monday in 2020 too. A live reading now gets today's date in the prompt, and a date implausible for its kind (an event in the future or over a year back; a deadline over three years out) is capped at 0.5 confidence, so Tempo reads it back and starts nothing (`vision.plausible`; recordings are not checked, so tests can't age). Gemini 3.1 Flash-Lite then read 18/18 facts right
- [x] 10:55 `scripts/live_demo.sh --restart-gateway` made robust: the old Gateway is stopped with a 10 s wait and then killed (a live site's WebSocket held it in shutdown), a stray listener on the port is cleared, and the new one starts in its own session
- [x] 11:10 **cloud-apis: the full live suite passed** (23 Gateway checks, 18 on the site) after replacing `gemini-3-flash-preview`, which hit 429 under load. Measured on the free tier, six Court questions at once: 3.5 Flash-Lite 1.3 s, 3.1 Flash-Lite up to 17 s and 36 s on a short question, 3 Flash Preview and 3.5/3.6 Flash 429 or 10 to 25 s, 3.7/3.8 Flash 45 to 60 s, Gemma 4 over 60 s on the real question. Found: `gemini-3.1-flash-lite-preview` and `gemini-flash-lite-latest` share the 15-a-minute buckets of 3.1 and 3.5 Flash-Lite (the 429 names them), so this key has only two fast buckets. The Court now logs why a juror was absent (timeout, 429, bad JSON); `make live-test` on cloud-apis waits out the minute before reseeding
- [x] 11:25 **The GPU's three failures were RunPod's scaling, not the model:** a job ran in 1.4 s but queued 107 s, because the endpoint kept 0 active workers with a ~5 s idle timeout (the restricted key can't read or change it: 401). The live script woke the GPU after seeding and only through a 20 s chat, so every seeded court had three absent jurors. Now it waits (up to 15 minutes) for the GPU's own answer just before seeding, on every start and restart. The team set 1 active worker: jobs queue 1.0 s and run in 0.5 s
- [x] 11:25 Found by Qwen2.5-VL on the card: a notice period of "4:00" made `/missions/ofcom/read` a 500 (`Decimal()` on text). A notice the model gives in words now stays unsure and is read back. The GPU schema check now states the rule plainly, as the jurors get it (to "the rule pays from 15 minutes", Qwen said not eligible every time). The site's chat check no longer races the automatic payment check, and it requires "has paid you £14.20"
- [x] 11:45 **NVIDIA's API takes the second cloud-apis seat** (`NVIDIA_API_KEY`, `NVIDIA_MODELS`, default `nvidia/nemotron-3.5-bolt-e4b`): on the real question, six at once, all right in 2.9 to 6.3 s, and it rejected a 10-minute delay 3/3. MiniMax M3.1 Flash was right but spiked to 11 s and hit a 429; gpt-oss-20b 9 to 12 s; Nemotron Lightning 24 s; GLM 5.3 Flash timed out; most other catalogue models 404 for this key. `court_seats` and `court_providers` seat NVIDIA first, then OpenRouter, and the Privacy Proof, `/health` and the badge name only providers really seated
- [x] 11:45 Handed over from §14: the site alias is now the first `WEB_ORIGINS` entry (the pairing QR and Face ID use it), and the live script makes a VAPID key pair once in `../.tempo-live/.env`, so Web Push works on the live site
- [x] 11:50 After the app ended the session's processes (the tunnel and Gateway went with it), `make live-demo` ran again from a Terminal tab: new tunnel, the site redeployed. **The GPU passed the full live suite: 23 of 23 through the tunnel (both GPU-only checks included) and 18 of 18 on tempo-live-ten.vercel.app**, no juror absent. The demo stays on the GPU
- [x] 12:00 Live on cloud-apis, §14's 2 s grace (the third juror's time once two agree) cut NVIDIA's correct juror off most times (Gemini agreed in 1 to 3 s, NVIDIA in 3 to 6 s), and the three-juror checks failed. `JUROR_GRACE_S` (default 5 s) now sets it; a claim still waits far less than the old 20 s, and the GPU's jurors answer together. Then the 3.1 Flash-Lite preview seat missed it under test load: it shares Gemini's 15-a-minute bucket with every photo read, and the SDK retries its 429s quietly
- [x] 12:05 **cloud-apis passed the full live suite with NVIDIA on the Court: 21 of 21 through the tunnel (the two GPU-only checks skip) and 18 of 18 on the site**, seated Gemini 3.5 Flash-Lite, Nemotron 3.5 Bolt and MiniMax M3.1 Flash, no juror absent. Both modes now pass; the demo is left on the GPU (one active RunPod worker: set it back to 0 after the demo)

---

## 14. Connectors and MCP (started 10:30)

*Asked at 10:25: "add more features like connectors, MCP etc to make the demo better".*

### 14.1 The idea, in two directions

1. **Tempo as an MCP server: "your AI can ask Tempo, never act for you".** Any MCP client (Claude
   Code, Claude Desktop, Zed, Cursor) connects to the Gateway's `/mcp`. It can check a suspicious
   text, read a letter, start a claim, see its status, screen entitlements and verify an Agent
   Passport mandate. **No tool approves anything**: a started claim waits for the person's own yes
   (Face ID, SMS YES, or the web), so an agent that asks Tempo can never spend her consent. The rule
   packs and profiles are MCP resources; two MCP prompts start the common jobs.
2. **Tempo as an MCP client: connectors that find money you're owed.** The person connects the
   places her life already is: her mailbox, her calendar, her bank statement (plus Tempo's own rail
   lookup). Each is a small, read-only MCP server Tempo talks to over stdio. Then **"Sweep my
   inbox"** finds things worth a look, with what Tempo read listed and never kept:
   - the 08:12 e-ticket from Trainline, then the rail records saying 38 minutes late, so a claim of £14.20 is waiting;
   - the Broadbandly engineer booking in her calendar on 19 October, with the question "Did they come?";
   - a "HMRC tax refund" email that Scam Shield calls a trick;
   - a Thames Water refund that already reached her bank, so nothing needs doing.

   Connector output is **evidence, never instructions**. It is parsed by code. It never goes to
   memory except as evidence. The only tools used are read-only ones on an allowlist.

### 14.2 Contracts

**MCP server** (`tempo_gateway/mcp_server.py`, mounted at `/mcp`, Streamable HTTP, the same bearer
as the web; `GET /mcp/info` (bearer) returns `{url, transport: "streamable-http", tools: [{name,
description, read_only}], resources: [...], prompts: [...]}` for the web page):

| Tool | Input | Output | Annotations |
|---|---|---|---|
| `check_message` | `text`, `language?` | Scam Shield's verdict: `level`, `zone`, `say`, `reasons` | read-only |
| `read_letter` | `image_base64`, `filename?`, `mime_type?` | the letter reading (`kind`, `sender`, `money`, `must_do`, `by`, `unsure`, `reading_text`) | read-only |
| `start_rail_claim` | `user_id`, `display_name`, `origin_crs`, `destination_crs`, `travel_date`, `departure`, `fare_gbp`, `profile_id?` | `{mission_id, state, amount_gbp, proof, court, needs_consent_from: "the person, on their own device", how_to_approve}` | not read-only, not destructive |
| `start_missed_visit_claim` | `user_id`, `display_name`, `provider`, `visit_date`, `notice_hours?` | the same shape | not read-only, not destructive |
| `claim_status` | `mission_id` | `{state, message, amount_gbp, timeline}` | read-only |
| `money_returned` | none | the Time Ledger | read-only |
| `screen_entitlements` | the ten answers | the flags and the disclaimer | read-only |
| `verify_mandate` | `envelope`, `counterparty`, `action`, `amount_gbp?` | Agent Passport's verdict (for a company's agent) | read-only |

Resources: `tempo://rules/{rule_id}` (the rule in words plus its YAML), `tempo://profiles/{id}`.
Prompts: `claim-a-late-train`, `is-this-a-scam`. Profiles still bind: a profile that may not claim
refuses through MCP too. Every call publishes `{"type": "mcp_call", "tool": ..., "ok": ...}` on the
bus (never the arguments).

**Connector servers** (`mcp-servers/{mail,calendar,bank}`, workspace packages like `rail`, stdio,
read-only, data folder from `TEMPO_CONNECTOR_DATA`, default `fixtures/connectors/<kind>/`):
- mail: `search_messages(query="", since=None, limit=20) -> [{id, from, subject, date, snippet}]`,
  `get_message(id) -> {id, from, to, subject, date, text, attachments: [{filename, mime_type}]}`
  over a folder of `.eml` files
- calendar: `list_events(start, end) -> [{uid, title, start, end, location, description}]` over `.ics`
- bank: `list_transactions(since=None, limit=50) -> [{id, date, description, amount_gbp}]` over a
  CSV statement (`amount_gbp` signed, as a string)

**Gateway connectors** (`tempo_gateway/connectors.py`, `tempo_core/findings.py`, config
`connectors/connectors.yaml`):
- `GET /connectors?user_id=` returns `{connectors: [{id, name, kind, connected, scopes: [plain words], tools: [read-only tool names], last_read_at, items_read}], simulated: bool}`.
- `POST /connectors/{id}/connect` and `/disconnect` (`{user_id}`) return the connector.
- `POST /connectors/sweep` (`{user_id}`) returns `{findings: [{id, kind: "late_train" | "engineer_visit" | "scam" | "money_arrived" | "letter", title, why, amount_gbp?, source: {connector, item}, say, action: {label, href}}], read: {connector: count}, took_ms}`.
- Events: `connector_read {connector, items}` and `sweep_done {findings}`, never contents.
- Findings are found by code (`tempo_core.findings`). A late train is checked against the rail records the way a claim is. A suspicious email goes to `ShieldService.check`. Nothing is started automatically.

**Chat door**: a new intent, `sweep`, triggered by "check my email", "find what I'm owed" or
"sweep". The reply carries `findings` (a new `ChatReply.findings`) and a suggestion chip per finding.

### 14.3 Tracks

| Track | Files (only these) | Done when |
|---|---|---|
| **MCP. Tempo as an MCP server** | `apps/gateway/src/tempo_gateway/mcp_server.py`, `scripts/mcp_demo_client.py`, `docs/mcp.md`, `tests/integration/test_mcp_server.py` | the integration test drives `/mcp` with the SDK's own client: list tools, check the HMRC text (warn), start Margaret's claim, see no tool can approve, verify a mandate; `mcp_demo_client.py` runs the same against a live Gateway; docs give working configs for Claude Code, Zed, Cursor and Claude Desktop |
| **SRV. Connector MCP servers and data** | `mcp-servers/{mail,calendar,bank}/**`, `fixtures/connectors/**`, root `pyproject.toml` (workspace member lines only) and `uv.lock`, `tests/contract/test_connector_servers.py` | each server lists and serves its tools over stdio against its fixtures; contract tests through the SDK's stdio client |
| **CON. Gateway connectors, the sweep, the chat intent** | `apps/gateway/src/tempo_gateway/connectors.py`, `packages/tempo_core/src/tempo_core/findings.py`, `connectors/connectors.yaml`, `tempo_core/intent.py` and `tempo_gateway/chat.py` (the `sweep` intent only; check `git status` first, another session may be fixing chat.py), `fixtures/chat/intents.json` (new vectors only), tests | `make check` green; an integration test sweeps the fixtures and gets the four findings above, in order, with exact amounts |
| **WEB. Connectors page, MCP section, findings in the chat** | `apps/web/src/features/connectors/**`, `src/lib/connectors.ts`, `src/showcase/connectors*.json` + `mcp-info.json`, additive edits to `src/lib/api.ts` and `src/lib/showcase.ts`, the chat's findings rendering (`features/chat/TaskMessages.tsx`, `WelcomeCard.tsx` chip, `lib/showcase-chat.ts` sweep intent) | `#/connectors` works live and in showcase, axe-clean; "Sweep my inbox" shows the four findings with one-tap actions; the MCP section shows the URL, the tools and copyable configs; tests green |
| **Lead** | `app.py`/`main.py` wiring, `router.ts`, `App.tsx`, `Sidebar.tsx`, README, `docs/demo.md`, this file | everything wired, `make check` and the web check green, a browser walk, committed and pushed |

### 14.4 Status log

- [x] 10:30 Surveyed: MCP SDK 2.3 (`MCPServer`, `streamable_http_app`, `stdio_client`, `streamable_http_client`); `mcp-servers/rail` exists and is unused by the Gateway; this plan written
- [x] 10:40 Four tracks launched in parallel (MCP, SRV, CON, WEB); the lead wires routes and the page
- [x] 10:55 SRV done: `mcp-servers/{mail,calendar,bank}` (stdio, read-only, an output schema on every tool), Margaret's invented mail, calendar and statement under `fixtures/connectors/`; 43 tests
- [x] 11:00 MCP done: `/mcp` (Streamable HTTP, stateless, JSON replies, the web bearer, the SDK's host check), eight tools, two resources, two prompts, `GET /mcp/info`; no approve tool; `scripts/mcp_demo_client.py`, `docs/mcp.md` (Claude Code, Zed, Cursor, Claude Desktop via `mcp-remote@0.14.3`)
- [x] 11:05 WEB done: `#/connectors` (cards, switches, Sweep my inbox, findings, "Use Tempo from your AI" with copyable configs), finding cards in the chat, the welcome chip, the `sweep` intent in the showcase chat; 245 web tests
- [x] 11:10 CON done: `ConnectorHub` and the sweep (the four findings in order on the fixtures: £14.20 priced by the rule pack through the Gateway's own rail port, the visit, the scam via Scam Shield, the £23.40 refund matched to its email), `connectors/connectors.yaml`, the chat's `sweep` intent and 11 new shared vectors
- [x] 11:15 Lead wiring: `/mcp` and the connectors router mounted, `#/connectors` in the router, the app and the sidebar; the Gateway package now declares `mcp` and the three servers, and the image copies `connectors/` and `fixtures/connectors/` (it would have failed to start without `mcp`)
- [x] 11:15 A full walk of the live site (tempo-live-ten.vercel.app, cloud-apis, Gemini live) found and fixed: every claim waited 20 s for a slow third juror (the Court now rules once two agree, with a 2 s grace); the region named OpenRouter when it wasn't used; Privacy Proof said the jurors and vision answered from recordings when they were live; the chat's model picker said "Local model (Ollama)" while Gemini answered (it now shows the Gateway's real model); "Yes, claim £32.31" on a plan to wait (now "Yes, handle it for me"); the profile banner showed an id; seven identical "Use this profile" buttons; raw "Failed to fetch" on five pages; the Gateway banner overflowing at phone width and telling visitors to run `make demo`; "three providers" when all three jurors are Gemini. Passed as expected: both claims end to end, the Proof Trace and Court, STOP, Scam Shield (English and Hindi, feedback, voice), letters read by Gemini (1.6 s), the reply drafter, the screener's ten questions and GOV.UK links, Who's calling (three callers), memory correct and forget, profile refusal and import, Devices, a photo through the chat, text size and plain mode
- [x] Handed to the live-demo session: the pairing QR points at the SSO-protected deployment URL (put the site alias first in `WEB_ORIGINS`), and the live Gateway has no VAPID key. Done (§13.5, 11:45)

---

## 15. The website, made exceptional (started 12:15)

*Asked: "make the website UI and UX much more better and excellent to make it insane".*

The app works page by page but reads as a generic dark dashboard: a saturated navy sidebar
against a near-black canvas, the system font with no hierarchy, flat grey cards, dense rows of
text, a stick-figure avatar, almost no motion and no identity. Every page heading goes through
`PageTitle`, and the pages are built from `Card` (78 uses), `Button` (111), `Badge` (76) and
`SectionTitle` (95). So a real design system at the token and primitive level reaches every page
at once, and the signature pages get bespoke work on top.

### 15.1 Direction: "golden hour"

Tempo gives people their time back. The look is the hour before dusk:
- **Ink canvas** (#07070B) with two slow aurora glows (violet top left, amber bottom right) and a
  fine grain.
- **Glass surfaces** with hairline borders, so depth comes from light rather than from greys.
- **Violet** for the agent and its actions.
- **Gold** for what was returned (money, hours).
- **Emerald** for done, **rose** for danger, **amber** for waiting.
- **Signature motif: the time ring.** It is used in the logo, the ledger, the chat's orb, the loaders
  and the empty states.
- **Type:** Inter Variable for the interface, Instrument Serif for display lines ("Your time,
  *returned*."). Both are self-hosted (@fontsource), so the Tauri app and offline use keep them.
- **Motion:** short and purposeful. Pages fade up, lists stagger, numbers count up and the orb
  breathes. All of it is off under reduced motion (the system setting or Settings).
- **Accessibility does not regress:**
  - WCAG AA contrast.
  - Visible focus rings.
  - 44 px targets in plain mode.
  - Every heading and label the tests and screen readers rely on stays word for word.

### 15.2 Work

| # | Piece | Files |
|---|---|---|
| F1 | Tokens: fonts, palette (`ink`, `glass`, `brand`, `gold`), shadows, radii, keyframes; global CSS (aurora, grain, scrollbars, selection, focus, `.glass`, `.hairline`, `.text-gold`, tabular numbers) | `tailwind.config.ts`, `index.css`, `main.tsx` |
| F2 | Primitives: `Button` (gradient primary with glow, glass quiet, press scale), `Card` (glass, `interactive`, tones), `Badge` (dot), `PageTitle` (eyebrow, display title, icon tile, lede), `SectionTitle`, `EmptyState` (time ring), `Skeleton` (shimmer), `Spinner` (ring), `Switch`, `Toast`; new `Stat` (count-up), `Segmented`, `Kbd`, `TempoMark` (logo) | `components/ui/*` |
| S1 | Shell: glass sidebar with the mark, a gradient active rail, a gold ledger with a ring, the profile chip; a header with the page's name, a ⌘K button and the honesty badge; a phone tab bar; a page transition | `components/layout/*` |
| S2 | ⌘K command palette: every page, the demo's actions, settings toggles, keyboard first, with screen-reader announcements | `components/layout/CommandPalette.tsx`, `App.tsx` |
| P1 | Chat: a display greeting by time of day, a bento of suggestion cards, a breathing orb in place of the stick figure (speaking, listening, thinking), a glass input with a glow | `features/chat/*` |
| P2 | Mission Control and the mission page: hero stats in gold, a segmented filter, cards with a status rail and the amount, the timeline and the Court restyled | `features/missions/*`, `components/mission/*` |
| P3 | The story, Scam Shield, Read It To Me, Am I owed: the guided beats, the verdict cards, the reading | `features/{story,shield,read,owed}/*` |
| P4 | Trust pages: Profiles, Skills, Who's calling, Devices, Privacy Proof, Connectors, Memory, Settings | `features/*` |
| V | A browser walk of every page at desktop and phone widths; web tests, typecheck, build, the e2e smoke run; the showcase and the live site redeployed | `tests/e2e`, Vercel |

### 15.3 Status log

- [x] 12:15 Plan written; the foundation (F1, F2) and the shell (S1, S2) first, then the pages
- [x] 12:35 F1 and F2 landed:
  - Inter Variable and Instrument Serif, self-hosted.
  - The ink, violet and gold tokens, and the aurora and grain canvas.
  - `.surface`, `.glass`, `.text-gold` and `.num`.
  - Restyled `Button`, `Card`, `Badge`, `PageTitle` (the page's icon tile and a display title), `EmptyState`, `Skeleton`, `Spinner`, `Switch` and toasts.
  - New `Stat` (count-up), `Segmented`, `Kbd` and `TempoMark`.
  - `docs/design-system.md` is the reference. The 245 web tests pass unchanged.
- [x] 12:45 S1 and S2 landed:
  - The glass sidebar with the mark, a glowing active rail and the gold ledger.
  - A header with the page's place, a ⌘K button and the honesty badge, plus a phone tab bar (Chat, Missions, Shield, Read, More).
  - The ⌘K palette: pages, "Ask Tempo" with every welcome sample, the guided demo and the comfort toggles. It follows the ARIA combobox and listbox pattern.
  - The new favicon and PWA icons.
- [x] 12:55 P1, the chat:
  - A display greeting by the time of day.
  - A bento of suggestion tiles, with the train featured.
  - **The breathing orb** in place of the stick figure: it turns, swells with the voice's level and ripples while speaking, its bars follow the lip-sync shapes, and each voice has its own colours. The old glow never received the level, so it never pulsed; the orb now reacts.
  - A glass input with a violet focus glow, gradient send and mic buttons, and violet bubbles.
  - The palette's "Ask Tempo" opens the chat and sends: checked in a browser, the train sentence gets the £14.20 ask.
- [x] 13:30 P2 to P4, in three parallel tracks:
  - **Mission Control:** a gold ledger hero; mission cards with glowing status rails, skill tiles and the amount with its word ("to claim", "paid"); the mission page's sticky glass bar, a stepper timeline, three juror tiles with an agreement meter, a numbered Proof Trace with a gold total, and the consent card's amount large in gold with a gold Yes.
  - **The story:** a serif hero with "38 minutes late" in gold, the ten beats as a ring stepper and a vertical timeline.
  - **Scam Shield:** a dramatic verdict band, reasons as a checklist, and the log as count-up tiles.
  - **Read It To Me and Am I owed:** letter cards with the money large, drag and drop on the upload area, and a one-question-at-a-time screener with a ten-step progress bar.
  - **Trust pages:** a profile gallery; skills as cards; callers as character cards; Devices steppers and a framed QR; Privacy Proof as "who sees what" in three tiers; connectors with a gold hero and code windows for MCP; a memory timeline; settings rows.
  - **Kept:** every heading, label and role the tests and screen readers use is unchanged, and the 245 web tests pass.
  - **Found and fixed on the way:** `Stat` put an `aria-label` on a paragraph, which axe fails; it now has a screen-reader-only value. React duplicate keys in the Shield log. "3Step 3 of 8" read out on Margaret's Tuesday. The ledger showing £0.00 while loading.
- [x] 15:10 **The theme is no longer purple** (asked: "the UI is purple ish very vibe coded"):
  - Every accent class, colour value and gradient (about 300 places) now reads CSS variables (`accent-*`, `second-*`), so a palette is one block in `index.css`.
  - Three palettes were rendered on the real app and checked for AA contrast (white on the 600 shade: teal 5.2, blue 6.3, copper 5.0).
  - The user chose **lagoon teal**, with sky as the second hue. Gold stays for money.
  - The mark, favicon and app icons are re-rendered in teal, and `docs/design-system.md` explains the palettes.

---

## 16. The chat's brain: a real LLM holds the conversation (started 13:50)

*Reported from the live site: "it is giving template answer not ai agent answer". Asked: "I
dont want hardcoded it should be a good LLM", "for brain just use nvidia", "use this then
Nemotron 3 Ultra".*

**What was wrong:**
- The chat was a rules router with fixed sentences, and a model only phrased small talk.
- A reply to "Where were you going?" of "London" isn't one station, so the rules dropped the
  claim and said the help line.
- The GPU's small talk then timed out at 20 s twice, because the worker had gone cold.

**What it is now:**
- A language model holds the conversation. It sees the last 16 lines (the web sends them),
  answers in its own words, asks its own one question, and handles what Tempo can't do kindly
  ("I can only help with missed visits from broadband or phone engineers, not plumbers").
- It acts only through Tempo's tools: claim a late train, claim a missed engineer visit, check a
  scam, recall, forget, the ledger, sweep the inbox, read a letter, check benefits, profiles.
  Each tool is one of the chat's existing doors, so code still decides money, time and
  permissions: the rule pack sets the amount and the Court judges.
- **Code keeps STOP and the person's yes or no to a waiting ask.** The model never sees them.
- **Every fact a claim tool receives is checked against the person's own words**
  (`grounding.py`): the stations (London from Oxford may be Paddington, said back), the day,
  the time and the fare. A fact never said is refused, and the model asks for it instead.
- **The model's own words may not carry an amount, a percentage or a claim of having acted.**
  Markdown is flattened to plain text.
- When the model fails, is slow (15 s) or breaks a rule, the rules answer as before, and they
  keep noting facts on brain turns so a fallback carries on.
- **The model:** NVIDIA's Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`) on NVIDIA's API,
  chosen on Tempo's real turns, with thinking off. `CHAT_BRAIN=auto|nvidia|off`,
  `NVIDIA_BRAIN_MODEL`.
- **Honesty:** `/health` says `chat.brain`, and NVIDIA joins `third_parties` and the region
  whenever it reads the person's words.

**Why not route the chat to a Claude Code session (asked):**
- A public site's messages would reach a tool with a shell on the laptop.
- Claude subscriptions are for one person's own use.
- Claude as the brain belongs on the Anthropic API, behind the same tools and checks.

- [x] 13:55 Measured on Tempo's real turns (the London follow-up, the plumber, a full journey), with tools:
  - **Nemotron 3 Ultra** asked "Which London station?" and called the claim with every fact right.
  - **StepFun Step 5 preview** was as good.
  - **MiniMax M3.1 Flash** was good but spiked to 11 s.
  - **Nemotron Lightning** took the plumber for a broadband engineer.
  - **gpt-oss-20b made up a date, a time and a fare**, which is why the grounding checks exist.
  - **GLM 5.3 and DeepSeek V4.1** timed out.
  - **Thinking off** (`chat_template_kwargs.enable_thinking=false`) took Nemotron 3 Ultra's tool call from 21–28 s to 1.8 s.
- [x] 14:20 Built: `brain.py`, `grounding.py`, the brain's turn in `chat.py`, the conversation history from the web, `/health` and Privacy Proof naming. Tests: 9 brain integration tests (a stand-in NVIDIA) and 17 unit tests; 1,500 fast and 210 integration pass
- [x] 14:40 Nemotron kept reading facts back as a question ("Is that all correct?", "Was that 2026?") even when told not to. So a claim whose every fact is already said now starts in code at once, without the model (faster, and the same every time). The model gathers what's missing and does everything else. Markdown replies are flattened, and the label follows what the person asked
- [x] 14:50 **`make live-test` passed with the brain on the redesigned live site: 21 of 21 through the tunnel and 18 of 18 in the browser.** The live site (tempo-live-ten.vercel.app) and the showcase (tempo-showcase.vercel.app) both run the new design
- [x] 14:30 Live: the user's own transcript through the public tunnel. "London" got "Trains from Oxford usually arrive at London Paddington or Marylebone. Which one?", the plumber got a kind no, and a journey in pieces started the £14.20 claim. The GPU had gone cold again (a job queued 124 s), so the live demo now runs `cloud-apis`: Nemotron 3 Ultra as the brain, and Gemini plus NVIDIA jurors

---

## 17. Tempo is open to anything: live look-ups (started 15:30)

*Asked: "I want tempo to be open to any so equip web tools etc and everything", then "just use
nvidia for general task and show its output". From the live site: "find hotels in oxford" got
"I'm not able to search for hotels", by design until now.*

- **NVIDIA's Nemotron 3 Ultra now answers anything in its own words:** how to make tea, what Delay
  Repay is, what a web page says. The chat shows what it wrote. The only guards on a general
  answer:
  - No markdown symbols; lists become "• " lines.
  - Never a claim to have done something ("I've booked/filed/paid").
  - About Tempo's own claims, amounts still come only from the rule packs.
- **Four look-up tools the model may call** (`web_tools.py`), with up to four rounds per turn:

  | Tool | Source | Key |
  |---|---|---|
  | web_search | Tavily or Brave when a key is set; else DuckDuckGo's instant answers and Wikipedia (general knowledge, and it says so) | optional |
  | find_places | OpenStreetMap Nominatim (UK first): hotels, pharmacies, GPs, cafés, with address, phone and website | none |
  | weather | Open-Meteo, now and three days | none |
  | read_web_page | the page, fetched by the Gateway | none |

- **A look-up result is data, never instructions.** The model is told so, and a claim's facts must
  still be in the person's own words (`grounding.py`), so a page can't start a claim.
- **`read_web_page` reads only public addresses:**
  - http(s) on ports 80 and 443.
  - Every redirect is checked again, and loopback, private, link-local and reserved addresses are refused.
  - Pages are capped at 1.5 MB and 10 s, and reduced to text.
- **Under each answer:**
  - **Sources**, as links to the place's own site.
  - **"How Tempo got here"**, the steps with their times. This is the turn-trace idea from OpenBot (PolyForm Noncommercial), built from scratch with none of its code.
- **The voice** reads a long answer's first sentence and "The details are on your screen", which saves the ElevenLabs quota.
- **Honesty:** `/health` `chat.web` lists the look-up sources.

- [x] 15:30 Google Search grounding through the Gemini key returns 429 (no free quota for grounding), so web search falls back to keyless sources and takes a search key when one is set
- [x] 16:05 Built and tested:
  - Look-up and SSRF tests (private addresses, redirects to them, non-web schemes, a page read without scripts or icons), and tests of each source's parsing and failures.
  - The brain's look-up turn with sources and steps, and the voice's short form.
  - 1,520 fast, 213 integration and 247 web tests pass.
- [x] 16:15 Live on tempo-live-ten.vercel.app:
  - "find hotels in oxford" in 7.3 s: five real hotels with addresses, phones and websites, with sources and steps.
  - "weather in Oxford tomorrow" in 2.7 s: light rain, 16°C.
