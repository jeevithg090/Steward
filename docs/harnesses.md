# Coding agents (harnesses)

Steward can run external coding agents, such as Claude Code, Gemini CLI or Codex, as agents of its
own. Each one is the vendor's own, unmodified tool. Steward starts it in that agent's workspace,
talks to it over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP) or, for Codex,
over Codex's own app-server protocol, and turns every permission it asks for into a Steward
approval. The chat, the approval card, the record and the
resume sweep work as they do for Steward itself.

## Adding one

The tenant declares its coding agents in `tenants/<id>/harnesses.yaml`:

```yaml
harnesses:
  - id: claude-code # also the agent id; lower case, digits and hyphens
    name: Claude Code
    title: Anthropic's coding agent, through Zed's ACP adapter
    kind: acp # the Agent Client Protocol over stdio
    command: claude-agent-acp # found on PATH, or an absolute path
    args: []
    install: npm install -g @zed-industries/claude-agent-acp@0.23.1 # said when it is missing
    signIn: vendor-tool # the person's own login inside the tool; or api-key
    # passEnv: [GEMINI_API_KEY]  # server variables the tool may see; values stay in .env
    # env: { SOME_SETTING: "1" } # plain settings, never keys
```

Steward's own tenant offers Claude Code (`claude-agent-acp`), Gemini CLI (`gemini --experimental-acp`)
and Codex (`codex app-server`, `kind: codex`). An entry appears in the agent picker only when its
program is installed. Until then it is greyed out, and the reason says what to install: "Claude
Code is not installed here. To add it, run: npm install -g …, then sign in to it." Steward looks
again each time the agent list is read, so a tool installed while Steward runs appears without a
restart.

