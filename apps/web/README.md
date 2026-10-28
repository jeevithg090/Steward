# @steward/web

Steward's web app: Today, Chat, Bots (the directory: browse, read what a bot may do, add it, make
one), Tasks, the agent's Computer, Routines, Rules, the Record, Connections, Skills, Memory and
Settings. Vite 8, React 19, Tailwind CSS 4, TanStack Query 5 and
CopilotKit's React client (v2).

Accessibility is a headline feature, not a pass at the end: every screen works by keyboard and
screen reader, text grows to 150% without breaking the layout, and colour never carries meaning on
its own.

## Run it

From the repository root:

```sh
pnpm dev            # the server on :8787 and this app on :5173 together
pnpm dev:web        # only this app; it proxies /api and /ws to the server
```

Open <http://127.0.0.1:5173>. The first visit shows a short welcome; Today follows.

| Variable               | Default                 | What it does                                         |
| ---------------------- | ----------------------- | ---------------------------------------------------- |
| `STEWARD_SERVER_URL`   | `http://127.0.0.1:8787` | Where the dev server's proxy sends `/api` and `/ws`. |
| `VITE_STEWARD_API_URL` | _(empty: same origin)_  | Call a server on another origin from the built app.  |

The proxy passes streams straight through (no compression, no buffering), so the CopilotKit
runtime's events and the live `/api/events` stream arrive as they are sent.

```sh
pnpm --filter @steward/web build      # → apps/web/dist, served by the Steward server in production
pnpm --filter @steward/web typecheck
pnpm vitest run --project web         # from the repository root
```

## How it is put together

```
src/
  main.tsx            entry: mounts <App/> and the stylesheet
  app/                the shell
    App.tsx           QueryClient → accessibility → error boundary → router → CopilotKit → routes; toasts
    routes.tsx        every route; each page is its own lazily loaded chunk
    Layout.tsx        skip link, left rail or phone tab bar, banners, focus after navigation
    accessibility.tsx AccessibilityProvider and useAccessibility()
    layout-mode.ts    useWideLayout(): the desktop breakpoint, scaled by text size
    shortcuts.tsx     g t / g c / g k … and the ? help dialog
    banners.tsx       demo ribbon, "waiting on you" banner, live-connection note
    notifications.tsx the bell and its list
    features.ts       the only imports from src/features (the chat track's code)
  components/
    ui/               Button, Card, Badge, Pill, Dialog, Tabs, Field/Input/Textarea/Select/Switch,
                      ChoiceGroup, Checkbox, Notice, Loading, EmptyState, PageHeader/Page, Kbd, Spinner
    cards/            ApprovalCard, BriefCard, TaskCard, EmailList, CalendarDay, RuleBadge
    setup/            SetupChecklist (Settings and Welcome)
    settings/         AccessibilityControls (Settings and Welcome)
    forms/            TimezoneSelect
  lib/
    api.ts            typed client for every route in packages/shared/src/api.ts, and a hook per route
    live.ts           one shared EventSource to /api/events; cache invalidation; useLiveEvents()
    labels.ts         plain words for tool names, kinds, effects, record types and task states
    cron.ts           reads a routine's schedule aloud and warns before the 15-minute floor
    utils.ts          cn, relativeTime, formatBytes, plural, localDate, storage …
  pages/              Today, Tasks, Routines, Rules, Record, Connections, Skills, Memory, Settings,
                      Welcome, NotFound
  styles/app.css      the design system
  features/, gallery/ chat, computer, voice and generative UI (built by the chat track)
```

### Data

`src/lib/api.ts` builds every path from `ROUTES` with `route()` from `@steward/shared`, so the app
and the server agree on one list (a test fails if a route has no client call). A failed request
throws `ApiError`, whose message is the server's own sentence (`{ "error": "…" }`), ready to show.

Each route has a hook (`useTasks`, `useDecideApproval`, `useAudit` …). Cache keys live in
`queryKeys`. The server pushes changes over SSE; `useLiveSync()` (mounted once by the shell) keeps
the caches in step, and features listen with `useLiveEvents(listener)`. The stream reconnects with
backoff and refreshes everything after a reconnect, because events may have been missed.

### Contracts with the chat track

