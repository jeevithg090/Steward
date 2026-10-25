# The web app (`apps/web`)

How the web app is built, for contributors. [`plan.md`](../plan.md) holds the contracts it was
built against (§4); this page is the map. The app is a **Vite + React 19 + Tailwind** single-page
app with **hash routes**, one typed **Gateway client**, and a **showcase** that answers from
recordings so the whole thing runs with no backend. The theme (dark navy sidebar, near-black
canvas, charcoal cards, indigo badges, rounded pills, lucide icons, the talking avatar) came from
the team's new chat UI and was kept; the visible name is Tempo.

## Commands

```bash
cd apps/web
npm ci                              # Node 22+; the lockfile is package-lock.json, so install with npm
npm run dev                         # http://localhost:3000, against the Gateway on 8000
VITE_TEMPO_SHOWCASE=1 npm run dev   # no Gateway: recorded replies (make showcase)
npm run typecheck                   # tsc --noEmit
npm test                            # vitest: Testing Library + jsdom + axe
npm run build                       # tsc, then vite build → dist/ (prebuild regenerates the catalogue)
npm run preview                     # serve dist/ on 3000
npm run catalog                     # the profile and skill catalogue from profiles/ and skills/
```

From the repo root: `make demo` (a Gateway from a scratch folder, seeded, plus this app),
`make demo-gateway`, `make showcase`, `make web-check` (typecheck, tests, both builds: what CI
runs), `make catalog`, `make deploy-web`.

## Layout