A program is found on PATH, and then in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` and
`~/.npm-global/bin`, for a server started with a short PATH. It is started by the path where it was
found, with that folder on its PATH. `GET /api/harnesses` lists every entry and whether its
program was found, but not where it is or the profile's `env`.

The loader refuses:

- an argument that switches the tool's own permission checks off, or says what it may do without
  asking: `--dangerously-…`, `bypassPermissions`, `danger-full-access`, `--yolo`, `-y` (also
  among other one-letter flags, as in `-dy`), `--full-auto`, `--auto-approve`, `--auto-edit`,
  `--approval-mode yolo` or `auto_edit`, `-a` or `--ask-for-approval` with `never`, `on-failure`
  or `on-request`, `--permission-mode` with any value, and `--allowedTools`. A `--flag value` pair
  counts the same as `--flag=value`, with or without quotes, and a flag inside one argument
  (`sh -c "gemini --yolo"`) counts too;
- a Codex `-c` override of `approval_policy` or `sandbox_mode`, since Steward sets both itself;
- an `env` value that looks like a key (the key shapes the outbound check knows), and an `env` name
  that holds one (`…_KEY`, `…_TOKEN`, `…_SECRET`, `…_PASSWORD`): name it in `passEnv` instead;
- an id that another agent already uses.

## How it runs

- **One process per conversation,** in `computers/<agent>/workspace`. It stays up while the
  conversation is in use, and stops after 15 minutes with nothing to do. A request waiting on the
  person keeps it up for as long as an approval stays open.
- **Starting has a time limit.** A program that has not opened its session within 30 seconds is
  stopped, and the chat says which command to check: "Gemini CLI did not answer within 30
  seconds. Check that 'gemini --experimental-acp' starts its Agent Client Protocol mode." Stop
  works while it starts, and so does deleting the conversation.
- **Stopping stops everything it started.** The tool runs in a process group of its own. Stop,
  Delete, a retired profile and shutdown end the whole group, so a dev server or test watcher the
  agent started does not outlive it.
- **When it stops, the chat says why,** in the tool's own words: its last line on stderr and the
  exit code, with anything shaped like a key masked ("Codex stopped (exit code 3): you are not
  signed in"). A missing program says it is not installed.
- **The conversation continues.** Steward keeps each conversation's ACP session id in its database
  (`harness_sessions`). When the process stopped, the next message reopens the session with
  `session/load` if the agent supports it. If it does not, the agent starts a new session and the
  chat says so.
- **Its environment** is what a program needs: PATH, LANG, and the real HOME so the tool finds its
  own sign-in. Steward's model keys never reach it unless a profile names one in `passEnv`.
- **Deleting the conversation** stops its process and forgets its session, even while it starts.
- Steward offers the agent no file system or terminal of its own, so the agent uses its own tools,
  and asks before it uses them.

## Permissions become approvals

Every `session/request_permission` becomes a gateway call with `tool.source` set to
`harness:<id>`. The call is always `tainted`: Steward never saw what the agent read.

| ACP tool kind             | Steward kind | Surface  | By default                                       |
| ------------------------- | ------------ | -------- | ------------------------------------------------ |
| `read`, `search`          | `read`       | `file`   | runs                                             |
| `fetch`                   | `read`       | `web`    | runs                                             |
| `edit`, `move`            | `write`      | `file`   | runs inside the workspace, asks outside it       |
| `delete`                  | `delete`     | `file`   | asks                                             |
| `execute`, or any command | `shell`      | `shell`  | **always asks**, and Always allow is not offered |
| `think`                   | `ui`         | `ui`     | runs                                             |
| `other`, `switch_mode`    | `write`      | `system` | asks                                             |

The target comes from structured fields only: `locations` and the input's path fields give
`target.path` (relative to the workspace when inside it), `rawInput.command` gives
`target.command`, and `rawInput.url` gives `target.url`. The tool's title is never read. A call
that carries a command is a `shell` call whatever kind it claims.

- **Every path counts.** Steward reads `file_path`, `path`, `source`, `destination`, `old_path`,
  `new_path`, `from`, `to` and the lists `paths` and `files`. A change asks when any of them is
  outside the workspace, and an `edit`, `move` or `delete` that names no path asks (on the
  `system` surface).
- **A change to several paths** is judged by the folder that holds them all, ending in `/`. A
  project file and `~/.ssh/config` give `/`, so a rule for the project folder does not allow it.
  When they are all in the workspace and one is a key or password file (`.env`, an SSH key), it is
  judged by that file, so the rule that keeps those out of reach still refuses it.
- **Inside or outside is decided by real path,** as the computer's own workspace check is: a link
  inside the workspace that leads out of it counts as outside. A path that starts with `~` is in
  the home folder, never in the workspace.
- **The tools' own settings** (`.claude/`, `.gemini/`, `.codex/`, `.mcp.json`) ask even inside the
  workspace, since a change there could let the tool stop asking. So does a change through a link
  that leads to them.

Rules can name a coding agent by its source:

```text
tool.source == "harness:claude-code" && startsWith(target.path, "/Users/me/projects/app/")
```

A change outside the workspace asks by default. A rule like this one lets the agent work on a
project folder without asking.

The answer goes back by the option's kind, never by its label:

| The person, or the gateway                      | Answer to the harness |
| ----------------------------------------------- | --------------------- |
| allowed by a rule, or **Allow once**            | `allow_once`          |
| **Always allow** (only where Steward offers it) | `allow_once`          |
| refused, by a rule or the person                | `reject_once`         |
| the run is stopped, or the person moved on      | `cancelled`           |

Always allow is a Steward rule, never a mode of the tool. Steward never answers `allow_always`,
so the tool asks again next time, and the rule answers it at once. Every call still reaches the
gateway and the record.

The approval card says what the agent wants in plain words, from the same structured fields:
"Run a command: npm test", "Change /Users/me/.ssh/config, outside its own folder", "Change 3
files: src/a.ts, src/b.ts and 1 other".

A request the person must answer ends the run with the approval card, while the harness's own
request stays open. The resume run answers it and the same turn carries on. This happens from the
browser, or from the server's resume sweep when the answer came from Tasks or a notification. A new
message while a request waits counts as moving on: the request is cancelled and the new message
starts a new turn.

## Codex

Codex runs as `codex app-server --listen stdio://` (`kind: codex`). The client is ported and trimmed
from Happy's (MIT), because the ACP adapter lags the app-server and `@openai/codex-sdk` has no
approvals.

- Every thread starts or resumes with `approvalPolicy: "untrusted"` and
  `sandbox: "workspace-write"`, and every turn repeats them. The loader refuses `-c` overrides of
  `approval_policy` or `sandbox_mode`.
- The thread id is the resume handle: the next process calls `thread/resume`.
- `item/commandExecution/requestApproval` is a `shell` call with `target.command`.
  `item/fileChange/requestApproval` is one approval listing every changed file: a `write`, or a
  `delete` when it deletes or moves any file. It is on the `system` surface when a file is outside
  the workspace, is one of the tools' own settings, or none is named, and when the request asks to
  widen the sandbox (`grantRoot`). The card then says so: "It also asks to change anything in
  /Users/me for the rest of this session". `mcpServer/elicitation/request` is an `mcp` call on its
  server and tool. A coding agent's calls are always tainted, so one of these always asks, and
  no rule or Always allow lifts it (`default:taint-leaves`).
