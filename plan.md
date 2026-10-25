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
- **Passkey answers through the chat:** if `mesh.has_passkey(user_id)`, `approve`/`decline` in
  `/chat` reply "Please confirm with Face ID or your fingerprint on this device." with the pending
  `ask` echoed and nothing answered. The web then signs with `useMesh().mesh.answer`.
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