| Path | What |
|---|---|
| `index.html` | the document: `<title>Tempo</title>`, and the boot script that applies text size, plain mode and reduced motion before the first paint |
| `src/main.tsx`, `src/App.tsx` | the mount; the shell, the route switch, one Gateway for the whole app, `/health` polling, live events, who Tempo works for |
| `src/router.ts` | hash routing (below) |
| `src/types/page.ts` | `PageProps`, what every page receives |
| `src/lib/api.ts` | the typed Gateway client |
| `src/lib/config.ts` | where the Gateway is: build-time env, then per-browser overrides, then `?showcase=1` |
| `src/lib/showcase.ts`, `src/lib/showcase-chat.ts`, `src/showcase/*.json` | the no-Gateway mode and its recordings (`src/showcase/README.md` lists them) |
| `src/lib/shield.ts`, `letters.ts`, `profiles.ts`, `catalog-client.ts` | the other clients: Scam Shield, Read It To Me, Profiles, the catalogue |
| `src/lib/live.ts` | `WS /events` → `events` in `PageProps` |
| `src/lib/a11y-prefs.ts` | text size and plain mode, kept per browser |
| `src/components/layout/` | `AppShell` (skip link, header with the honesty badge, `<main id="main">`, the drawer on small screens) and `Sidebar` |
| `src/components/ui/` | `Card`, `Button`, `Badge`, `Pill`, `Switch`, `SectionTitle`, `PageTitle`, `EmptyState`, `Spinner`, `HonestyBadge`, `ResizeHandle` |
| `src/features/<page>/` | one folder per page: `chat`, `missions`, `memory`, `profiles`, `skills`, `shield`, `read`, `owed`, `callers`, `privacy`, `story`, `settings` |
| `src/hooks/` | `useSpeech` (speech out and the avatar's visemes), `useAudioRecorder`, `useResizable`, `useElementWidth` |
| `src/test/` | `setup.ts` (jest-dom matchers) and `a11y.ts` (`expectNoA11yViolations`, axe) |
| `scripts/build-catalog.mjs` | the catalogue generator (`npm run catalog`, and `prebuild`) |
| `vite.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `vercel.json`, `tauri.conf.json`, `Cargo.toml`, `.env.example` | the build, the theme tokens, types (`@/` → `src/`), Vercel, the desktop shell (configured, not built: no Rust toolchain here) |

## Routes

Hash routing with no router dependency (plan.md §1.4): the build is a static site that works on
Vercel, in `vite preview` and inside Tauri. `src/router.ts` exports `ROUTES` (the patterns),
`useRoute()` → `{ path, params, query }` read from `location.hash`, `navigate(path)`,
`linkProps(to)` for an `<a>`, and `section(path)` for the sidebar highlight (`/missions/abc` →
`/missions`). A `:id` segment becomes `params.id`.

| Route | Page | Route | Page |
|---|---|---|---|
| `#/chat` (home) | Chat | `#/read` | Read It To Me |
| `#/missions`, `#/missions/:id` | Mission Control | `#/owed` | Am I Owed Anything? |
| `#/memory` | Memory | `#/callers` | Who's calling? |
| `#/profiles`, `#/profiles/:id`, `#/profiles/import` | Profiles | `#/privacy` | Privacy Proof |
| `#/skills` | Skills | `#/story` | The story |
| `#/shield` | Scam Shield | `#/settings` | Settings |

The sidebar (`src/components/layout/Sidebar.tsx`) lists them in two groups, *Doing* and *Trust*,
with Settings at the bottom; the chat's history appears under them on the chat page.

## Pages and their props

Every page is a default-exported component at `src/features/<name>/<Name>Page.tsx` that takes
`PageProps` (`src/types/page.ts`):

| Prop | What |
|---|---|
| `gateway` | the Gateway client, or the showcase standing in for it |
| `user` | `{ id, name, profileId }`: who Tempo is working for |
| `showcase` | true when there is no Gateway and `gateway` answers from recordings |
| `health` | the Gateway's `/health`, or null when unreachable |
| `events` | live Gateway events, newest first (empty in showcase) |
| `language` | the language Tempo speaks to this person: `en`, `hi`, `pa`, `pl`, `ur`, `cy` |
| `params` | route params, e.g. `{ id }` on `#/missions/:id` |
| `speak(text)` | have the avatar read a sentence aloud (a no-op when voice is off) |
| `setProfile(id)` | change who Tempo works for (the picker on `#/profiles`) |

Pages never read env or `localStorage` themselves; `App.tsx` resolves everything once. Each page
owns its loading, empty and error states (`<EmptyState>`), has one `<h1>` (`<PageTitle>`),
landmarks, `aria-live` for state changes and visible focus, and is axe-clean in its tests.

### Adding a page

1. Create `src/features/x/XPage.tsx`: a default-exported component taking `PageProps`, with a
   `<PageTitle>` as its one `<h1>`.
2. Add the route pattern to `ROUTES` in `src/router.ts`, and a `case "/x"` to the switch in
   `src/App.tsx` (lazy-import the page as the others are).
3. Add a sidebar entry to `NAV_DOING` or `NAV_TRUST` in `src/components/layout/Sidebar.tsx`: a
   lucide icon and a short label.
4. Write `src/features/x/XPage.test.tsx`: render against a fake `Gateway` and
   `await expectNoA11yViolations(container)`.
5. If the page needs a new Gateway call, add the method to `src/lib/api.ts` **and** override it in
   `ShowcaseGateway` (`src/lib/showcase.ts`) with a recording, so the page also works with no
   backend.

## The Gateway client

`src/lib/api.ts` is the typed client restored from the earlier site (`@/` → `src/`,
`import.meta.env`). The methods pages use: `health, missions, mission, ledger, start, startOfcom,
readCard, answer, stop, tick, advanceClock, creditArrives, revokeMandate, privacy, memories,
forgetMemory, forgetEpisode, correctMemory, voiceProfile, eventsUrl`, plus `chat(turn)`,
`tts(text, persona, voice)`, `ttsConfigured()` and `screen(answers)`. It sends the bearer token
from `gatewayConfig()` in `src/lib/config.ts`: the build's `VITE_GATEWAY_URL` and
`VITE_TEMPO_TOKEN`, overridden at runtime by Settings (`localStorage` keys `tempo.gateway`,
`tempo.token`). Scam Shield, letters, profiles and the catalogue keep their own small clients.

## Showcase: no Gateway

`VITE_TEMPO_SHOWCASE=1` at build time, `tempo.showcase=1` in `localStorage` (the Settings switch)
or `?showcase=1` on the URL make `App.tsx` use `ShowcaseGateway` (`src/lib/showcase.ts`): a
`Gateway` subclass that answers every method from `src/showcase/*.json`, recordings taken from a
real replay-mode Gateway, and walks Margaret's missions through their recorded states as the
buttons are pressed. The badge reads **SHOWCASE · recorded replay · no Gateway**. The chat in
showcase answers through `showcaseChat` (`src/lib/showcase-chat.ts`).

`src/showcase/README.md` lists every file with the route and the moment it records, and how to
re-record them: start a Gateway from an **empty folder**, never from inside the repo (its `.env`
may point `DATABASE_URL` at a hosted database); `make demo-gateway` does exactly that, seeded
with `scripts/seed.py`; then drive the routes with curl and the bearer and save each reply under
the name in that table. `catalog.json` is not recorded: `npm run catalog` generates it from
`profiles/*.yaml` and `skills/*/skill.yaml`.

## The chat door

`#/chat` posts free text to the Gateway's `POST /chat` (plan.md §4.1). A `ChatTurn`
(`user_id, display_name, text, profile_id, language, slots`) returns a `ChatReply` (`intent,
reply, say, slots, needs, mission, ask, verdict, memories, ledger, flags, actions, simulated`).
The router on the server is code, not a model (`tempo_core.intent`): rules classify the intent
and pull the facts out; a model may only phrase small talk, and never a number, a promise or an
action. The client echoes the merged `slots` back each turn (the server keeps no conversation
state), renders `needs` as the one question, `ask` as the consent card with the Proof Trace and
the Court's votes, `verdict` as the Scam Shield card, and `actions` as links to pages.

In showcase the same rules run in TypeScript, `src/lib/showcase-chat.ts`, a port of the Python
table. Both sides are checked against one vector file, `fixtures/chat/intents.json`: the Python
router in `tests/unit/test_intent.py`, the TypeScript port in the web tests, so the web says what
the phone says. The route's own page is `docs/chat.md`.

### Phase 2 behaviours (plan.md §12)

- **`#/chat?say=<text>`** sends that sentence once, as if typed, in a fresh conversation, then puts
  `#/chat` back with `history.replaceState` (Back never resends). The story's "Try it" buttons, the
  Skills cards and Profiles' "Try it with this profile" use it.
- **Suggestions**: `ChatReply.suggestions` (≤ 4) render as chips under the newest reply; tapping sends.
- **Conversations survive a reload**: the chat store is saved under `tempo.chat.v1` in localStorage
  (30 conversations, 100 messages each, no audio); on load, asks for missions the Gateway no longer
  has are cleared. Switching showcase on or off resets the chat.
- **Devices and passkeys**: `src/lib/mesh-context.tsx` (`MeshProvider`, `useMesh()`), `src/lib/approve.ts`
  (`answerAsk` signs with Face ID when this browser holds a passkey, else uses the bearer). The QR
  link `<origin>/#pair=<id>.<secret>` routes to `/pair`. `ConsentCard signed` and `PassportPanel` read it.
- **Toasts and skeletons**: `toast.success|error|info`, `Skeleton`, `SkeletonCards` from `@/components/ui`;
  toasts sit under the header on phones and bottom-right on wide screens.
- **Shell**: a Gateway-offline banner with "Use the showcase", the Time Ledger in the sidebar, page
  titles, focus moved to the content on navigation, an installable manifest (`public/manifest.webmanifest`).

## Theme (plan.md §4.7)

Tailwind tokens in `tailwind.config.ts`, kept under their original `nexus-*` names so the
components needed no churn: `nexus-nav #0d0066`, `nexus-nav-hi #120078`, `nexus-canvas #0a0a0c`,
`nexus-card #1f1f22`, `nexus-silver #a1a1aa`, `nexus-badge #2a1fa8`. Accents: indigo (primary,
links), emerald (yes, paid, ok), rose (stop, scam), amber (caution, demo values), purple (auditor,
proof). Shapes: cards `rounded-2xl bg-nexus-card border border-white/10 p-4`, pills
`rounded-full`, section labels `text-[10px] font-semibold uppercase tracking-wider
text-slate-400`, body `text-sm text-slate-200`, focus `focus-visible:outline
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`. Icons from
lucide only. Use the primitives in `src/components/ui/` rather than restyling by hand.

## Accessibility controls

They live in Settings (`src/features/settings/SettingsPage.tsx`) and are kept per browser:

| Control | Attribute on `<html>` | Effect (`src/index.css`) |
|---|---|---|
| Text size A / A+ / A++ | `data-text-size="large"` / `"larger"` | root font 118% / 136% |
| Plain mode | `data-plain` | buttons, links-as-buttons, selects and inputs at least 44 px tall; `.plain-hide` extras hidden |
| Reduce motion | `data-reduce-motion` | animations and transitions off (pulse, ping, blink) |
| Language Tempo speaks | (prop `language`) | `en`, `hi`, `pa`, `pl`, `ur`, `cy`; spoken scam warnings use it |

Keys: `tempo.textSize`, `tempo.plain`, `tempo.reduceMotion`, `tempo.language`
(`src/lib/a11y-prefs.ts`, `SettingsPage.tsx`); the boot script in `index.html` applies them
before the first paint. Speech in uses the browser's `SpeechRecognition` (Chrome, Safari); where
it is missing the mic records a clip and the chat says so. Speech out tries the Gateway's
`POST /voice/tts` first (the server's ElevenLabs key) and the browser's own voice second
(`src/hooks/useSpeech.ts`). The statement and the WCAG checklist are in
[`docs/accessibility.md`](accessibility.md).

## Environment (plan.md §4.4)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_GATEWAY_URL` | `http://127.0.0.1:8000` | the Gateway |
| `VITE_TEMPO_TOKEN` | `devtoken` | the demo bearer (it ends up in the bundle; passkeys on the Devices page are the real auth, and once a person has one the Gateway refuses a bearer yes; a no is still taken) |
| `VITE_TEMPO_SHOWCASE` | unset | `1` → no Gateway, recordings only; Settings cannot switch it off |

Vite reads `VITE_*` at **build time** (and from the shell for `npm run dev`); `.env.example` is
the template for a local `.env.local`. Runtime overrides from Settings (`tempo.gateway`,
`tempo.token`, `tempo.showcase` in `localStorage`) win over the build's values, and `?showcase=1`
on the URL switches the showcase on for the session (`src/lib/config.ts`).

## Tests

Vitest with Testing Library, jsdom and axe-core; the `test` block in `vite.config.ts` picks up
`src/**/*.test.{ts,tsx}` with `src/test/setup.ts`. Each page has at least one render test against
a fake `Gateway` and one axe check (`expectNoA11yViolations` from `src/test/a11y.ts`; colour
contrast is checked by hand because jsdom does not paint). The web check, locally and in CI's
`web` job, is:

```bash
npm run typecheck && npm test && npm run build && VITE_TEMPO_SHOWCASE=1 npm run build
```

End to end, `tests/e2e/smoke.spec.ts` (Playwright, `make e2e`) starts a replay Gateway on 8010
from a temporary folder, builds this app with `VITE_GATEWAY_URL` pointing at it and serves
`vite preview` on 3010, then walks the chat door (the sample chip → *Yes, claim £* → the money
arrives), Scam Shield and every page's `<h1>`.

## Deploying

Vercel: framework Vite, root `apps/web`, `vercel.json` already in place; `VITE_TEMPO_SHOWCASE=1`
for the public showcase or `VITE_GATEWAY_URL` + `VITE_TEMPO_TOKEN` for a live Gateway. The steps
are in [`docs/deploy.md`](deploy.md). The desktop shell (`tauri.conf.json`, `Cargo.toml`,
`npm run tauri dev`) is configured and Tempo-named but needs a Rust toolchain, which the build
machine lacked; it is documented, not built.
