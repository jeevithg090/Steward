# Tools

Everything Steward does, it does through a tool, and every tool call goes through the gateway. This
page lists the built-in tools, what kind of action each one is, where it acts, whether it brings in
untrusted content, and what happens by default.

The catalogue of names, kinds, surfaces and taint is `TOOLS` in `packages/shared/src/tools.ts`. The
agent (`packages/agent/src/tools`) defines each tool's description and parameters, but it cannot
change a tool's kind: `mail_send` is a `send` whatever anyone says, and the gateway reads the kind
from the catalogue, not from the caller.

## Reading the table

- **Kind** is what the call does to the world: `read`, `write`, `send`, `pay`, `sign`, `delete`,
  `shell` or `ui` (display only). See [governance.md](governance.md#variables).
- **Surface** is where it acts, for rules such as `tool.surface == "calendar"`.
- **Taints** means its results are content Steward does not trust. Once one has returned, the
  conversation is [tainted](governance.md#taint), and from then on every send, payment,
  signature, deletion and shell command asks.
- **By default** is what happens with Steward's presets and no other rules. `steward` and other
  tenant packages can add rules; yours on `/rules` come on top.

## The computer: browser

| Tool               | Kind  | Surface | Taints | By default                                                                          | What it does                                                                                                                   |
| ------------------ | ----- | ------- | ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `browser_navigate` | read  | browser | yes    | runs                                                                                | Opens a web page on the agent's own browser and returns its title and an accessibility snapshot with refs such as `[ref=e12]`. |
| `browser_snapshot` | read  | browser | yes    | runs                                                                                | Looks at the page again. Values in password, code and card fields are hidden.                                                  |
| `browser_click`    | write | browser | yes    | runs, unless [escalated](governance.md#escalation-when-a-click-is-not-just-a-click) | Clicks an element by ref. A button named like Pay, Place order, Sign, Delete or Send becomes that kind first.                  |
| `browser_type`     | write | browser | yes    | runs; asks for password, code and card fields                                       | Types into a field by ref, optionally pressing Enter after.                                                                    |
| `browser_press`    | write | browser | yes    | runs, unless Enter or Space commits something                                       | Presses a key. Enter and Space are judged by the control they would activate; unknown means ask.                               |
| `browser_scroll`   | read  | browser | yes    | runs                                                                                | Scrolls the page.                                                                                                              |
| `browser_back`     | read  | browser | yes    | runs                                                                                | Goes back a page.                                                                                                              |
| `request_help`     | ui    | browser | no     | runs                                                                                | Asks the person to take the wheel (a sign-in, a CAPTCHA, a choice) and waits until they hand it back.                          |
| `request_secret`   | write | browser | no     | **always asks** (safety floor)                                                      | Opens the secret box for one field. The value goes to the page, never to the model or the record.                              |

## The computer: files and shell

| Tool         | Kind  | Surface | Taints | By default | What it does                                                                                                                                                                          |
| ------------ | ----- | ------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file_list`  | read  | file    | no     | runs       | Lists the agent's workspace.                                                                                                                                                          |
| `file_read`  | read  | file    | yes    | runs       | Reads a file from the workspace. Paths cannot leave it.                                                                                                                               |
| `file_write` | write | file    | no     | runs       | Writes a file in the workspace.                                                                                                                                                       |
| `shell_run`  | shell | shell   | yes    | **asks**   | Runs one command with `bash -c` in the workspace, with a scrubbed environment, a time limit and an output cap. Destructive commands and `curl \| sh` are refused outright by presets. |

## Mail and calendar

| Tool              | Kind  | Surface  | Taints | By default | What it does                                                                                |
| ----------------- | ----- | -------- | ------ | ---------- | ------------------------------------------------------------------------------------------- |
| `mail_list`       | read  | mail     | yes    | runs       | Lists or searches recent mail.                                                              |
| `mail_read`       | read  | mail     | yes    | runs       | Reads one email in full.                                                                    |
| `mail_send`       | send  | mail     | no     | **asks**   | Sends an email or a reply. The approval card shows who it goes to and exactly what it says. |
| `calendar_list`   | read  | calendar | yes    | runs       | Lists events between two times.                                                             |
| `calendar_create` | write | calendar | no     | **asks**   | Adds an event. The `steward` package also removes Always allow for it.                      |
| `brief_today`     | read  | mail     | yes    | runs       | Today's brief: what needs you, what can wait, today's calendar, what could not be checked.  |
| `triage_inbox`    | read  | mail     | yes    | runs       | Sorts recent mail into needs you and can wait, with a one-line reason each.                 |

## The web, without the browser

| Tool         | Kind | Surface | Taints | By default | What it does                                                                                         |
| ------------ | ---- | ------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| `web_search` | read | web     | yes    | runs       | Searches the web (DuckDuckGo's HTML endpoint, no key needed) and returns titles, links and snippets. |
| `web_fetch`  | read | web     | yes    | runs       | Fetches a public page as readable text. Private and metadata addresses are refused.                  |

## Steward's own state

| Tool              | Kind  | Surface | Taints | By default | What it does                                                                                                                                         |
| ----------------- | ----- | ------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_remember` | write | memory  | no     | runs       | Remembers a fact about the person, shown and removable on `/memory`.                                                                                 |
| `task_create`     | write | task    | no     | runs       | Adds a task to `/tasks`.                                                                                                                             |
| `task_update`     | write | task    | no     | runs       | Changes a task's state or next step.                                                                                                                 |
| `routine_create`  | write | task    | no     | runs       | Sets up a routine on a five-field cron schedule, no more often than every 15 minutes. What the routine later does is governed again, as a routine.   |
| `make_page`       | write | file    | no     | runs       | Makes something to read, keep or present (notes, a plan, a report) and saves it in the workspace under `made/`. The chat shows a card that opens it. |

## Showing things

Display only: these draw a card in the chat and change nothing.

| Tool              | Kind | Surface | Taints | By default | What it does                                                      |
| ----------------- | ---- | ------- | ------ | ---------- | ----------------------------------------------------------------- |
| `show_table`      | ui   | ui      | no     | runs       | A table of rows.                                                  |
| `show_chart`      | ui   | ui      | no     | runs       | A bar, line, area or pie chart, with where the figures come from. |
| `show_comparison` | ui   | ui      | no     | runs       | Two to four options side by side, with pros and cons.             |
| `show_choices`    | ui   | ui      | no     | runs       | A few clear choices the person can tap.                           |

## Tools from connected apps (MCP)

Tools from MCP servers added on `/connections` are named `mcp__<server>__<tool>`, have surface
`mcp`, and are treated as untrusted (they taint). Their kind is `write` unless you marked the tool
as a read when you added the server; Steward does not trust a server's own claim that a tool only
reads. So by default an MCP tool **asks**, and one you marked as a read runs.

A tool is offered to the agent only once you grant it, on `/connections` or by name in the
tenant's `agents.yaml`. Granting a tool never skips the gateway.

## What "runs" means in a tainted conversation

| Kind                                       | Fresh conversation              | After reading a page, an email, a file or a connected app |
| ------------------------------------------ | ------------------------------- | --------------------------------------------------------- |
| read, ui                                   | runs                            | runs                                                      |
| write on the browser, files, memory, tasks | runs                            | runs                                                      |
| write elsewhere (calendar, connected apps) | asks, with Always allow         | asks, with Always allow                                   |
| send, sign, delete                         | asks, with Always allow         | **asks, without Always allow**, whatever your rules say   |
| pay                                        | always asks, never Always allow | always asks                                               |
| shell                                      | asks, with Always allow         | **asks, without Always allow**, whatever your rules say   |

To check any particular call, use **Would this be allowed?** on `/rules`: pick the tool, write the
arguments, tick whether the conversation has read something, and see the decision and the rule that
made it. Nothing runs and nothing is recorded.
