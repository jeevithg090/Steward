# Excellence pass

Started 10 Nov 2026. The goal is to make Steward excellent: correct, secure, well tested, pleasant
and accessible to use, and honestly documented. It is done by 60 agents in three roles.

## How the work is split

1. **Audit (20 agents, read only).** One auditor per area returns at most 12 ranked items, each
   with file:line evidence, a concrete fix and whether it was verified by a run or a precise trace.
   - First 14: gateway, agent runtime, computer, connectors, proactive, other agents and
     delegation, server and database, web UX, web accessibility, bots, directory/relay/phone,
     cross-cutting security, docs and first run, tests and CI.
   - Six more: chat and the computer panel, the individual pages, tenants and YAML config,
     performance and reliability, feature parity with OpenBot/OpenDuet/CopilotKit, and a live QA
     walk of every screen with the scripted model.
2. **Build (20 agents).** One builder per track, each in its own worktree under
   `OxHack/.excellent/<track>` on branch `excellent/<track>`. A builder checks every item against
   the code first (auditors can be wrong), fixes it with a test that fails before and passes after,
   and runs its packages' typecheck, tests and Biome.
3. **Review (20 agents).** One reviewer per track reads the whole branch diff as a skeptic: does
   each fix really close the hole, does it break a rule in PLAN.md §2, are the tests meaningful. It
   fixes what it finds on the same branch.

The lead then merges the branches, renumbers any migration ids that clash, runs `pnpm check` and
the e2e suite, and writes the outcome into PLAN.md §9.

## Tracks

Wave 1 starts as soon as the first 14 audits are in:

| Track           | Owns                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| `taint`         | Taint end to end: writes that leave Steward, delegation, started suggestions, chat links |
| `outbound`      | The outbound check (cards, keys), shell presets, rules on full arguments, escalation     |
| `record`        | Record verification off the event loop, chain gaps, stale approvals, Always allow scope  |
| `agent`         | Context budget, cut-off replies, loop guard, model errors, timeouts, agent state         |
| `computer`      | Shell HOME, key-press checks, the secret box, downloads, workspace files, crash recovery |
| `mcp`           | MCP kinds, changed tools after a grant, name clashes, limits, errors, credentials        |
| `routines-mail` | Routine restarts and missed runs, the cron form, an inbox watch, mail and calendar edges |
| `brief`         | Honest brief when a source fails, no names to the model, mail window, triage parsing     |
| `harnesses`     | Coding agents: Always allow scope, hangs, process trees, bypass flags, delegation rows   |
| `server`        | Stopped runs, deleted threads, dev origins, file modes, IPv6, validation, configuration  |
| `bots-install`  | Bot rules scoped to the bot, injection scan, update diff, fetch hardening, /bots paging  |
| `bots-content`  | Rule meaning checks, retirement floor, content safety, index dates and drift test        |
| `remote`        | Directory approvals, sign-in redirect, relay replay, phone initiator and thread scope    |
| `tests-ci`      | CI order, order-dependent and timing tests, e2e for approvals, taint, record, core flows |

Wave 2 starts when the second six audits are in: `web-shell` (server down, Welcome, conversation
list, pages), `web-chat` (chat, cards, computer panel, voice), `web-a11y` (focus, forced colours,
large text, axe coverage), `docs-tenants` (README, docs, tenants, first run), `perf` and `parity`.

## Rules every agent follows

- PLAN.md §2 rules never bend: one gateway, fail closed, no secrets in transcripts, never a name
  the person did not give, honest labels.
- Plain-language copy, no new dependencies without a strong reason, nothing that needs an account.
- Each builder stays inside its track's files; work that needs another track's files is handed off
  in its report, not done.
- Commits as `jeevithg090` with `--no-verify`; nothing is pushed.

## Status

- 10 Nov 2026: the 14 first audits returned 165 items. Wave 1 started.
