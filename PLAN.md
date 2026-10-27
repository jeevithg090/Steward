# Steward — plan and record

> An open-source, proactive AI steward with a computer of its own.
> It does the work, asks before it acts, and keeps a record you can read.

This file is the plan, the contracts and the status log. Read §1–§4 before changing anything; §9 is the log.

Started 27 Oct 2026. Inspired by, and partly adapted from, three MIT-licensed CopilotKit projects:
[OpenBot](https://github.com/CopilotKit/openbot) (the governed agent platform),
[OpenDuet](https://github.com/CopilotKit/OpenDuet) (the proactive layer on top of it) and
[CopilotKit](https://github.com/CopilotKit/CopilotKit) (the runtime and React client we build on).
See `NOTICE`.

---

## 1. Why Steward exists, and what is different

OpenBot and OpenDuet are excellent, but they need Docker, Bun, PostgreSQL and a CopilotKit
Intelligence account before the first message. Steward keeps their best ideas and removes the
setup wall:

| | OpenBot / OpenDuet | Steward |
|---|---|---|
| Runs with | Docker, Bun, Postgres, Intelligence project | `pnpm install && pnpm dev` on Node ≥ 24. SQLite file, no containers |
| Model | OpenAI by default | Any OpenAI-compatible endpoint: OpenRouter, NVIDIA, OpenAI, Anthropic, Gemini, Ollama, or a scripted model for tests |
| Computer | One container per Bot | One Playwright Chromium profile + workspace per agent, in-process |
| Record | Audit table | **Hash-chained** audit: every row seals the one before; the UI verifies the chain |
| Injection | Untrusted-content guidance | Guidance **plus taint**: once a run has read the web or an email, anything that sends, pays, signs or deletes asks you, whatever the rules say |
| What leaves | Sensitive-data check on messages | Same, with named findings (card number by Luhn, IBAN by mod-97, NI/SSN, keys, health words) shown on the approval card |
| Access | Web, Slack, Teams | Web first, **accessible first**: voice in and out, large text, high contrast, reduced motion, plain-language mode, full keyboard and screen-reader paths |
| Make it yours | Tenant package folder | Same idea: `tenants/<name>/` YAML. Ships `steward` and `tempo` |

## 2. Product

**One line:** Steward reads your mail and calendar, tells you each morning what needs you, does the
work on a computer of its own while you are away, and never sends, pays, signs or deletes anything
without showing you exactly what and waiting for your answer.

**Rules that never bend**
1. Every tool call goes through one gateway: resolve the target → decide against policy → write the
   audit row → only then act → record the outcome. No other path acts.
2. Fail closed: unknown tool → treated as a write; broken rule → refuses; no policy → permits nothing.
3. Secrets never enter the transcript. The secret box sends the value to the page; the record keeps
   only that a secret was requested and its length.
4. Never call the person by a name they did not give. Demo data is labelled as demo data.
5. Honest labels: demo inbox, scripted model and replayed data say so on screen.

**Screens** (web app, `apps/web`)

| Route | What it shows |
|---|---|
| `/` Today | The morning brief (needs you / can wait / today's calendar / could not check), the newest suggestion with **Start** and **Hide**, a composer |
| `/chat/:threadId?` | The conversation. Every tool call renders as an action card; ones that need you show **Refuse / Allow once / Always allow**. Side panel: the live **Computer** with Activity and **Take the wheel** |
| `/tasks` | Needs you · Suggested · Working · Ready for review · Needs input · Resolved |
| `/computer` | The agent's screen full size, its workspace files, its shell history, take the wheel |
| `/routines` | Standing routines, next run, last result; stop or delete |
| `/rules` | What Steward may do without asking: presets, your standing rules, deny rules, a "would this be allowed?" tester |
| `/record` | The audit trail: permitted, asked, refused, failed; each refusal names its rule; chain verification badge |
| `/connections` | Google (demo inbox or real), MCP servers, built-in tools; grant tools to agents |
| `/skills` | Instructions written once and called with `/` |
| `/memory` | What it remembers about you; add or forget facts |
| `/settings` | Model, voice, accessibility, setup checklist |
| `/welcome` | First run: what Steward is, connect mail, choose voice/text size, ends on the setup checklist |

## 3. Architecture

```
apps/web (Vite + React 19 + Tailwind 4 + CopilotKit React v2)
   │  AG-UI over HTTP (CopilotKit runtime)   REST /api/*   WS /ws/computer/:agent   SSE /api/events
   ▼
apps/server (Hono on Node)
   ├─ CopilotKit runtime (v2) hosting the Steward agent(s)
   ├─ @steward/agent       model provider, tool registry, system prompt, the AG-UI agent
   │      every tool call ──► @steward/gateway  policy (CEL) → audit (hash chain) → approval → act
   ├─ @steward/computer    Playwright Chromium per agent, snapshot+refs, screencast, take the wheel,
   │                       workspace files, restricted shell
   ├─ @steward/connectors  Google (demo server + real API shape), MCP client manager, web tools
   ├─ @steward/proactive   triage, morning brief, suggestions, tasks, routines (croner), memory
   └─ @steward/db          one SQLite file (node:sqlite), migrations per package
```

Ports: web 5173 (dev), server 8787, demo Google mounted at `/demo-google` on the server.
Data lives in `.steward-data/` (gitignored): `steward.db`, `computers/<agent>/{profile,workspace}`.

## 4. Contracts

`packages/shared/src` is the single source of truth for types shared across packages and the web
app. Packages depend on the interfaces there, never on each other's internals. See §4 detail in
`packages/shared/README.md` once written. (Filled in after the research phase, §9.)

## 5. Work breakdown (build phase)

Each track owns its directories exclusively. Nobody runs `pnpm install`; missing dependencies are
reported back to the lead, who adds them.

| Track | Owns | Done when |
|---|---|---|
| gateway | `packages/gateway` | policy, approvals with waiters, hash-chained audit, outbound check, target checks, taint, dry run; unit tests |
| computer | `packages/computer` | Playwright manager, snapshot+refs, browser tools, screencast, input, secret fill, files, shell; tests against a local page |
| connectors | `packages/connectors` | demo Google server + client, MCP manager, web_fetch/web_search; tests |
| agent | `packages/agent` | model providers, tool registry, prompt, AG-UI agent with the gate, tenant loader; tests with a scripted model |
| proactive | `packages/proactive`, `evals/triage` | tasks, triage, brief, suggestions, routines, memory; eval set + runner |
| server | `apps/server` | wiring, REST, runtime endpoint, WS, SSE, worker; integration tests |
| web shell | `apps/web` (app, ui, lib, pages) | layout, theming, accessibility settings, every page but chat |
| web chat | `apps/web` (features/chat, features/computer, features/voice, gallery) | chat, generative UI, approval cards, computer panel, voice |
| docs | `README.md`, `docs/`, `tenants/`, `.github/`, `tests/e2e` | quick start, guides, tenant packages, CI, e2e specs |

## 6. Verification

`pnpm check` (typecheck, biome, vitest) · `pnpm e2e` (Playwright, scripted model) · a live walk
in the browser pane with a real model · `pnpm eval:triage`.

## 7. Security model

See `docs/security.md`. Summary: loopback by default; a single-user local mode; the gateway is the
only path to act; CEL deny-before-allow; taint; outbound check; secret box; hash-chained record;
shell runs in the workspace with a scrubbed environment, a timeout and an output cap, and asks by
default.

## 8. Out of scope for v0.1

Multi-user sign-in, Slack/Teams channels, mobile apps, real Google OAuth verification (the client
speaks Google's API shape; pointing it at Google needs your own OAuth client), container isolation
for the computer.

## 9. Status log

- **27 Oct 2026** — Research fan-out over CopilotKit 1.81, AG-UI, OpenBot and OpenDuet sources
  (briefs in the session scratchpad). Repo scaffolded: pnpm workspaces, pinned dependencies
  (CopilotKit 1.81.0, AI SDK 6, Hono 4, Playwright 1.64.0, Vite 8, React 19.3, Tailwind 4.3).
