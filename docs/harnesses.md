# Coding agents (harnesses)

Steward can run external coding agents, such as Claude Code or Gemini CLI, as agents of its own.
Each one is the vendor's own, unmodified tool. Steward starts it in that agent's workspace, talks
to it over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP), and turns every
permission it asks for into a Steward approval. The chat, the approval card, the record and the
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
    signIn: vendor-tool # the person's own login inside the tool; or api-key
    # passEnv: [GEMINI_API_KEY]  # server variables the tool may see; values stay in .env
    # env: { SOME_SETTING: "1" } # plain settings, never keys
```

Steward's own tenant offers Claude Code (`npm install -g @zed-industries/claude-agent-acp@0.23.1`)
and Gemini CLI (`gemini --experimental-acp`). An entry appears in the agent picker only when its
program is installed. Until then it is greyed out, and the reason says what to install.
`GET /api/harnesses` lists every entry and whether its program was found.

The loader refuses a profile that would switch the tool's own permission checks off
(`--dangerously-skip-permissions`, `bypassPermissions`, `danger-full-access`, `--yolo` and the like),
an `env` value that looks like a key, and an id that another agent already uses.

## How it runs

- **One process per conversation,** in `computers/<agent>/workspace`. It stays up while the
  conversation is in use, and stops after 15 minutes with nothing to do. A request waiting on the
  person keeps it up for as long as an approval stays open.
- **The conversation continues.** Steward keeps each conversation's ACP session id in its database
  (`harness_sessions`). When the process stopped, the next message reopens the session with
  `session/load` if the agent supports it. If it does not, the agent starts a new session and the
  chat says so.
- **Its environment** is what a program needs: PATH, LANG, and the real HOME so the tool finds its
  own sign-in. Steward's model keys never reach it unless a profile names one in `passEnv`.
- **Deleting the conversation** stops its process and forgets its session.
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

Rules can name a coding agent by its source:

```text
tool.source == "harness:claude-code" && startsWith(target.path, "/Users/me/projects/app/")
```

A change outside the workspace asks by default. A rule like this one lets the agent work on a
project folder without asking.

The answer goes back by the option's kind, never by its label:

| The person, or the gateway                      | Answer to the harness                                |
| ----------------------------------------------- | ---------------------------------------------------- |
| allowed by a rule, or **Allow once**            | `allow_once`                                         |
| **Always allow** (only where Steward offers it) | `allow_always`, or `allow_once` if it is not offered |
| refused, by a rule or the person                | `reject_once`                                        |
| the run is stopped, or the person moved on      | `cancelled`                                          |

A request the person must answer ends the run with the approval card, while the harness's own
request stays open. The resume run answers it and the same turn carries on. This happens from the
browser, or from the server's resume sweep when the answer came from Tasks or a notification. A new
message while a request waits counts as moving on: the request is cancelled and the new message
starts a new turn.

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
record. Steward does not estimate them.
