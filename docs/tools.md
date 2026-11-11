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
| `request_secret`   | write | browser | no     | **always asks** (safety floor)                                                      | Opens the secret box for a field from the page's own site. The value goes to the page, never the model or the record.          |

## The computer: files and shell

| Tool         | Kind  | Surface | Taints | By default | What it does                                                                                                                                                                          |
| ------------ | ----- | ------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file_list`  | read  | file    | no     | runs       | Lists the agent's workspace.                                                                                                                                                          |
| `file_read`  | read  | file    | yes    | runs       | Reads a file from the workspace. Paths cannot leave it.                                                                                                                               |
| `file_write` | write | file    | no     | runs       | Writes a file in the workspace.                                                                                                                                                       |
| `shell_run`  | shell | shell   | yes    | **asks**   | Runs one command with `bash -c` in the workspace, with a scrubbed environment, a time limit and an output cap. Destructive commands and `curl \| sh` are refused outright by presets. |

## Mail and calendar

| Tool              | Kind  | Surface  | Taints | By default | What it does                                                                                                   |
| ----------------- | ----- | -------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `mail_list`       | read  | mail     | yes    | runs       | Lists or searches recent mail.                                                                                 |
| `mail_read`       | read  | mail     | yes    | runs       | Reads one email in full.                                                                                       |
| `mail_send`       | send  | mail     | no     | **asks**   | Sends an email or a reply. The approval card shows who it goes to and exactly what it says.                    |
| `calendar_list`   | read  | calendar | yes    | runs       | Lists events between two times.                                                                                |
| `calendar_create` | write | calendar | no     | **asks**   | Adds an event. People on it are added but not emailed. The `steward` package also removes Always allow for it. |
| `brief_today`     | read  | mail     | yes    | runs       | Today's brief: what needs you, what can wait, today's calendar, what could not be checked.                     |
| `triage_inbox`    | read  | mail     | yes    | runs       | Sorts recent mail into needs you and can wait, with a one-line reason each.                                    |

## The web, without the browser

| Tool             | Kind | Surface | Taints | By default | What it does                                                                                                                                                     |
| ---------------- | ---- | ------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search`     | read | web     | yes    | runs       | Searches the web (DuckDuckGo's HTML endpoint, no key needed) and returns titles, links and snippets.                                                             |
| `web_fetch`      | read | web     | yes    | runs       | Fetches a public page as readable text. Private and metadata addresses are refused.                                                                              |
| `directory_find` | read | web     | yes    | runs       | Finds ready-made bots in the bot directory for a job. It only suggests: the person adds a bot themselves. Listing text is written by other people, so it taints. |

## Steward's own state

| Tool              | Kind   | Surface | Taints | By default | What it does                                                                                                                                                                            |
| ----------------- | ------ | ------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_remember` | write  | memory  | no     | runs       | Remembers a fact about the person, shown and removable on `/memory`.                                                                                                                    |
| `task_create`     | write  | task    | no     | runs       | Adds a task to `/tasks`.                                                                                                                                                                |
| `task_update`     | write  | task    | no     | runs       | Changes a task's state or next step.                                                                                                                                                    |
| `routine_create`  | write  | task    | no     | runs       | Sets up a routine on a five-field cron schedule, no more often than every 15 minutes. What the routine later does is governed again, as a routine.                                      |
| `routine_list`    | read   | task    | no     | runs       | Lists the agent's own routines: name, work, schedule in words, on or off, next run.                                                                                                     |
| `routine_update`  | write  | task    | no     | runs       | Changes one of its routines (name, work, schedule, time zone, on or off), named by id and current name. After untrusted content it asks, like `routine_create`.                         |
| `routine_delete`  | delete | task    | no     | asks       | Deletes one of its routines. Its conversation stays.                                                                                                                                    |
| `delegate_task`   | write  | task    | yes    | runs       | Hands a task to another agent (another Steward, a bot, or a coding agent) and returns its answer, wrapped as untrusted. See [delegation](harnesses.md#handing-a-task-to-another-agent). |
| `make_page`       | write  | file    | no     | runs       | Makes something to read, keep or present (notes, a plan, a report) and saves it in the workspace under `made/`. The chat shows a card that opens it.                                    |

## Showing things

Display only: these draw a card in the chat and change nothing.

| Tool              | Kind | Surface | Taints | By default | What it does                                                              |
| ----------------- | ---- | ------- | ------ | ---------- | ------------------------------------------------------------------------- |
| `show_table`      | ui   | ui      | no     | runs       | A table of rows.                                                          |
| `show_chart`      | ui   | ui      | no     | runs       | A bar, line, area or pie chart, with where the figures come from.         |
| `show_comparison` | ui   | ui      | no     | runs       | Two to four options side by side, with pros and cons.                     |
| `show_choices`    | ui   | ui      | no     | runs       | A few clear choices the person can tap.                                   |
| `show_skill`      | ui   | ui      | no     | runs       | A skill Steward wrote, with **Save skill** and **Edit first**. See below. |

### Saving a skill from a conversation

Ask "make me a skill for my weekly review" and Steward drafts one with `show_skill`. The card
shows the whole text. Nothing is saved until you press **Save skill**, or change it with **Edit
first** and save it there; then it is on `/skills` like one you wrote. A saved skill grants no
tools: it is followed only when you type `/name`, and every action it leads to still follows your
rules. When the conversation has read a web page, an email or a file, the card says so above the
button, since that content could have shaped what the skill says.

## Opening what Steward made

Everything in an agent's workspace opens from `/computer` → **Files**, and a page Steward made
opens from its card in the chat with **Open**. Steward never serves a workspace file as a page on
its own address: the file comes to the web app as text, and is drawn the safe way for its kind.

- Markdown is drawn like a reply: raw HTML is dropped, images are not loaded, and links ask first.
- An HTML page is drawn in a sandboxed frame. Its scripts, forms and pop-ups are off, its links
  lead nowhere, and it loads nothing from the web, so a page built from what Steward read cannot
  act or send anything.
- Anything else is shown as plain text. Only text files open, and only their first 1 MB.

## Attaching a file

The paperclip in Chat attaches text files (`.txt`, `.md`, `.csv`, `.json`, `.ics`, `.html`, `.xml`,
`.yaml` or `.log`, up to 2 MB each, five to a message); dropping or pasting a file works too. They
wait above the box, each with **Remove**, and nothing is added until you send. Then each one goes
into the agent's workspace under `uploads/` with a safe name (a number is added when the name is
taken), and the message ends with where: "I attached uploads/plan.md (2.1 KB) to your workspace."

Steward reads it with `file_read`, so what the file says is outside content: it taints the
conversation, and instructions hidden in it cannot send, pay, sign, delete, run a command, or save
a memory or a routine without asking you first. Pictures, PDFs and other files that are not text are refused.

## Tools from connected apps (MCP)

Tools from MCP servers added on `/connections` are named `mcp__<server>__<tool>`, have surface
`mcp`, and are treated as untrusted (they taint). Their kind is what you said the tool does on
`/connections`:

| You marked it  | Kind     | By default | After reading something untrusted | From a routine                  |
| -------------- | -------- | ---------- | --------------------------------- | ------------------------------- |
| Only reads     | `read`   | runs       | runs                              | runs                            |
| Changes things | `write`  | asks       | asks                              | asks                            |
| Sends or posts | `send`   | asks       | **asks, without Always allow**    | refused ("Routines never send") |
| Deletes things | `delete` | asks       | **asks, without Always allow**    | asks                            |

Anything you have not marked is a `write`. Steward never believes a server that says its tool only
reads (`readOnlyHint`), but it does believe one that says its tool can destroy things
(`destructiveHint`), because that only makes it stricter: such a tool is a `delete`, and can be
marked only as deleting or as sending. Every kind but a read gets the check on what leaves.

A tool is offered only once you grant it on `/connections`. An agent whose `tools` in the tenant's
`agents.yaml` is `["*"]` gets every tool you granted; an agent with a list gets only the ones it
names, one by one (`mcp__<server>__<tool>`) or a whole server (`mcp__<server>__*`). So a profile can
narrow what you granted, never add to it. Granting a tool never skips the gateway, and what you
allow goes in the record as **Rules changed**: the tools allowed or stopped, how you marked them,
and which secret settings changed (never their values).

Steward remembers what the tool said it did when you allowed it; if its server changes that later
(its description, its inputs, or whether it can destroy things), Steward stops using it and
`/connections` shows **Changed since you allowed it** until you allow it again.

A server that needs a token gets it from `/connections`: **Secret settings** for a program on this
computer (environment variables such as `GITHUB_PERSONAL_ACCESS_TOKEN`), or an **Access token** for
one at a web address. Steward saves them on this computer, hands them only to that server, and never
shows them again, on the page, in the record or to the model. Put tokens there, never in a
program's arguments or in an address.

What a server writes reaches the model only as the server's words. Each offered description ends by
saying the server wrote it and the descriptions of its inputs, and its errors are quoted and labelled
as its own. Descriptions are cut at 1,000 characters, a server's listing is kept to 200 tools, and a
tool whose inputs take more than 16 KB to describe is listed but not offered.

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
