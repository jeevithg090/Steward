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
- 10 Nov 2026: the six second audits returned 75 more. Of the 240, 232 went to the 20 tracks;
  the other 8 were already covered by a wave-1 track.
- 11 Nov 2026: every builder and reviewer finished. Builders closed 226 work-list entries and
  skipped 27 with a reason (wrong, stale, or another track's). Reviewers fixed 80 problems in the
  builders' work, among them a padding bypass of the card check, Always allow on a page with no
  host, and a new shell rule that refused `rm -rf build > /dev/null` outright. Three reviewers ended
  on "concerns"; what is left is in PLAN.md §9.
- 11 Nov 2026: the lead merged the 20 branches into `excellent/integration` and fixed where they
  met: a late routine's note, the database's new migration-id check against older tests, the
  fixed bot rules against limiting old ones to their bot, the directory fetch guard's messages,
  the chat page's agent and empty-conversation rules, the scripted model and the new task
  label, and the phone tests run in any order. Migration `proactive.002_triage_cache_context`
  became `proactive.003_triage_cache_context`.
- 11 Nov 2026: three handoffs no track owned were done by the lead: the agent counts a tool it
  does not know as tainting, the chat follows the shell's layout at large text (the web-a11y
  track's fixme spec now runs), and the lead-tracker bot's example lost its phone number. The
  README no longer claims CI runs on GitHub.

### What the pass taught

- Parallel builders in sibling worktrees share `refs/stash`; one builder's `git stash pop` took
  another's work. Every prompt now forbids `git stash`.
- A message to a running workflow agent starts a second copy instead of reaching it. Put every
  instruction in the prompt before launch.
- Most merge fixes were where one track tightened a rule (fixed bot rules, migration ids, tests
  that must pass in any order) and another track's new code or tests assumed the old one. Run
  the whole suite after each merge, not only the touched packages.