- The answers are `accept`, `decline`, and `cancel` when the run stops. Always allow answers
  `accept`, never `acceptForSession`, so Codex keeps asking. Requests Steward does not answer
  (wider network or file grants, user input) get a JSON-RPC error, never an empty result.
- Stop sends `turn/interrupt`. If the turn has not ended within three seconds, the app-server is
  restarted, and the next message resumes the thread.
- Token usage comes from `thread/tokenUsage/updated`. Each update's last call is added up for the
  run and shown in the record under `harness:codex` and the thread's model.

The tests replay a transcript reconstructed from the protocol
(`packages/harnesses/test/fixtures/codex-app-server.transcript.json`); it was not recorded from a
live Codex. A live check runs only with Codex installed and `STEWARD_LIVE_CODEX=1`, because
starting Codex uses your own sign-in.

## Handing a task to another agent

Any agent with the `delegate_task` tool can hand a task to another agent: another Steward on a
different model, a bot, or a coding agent. The tool is offered only when there is another agent
that can answer now, and it lists them by id.

- **Governed like any call.** `delegate_task` is a `write` on the `task` surface, so it runs by
  default. A rule can make it ask (`tool.name == "delegate_task"`) or refuse it. Its card reads
  "Hand 'run the tests' to codex".
- **A conversation of its own.** The task runs on the target agent in a separate conversation,
  through the same runner as a routine, with the parent's initiator: a routine's hand-off still
  follows routine rules. Child conversations are not in the conversation list. Deleting the
  parent deletes them.
- **In the parent's chat.** The child's work arrives in the parent's stream tagged with its
  `subagentRunId`, between `SUBAGENT_STARTED` and `SUBAGENT_FINISHED` (or `SUBAGENT_ERROR`). The
  chat folds it under "Codex is working on: run the tests". The parent's own model never sees the
  child's messages, only the tool result.
- **The answer.** It comes back as "Codex finished working. Its answer follows, verbatim.", with
  the answer wrapped as untrusted, or "… stopped without answering. It failed with, verbatim.".
  The wording is Happy's. A handed-on answer taints the parent's conversation, because the child
  may have read pages or mail. A task handed on from a tainted conversation starts with the
  hand-off frame (`HANDOFF_FRAME` in `packages/shared/src/frames.ts`), so the child, a coding agent
  included, reads it as a task it did not get from the person, and its own conversation is tainted
  for good. A hand-off from a clean conversation is unchanged.
- **Questions.** An approval the child needs ends the parent's run too, with the child's interrupt
  (`interrupts[].subagentRunId` set). The card says who asks. Answering it resumes the parent,
  which resumes the child and carries on with its answer. The same happens when the answer comes
  from Tasks and the resume sweep picks it up.
- **Limits.** A task can be handed on once (depth 1, `STEWARD_DELEGATION_DEPTH`): a child is not
  offered `delegate_task`. A depth of 0 turns hand-offs off, and `delegate_task` is never offered.
  At most two of one run's tasks run at once (`STEWARD_DELEGATION_CONCURRENCY`, 1 to 10). A coding
  agent takes one task at a time, since it works in one folder: "Codex is already working on
  another task in its folder. Wait for it to finish."
- **Stop stops the children too.** A child that has not stopped within 15 seconds is left behind:
  the task is marked stopped, the record says the agent did not stop in time, and the parent ends.
  When the child ends later, nothing changes.
- **When a task ends** (done, failed or stopped), its coding agent's process stops, since the
  child's conversation is never used again. A task waiting on a question keeps its process. Only a
  task that is waiting can be resumed; one that ended says "That handed-on task already ended."
- **The record** has `delegation.started` and `delegation.finished` entries on the parent, and the
  child's own runs and decisions under its conversation. Every start has an end: a task that could
  not start is recorded as finished with its error, and a task still running when Steward stopped
  is marked stopped, and recorded, when it starts again.

## What Steward cannot see

Every harness runs its read-only tools without asking (reading and searching files in its
workspace, for example). Steward shows them in the chat but cannot refuse them. Keep nothing in the
workspace the agent should not read.

## Your own sign-in

`signIn: vendor-tool` means the tool uses the login you gave it yourself. Steward never reads a
credential file, never sets a token and never calls a vendor's API with your login. Whether your
plan allows a tool's login to be used this way is the vendor's call. Read their current terms
first; Steward has not verified them (UNVERIFIED, see
[the orchestration plan](plans/orchestration.md#42-using-the-sign-in-you-already-have)).

## Usage

ACP agents do not report token counts, so their runs show "No token count was reported." in the
record. Codex reports them, and they appear per model under `harness:codex`. Steward does not
estimate tokens, and never puts a price on a run that a subscription pays for.
