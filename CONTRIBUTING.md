# Contributing to Steward

Thank you for wanting to help. Steward is young, and good bug reports, small fixes, docs, tests,
accessibility checks and tenant packages are all as welcome as features.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug

Open an issue with the **Bug report** template. The most useful reports say:

- what you did, step by step, ideally with the scripted model and the demo inbox
  (`STEWARD_MODEL_PROVIDER=scripted pnpm dev`) so anyone can repeat it;
- what you expected, and what happened instead;
- your operating system, Node version (`node --version`), browser, and the model provider;
- the relevant lines from the server's log.

**Never paste keys, passwords, real mail or anything from `.steward-data/` into an issue.** If the
bug is a security problem (anything that lets a call skip the gateway, a secret leak, a way past an
approval), do not open an issue: follow [SECURITY.md](SECURITY.md).

Accessibility problems are bugs. If something does not work with your screen reader, keyboard,
switch or magnifier, please report it the same way, and say which one you use.

## Setting up

You need Node 24 or newer, and pnpm 10 (`corepack enable` installs the version the repository asks
for).

```sh
pnpm install
cp .env.example .env      # a key is optional; without one the scripted model runs
pnpm dev                  # http://localhost:5173
```

Before you push:

```sh
pnpm check                # typecheck, Biome, Vitest
pnpm e2e                  # Playwright, if you changed anything a person sees or anything in the server
pnpm eval:triage          # if you changed triage
```

`pnpm format` fixes formatting. The first `pnpm e2e` may need `pnpm exec playwright install chromium`.

## Finding your way

| You want to change                                          | Look in                                |
| ----------------------------------------------------------- | -------------------------------------- |
| A contract between packages: a type, a route, a tool's kind | `packages/shared/src` (see below)      |
| What is allowed, what asks, the record                      | `packages/gateway`                     |
| The agent's browser, files or shell                         | `packages/computer`                    |
| Mail, calendar, MCP, web fetch and search                   | `packages/connectors`                  |
| Triage, the brief, tasks, routines, memory, skills          | `packages/proactive`                   |
| The prompt, the tools the model sees, models, tenants       | `packages/agent`                       |
| Claude Code, Gemini CLI, Codex and other coding agents      | `packages/harnesses`                   |
| The bot pack format and the directory client                | `packages/bots`                        |
| Generating bots, the quality judge, the seed converters     | `packages/bots-gen`                    |
| The bots that ship with Steward (then run `seed build`)     | `directory/`                           |
| The hosted bot directory                                    | `apps/directory`                       |
| iPhone shortcuts and the phone catalogue                    | `packages/shortcuts`, `packages/phone` |
| The phone app's crypto and its relay                        | `packages/remote`, `apps/relay`        |
| Routes, wiring, workers, the phone port                     | `apps/server`                          |
| Anything on screen                                          | `apps/web`                             |
| Steward's or Tempo's name, agent, skills, rules             | `tenants/`                             |

[PLAN.md](PLAN.md) explains the architecture and the decisions behind it, and
[docs/architecture.md](docs/architecture.md) follows one turn of a conversation through the code.

### Changing a contract

`packages/shared` is the single source of truth every package builds against. A change there
touches several packages at once, so propose it in an issue first, and keep it in its own pull
request with the packages updated to match.

### Adding a tool

1. Add it to `TOOLS` in `packages/shared/src/tools.ts` with its **kind**, **surface** and whether
   it **taints**. Be pessimistic: a tool that might send is a `send`; a tool that returns anything
   from outside taints.
2. Define it in `packages/agent/src/tools` with a description that tells the model when to use it
   and when not to.
3. Give it a target resolver, so rules can see what it touches (a host, a path, recipients).
4. Add a renderer in the web app so it draws as an action card.
5. Test the gateway's decision for it, including the refusal path.
6. Add it to [docs/tools.md](docs/tools.md).

## The rules that never bend

Every change keeps these true. A pull request that weakens one will not be merged, however useful
it is otherwise.

1. **Every tool call goes through the gateway.** No other path acts, including "just this once" for
   a read.
2. **Fail closed.** An unknown tool is a write. A rule that cannot be evaluated refuses. An error
   while deciding refuses.
3. **Secrets never enter the transcript or the record.** Only that a secret was asked for, and its
   length.
4. **Never call the person by a name they did not give.** Not in prompts, not in demo data, not in
   examples, not in test fixtures. Greet with "Hi".
5. **Honest labels.** Demo data, the scripted model and anything replayed say so on screen.

## Style

- **TypeScript, strict, ESM.** Inside a package, import with relative paths and the `.ts`
  extension; between packages, import by package name. Use `import type` for types.
- **Names say what things are.** Comments say why, not what: a short doc comment on anything whose
  reason is not obvious. No commented-out code.
- **Copy is plain.** Short sentences, everyday words, no jargon, no blame. Say what happened and what
  to do. British or neutral spelling, consistently within a file.
- **Formatting is Biome's.** `pnpm format` before you commit.
- **Code adapted from elsewhere** keeps its licence and says so in a header comment, for example
  `Adapted from openbot/agent-computer/src/shell.ts (MIT, CopilotKit)`. Add any new source project
  to [NOTICE](NOTICE).
- **Dependencies** are pinned to exact versions. Propose a new one in the pull request description
  and say why the standard library or an existing dependency will not do.

## Tests

- Unit tests live in each package's `test/` folder, and in `apps/web/src` beside the component as
  `*.test.tsx`. They run with Vitest.
- For the gateway, the computer and the connectors' network guard, test the refusal as carefully as
  the success: the case that must not happen is the one that matters.
- End-to-end specs in `tests/e2e` find things by role, label and visible text, the way a screen
  reader would. If a spec cannot find a control that way, the control needs fixing, not the spec.
- Tests never need a network or a key. Use the scripted model and the demo inbox.

## Accessibility checklist for anything on screen

- Works with the keyboard alone, in a sensible order, with a visible focus ring.
- Every control has a name a screen reader can say; icons are hidden from it or named.
- One `h1` per page; headings in order; new content announced through a live region.
- Colour is never the only signal; text has a contrast of at least 4.5:1.
- Targets at least 44 by 44 pixels; nothing breaks at 200% zoom or 150% text.
- Motion respects reduced motion.

[docs/accessibility.md](docs/accessibility.md) says how to test with VoiceOver and NVDA.

## Pull requests

- Keep each one to one change. Several small pull requests are reviewed faster than one large one.
- Say what changes for someone using Steward, and why. Add before and after screenshots for
  anything on screen.
- Changes to the gateway, the computer, the connectors' network guard or the server's HTTP guards
  get a second reviewer. Say in the description what could go wrong and how the tests show it does
  not.
- The pull request template has a short checklist. CI runs `pnpm typecheck`, `pnpm lint`,
  `pnpm test` and `pnpm e2e` on Node 24 and 26.

## Licence

Steward is MIT licensed. By contributing, you agree that your contribution is licensed under the
same terms.