The shell imports `StewardCopilotProvider`, `ChatPage` and `ComputerPage` from `src/features`
(PLAN.md §5.1) in one file, `src/app/features.ts`. The chat track imports from the shell: `api` and
the hooks, `useLiveEvents`, `cn`, the UI kit, the cards and `useAccessibility()`.

A page hands a message to the chat with `/chat?prompt=…` (`chatPromptHref()` in
`lib/onboarding.ts`); the chat sends it once.

## Design system

`src/styles/app.css` defines Steward's tokens, adapted from OpenDuet's (MIT, CopilotKit): neutral
greys, one teal accent, and four status tones.

| Token (`--st-*`)                 | Utility                          | Light                       | Dark                        |
| -------------------------------- | -------------------------------- | --------------------------- | --------------------------- |
| surface / card / tile            | `bg-surface` `bg-card` `bg-tile` | #f6f7f7 / #fff / #eef1f0    | #101413 / #1a1f1e / #232a29 |
| ink / ink-2 / ink-3              | `text-ink` …                     | #151a19 / #4f5856 / #5f6967 | #eef2f1 / #a9b3b1 / #8f9a98 |
| accent / accent-soft             | `bg-accent` `bg-accent-soft`     | #0f6e66 / #e6f4f2           | #6ad3c5 / #12302d           |
| done · needs · working · problem | `text-done` `bg-needs-soft` …    | green · amber · blue · red  | lighter on dark             |

Every colour is written once with `light-dark()`; the scheme follows the system, or the person's
choice through `data-theme`. Every pair used for text meets WCAG AA (4.5:1) in both schemes, and
control borders (`--st-line`) meet 3:1.

Five type sizes (`text-display`, `text-title`, `text-body`, `text-sub`, `text-caption`), all in
rem. Every button and control is at least 44px tall (`min-h-target`).

Colour appears only on status, and a status always carries an icon and a word (`<Pill>`).

## Accessibility

The person's settings live in this browser and are written to `<html>` as attributes, which the
stylesheet reads. `index.html` applies them before the first paint.

| Setting                         | Attribute                               | Effect                                                                                                                                           |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text size 100 / 115 / 130 / 150 | `data-text`                             | Scales the root font size; everything is in rem. The desktop layout's breakpoint scales too, so large text gets the roomier phone layout sooner. |
| More contrast                   | `data-contrast="more"`                  | Full-strength ink, real borders, thicker focus rings, no translucent glass.                                                                      |
| Reduce motion                   | `data-motion="reduce"`                  | No animation. `prefers-reduced-motion` is honoured as well.                                                                                      |
| Light / dark                    | `data-theme` (+ `.dark` for CopilotKit) | Otherwise follows the system.                                                                                                                    |
| Easier-to-read lettering        | `data-font="readable"`                  | Atkinson Hyperlegible when installed, else wide system faces. No font is downloaded.                                                             |
| Read replies aloud              | —                                       | Read by the chat's voice feature.                                                                                                                |
| Plain language                  | —                                       | Also saved on the server (`PUT /api/settings`) so the agent uses it.                                                                             |

Throughout the app:

- Landmarks (`header`, `nav`, `main`, `aside`), a skip link, and one `h1` per page.
- After navigation, focus moves to the new page's heading, so screen readers announce it.
- Every control is labelled; form fields wire their description and error to the control.
- Async results are announced in live regions that are mounted before the text arrives.
- Dialogs are native `<dialog>` elements: named, Escape closes, Tab stays inside, focus returns.
- Tabs use a roving tabindex: arrow keys, Home and End.
- Keyboard shortcuts: `g` then `t` Today, `c` Chat, `b` Bots, `k` Tasks, `o` Computer, `u`
  Routines, `r` Rules, `l` Record, `s` Settings; `?` lists them. They never fire while typing or with a
  modifier held.

## Honesty on screen

When the inbox is the demo one or the model is the scripted one, a ribbon on every page says so.
Steward never addresses the person by a name: Today greets with "Good morning", nothing more.

## Tests

Vitest with happy-dom and Testing Library, next to the code (`src/**/*.test.ts(x)`): the API client
against every route, the live stream, the accessibility provider, the UI kit's keyboard and ARIA
behaviour, keyboard shortcuts, the approval and brief cards, and the Tasks page.
