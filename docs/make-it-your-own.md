# Make it your own

Everything that makes Steward "Steward" lives in one folder, `tenants/steward/`: the name and
colour, the agents and their standing instructions, the skills, a few extra rules, the default
model, the coding agents it may run and its phone shortcuts. Copy the folder, change it, point
Steward at the copy, and it becomes your product. The code underneath stays the same, so you can
keep pulling Steward's fixes.

The repository ships two packages:

- **`tenants/steward/`** is Steward itself: a proactive steward for mail, calendar and errands.
- **`tenants/tempo/`** turns it into **Tempo**, a personal agent that wins back money and time: it
  finds Delay Repay claims for late trains, checks messages and links for scams, and audits bills and
  subscriptions. It never pays and never types bank details, and those two promises are rules, not
  prompts.

Try Tempo now:

```sh
STEWARD_TENANT=tempo STEWARD_DATA_DIR=.steward-data/tempo pnpm dev
```

The data folder keeps Tempo's conversations, memory, settings and rules apart from Steward's. On
the same folder they are shared, and each start swaps the stored package rules for the other
package's.

## Step by step

### 1. Copy a package

```sh
cp -r tenants/steward tenants/acme
```

The folder's name is the tenant's id. Use lower case letters, digits, hyphens and underscores.

### 2. Point Steward at it

In `.env`:

```sh
STEWARD_TENANT=acme
```

Or for one run: `STEWARD_TENANT=acme pnpm dev`. The server prints the tenant it loaded at start-up.

Leave `STEWARD_MODEL_PROVIDER` and `STEWARD_MODEL` out of `.env` if you want your `model.yaml` to
choose the model: values set there beat it, and a choice saved in Settings beats both.
`.env.example` keeps them commented out for that reason.

### 3. Change the files

Each is described below. Every file is optional. A missing one means Steward's built-in defaults,
not the files in `tenants/steward/`: one agent named after the brand, with no instructions, every
built-in tool and no skills; no extra rules; no coding agents or phone shortcuts; and Claude Sonnet
through OpenRouter. A copy of `tenants/steward/` keeps Steward's own instructions, skills and
rules until you change them.

A file that is there but wrong (a typo in a field name, a skill an agent names but nobody wrote, a
rule that does not compile) stops the server at start-up with the file, the line, the field and the
reason. When several fields in a file are wrong, it lists them all. For example:

```text
agents.yaml line 4: agents[0].skills[0]: no skill named "plan-trip" (skills.yaml has: weekly-review, plan-a-trip)
```

A silently ignored typo in a rule is a rule that does not apply, so Steward refuses to start rather
than run without it.

### 4. Restart and check

Restart the server (`pnpm dev` restarts it when server code changes, but not when YAML does). Open
Today: the name, the accent and the starters are yours, and the tab title says your name. Open
Rules: your rules are listed as "From your setup". Open Skills: your skills are listed. Use **Would
this be allowed?** on Rules to check that each rule decides what you meant.

### 5. Keep it apart from the code

Your package is configuration, and it can live in its own repository. Link it in rather than
copying it:

```sh
ln -s ~/code/acme-steward tenants/acme
```

Then updating Steward never touches your package, and your package never touches Steward.

## brand.yaml

How the product presents itself.

```yaml
name: Steward
tagline: Does the work, asks before it acts, keeps a record you can read.
accent: "#0f6e66"
voice: Plain, warm and brief. Says what it did, what it found and what it needs, and stops.
starters:
  - What needs me today?
  - Open news.ycombinator.com and tell me the top story.
```

| Field      | Limits                  | What it does                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | 1 to 60 characters      | The product's name: the rail, the tab title, the welcome, and how the agent introduces itself.                                                                                                                                                                                                                                                                        |
| `tagline`  | up to 200               | The line under the name on the welcome page.                                                                                                                                                                                                                                                                                                                          |
| `accent`   | `#` and six hex digits  | Buttons, links, the current page and the focus ring. Text on it is white, so it needs a contrast ratio of at least 4.5:1 against white (`#0f6e66` is about 6.1:1, Tempo's `#b45309` about 5.0:1); a lighter one stops start-up and says by how much. The app works out a lighter shade for dark mode and a stronger one for more contrast, each checked the same way. |
| `voice`    | up to 1000              | How the agent speaks of itself. It is folded into the system prompt as "Your voice".                                                                                                                                                                                                                                                                                  |
| `starters` | up to 8, each up to 200 | One-tap asks on Today. Write them so they work with the demo inbox and the scripted model, so a first run with no key still shows something real.                                                                                                                                                                                                                     |

## agents.yaml

The agents and their standing instructions. The first agent is the one the app talks to by default.

```yaml
agents:
  - id: steward
    name: Steward
    title: Your steward
    skills: [weekly-review, inbox-zero]
    tools: ["*"]
    instructions: |-
      You look after the small jobs in one person's day so they have time for the large ones...
```

| Field          | Limits                                         | What it does                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | lower case letters, digits, hyphens; up to 41  | Stable id. Conversations, the computer and its files are kept per agent id, so do not rename it once in use.                                                                                                                      |
| `name`         | 1 to 60                                        | What the agent is called.                                                                                                                                                                                                         |
| `title`        | up to 120                                      | A short role: "Your steward", "Your money and time agent".                                                                                                                                                                        |
| `instructions` | up to 20,000                                   | Standing instructions, appended to Steward's base prompt.                                                                                                                                                                         |
| `skills`       | names from skills.yaml                         | The skills this agent is for. Each must exist in `skills.yaml`. For now every agent offers every skill with `/`, so the list does not hide one.                                                                                   |
| `tools`        | `"*"`, built-in names, `mcp__<server>__<tool>` | What it may call. `"*"` grants every built-in tool. Tools from connected apps can also be granted on Connections. See [tools.md](tools.md).                                                                                       |
| `model`        | optional                                       | A model for this agent only, kept whatever Settings says: an id on the package's provider, or `provider/model` (`xai/grok-4.7`) on another provider with that provider's key. See [models.md](models.md#one-agent-another-model). |

### Writing instructions

The base prompt (`packages/agent/src/prompt.ts`) already covers how the agent writes, honesty,
asking before acting, treating what it reads as data, driving the computer, mail, showing things,
memory, tasks and routines. Your instructions add what makes this agent this agent:

- **Its job,** in a sentence or two: what it is for, and what it is not for.
- **Its habits:** what it looks for, what it does first, what a good answer contains.
- **Its judgement:** when to ask a question, how sure to be before saying something, what to do when
  a step finds nothing.
- **Its tone,** if it differs from the brand voice.

Never rely on instructions for anything that must hold. "Never pay" in a prompt is a request a
clever page can argue with; `effect: deny` on `tool.kind == "pay"` is a rule nobody can. Put
promises in `rules.yaml`, and explain them in the instructions so the agent plans around them
instead of running into them. Tempo does both.

Do not tell the agent to ask before sending. The gateway asks, with a card that shows exactly what
will happen; asking in words as well asks twice.

## skills.yaml

Instructions written once and called with `/name` in the composer, such as `/weekly-review`.

```yaml
skills:
  - name: weekly-review
    description: Look back at this week and ahead to the next one, and turn what is still open into a short plan.
    tools:
      - triage_inbox
      - calendar_list
      - make_page
    instructions: |-
      1. Call triage_inbox for the last seven days...
```

| Field          | Limits                                        | What it does                                                                   |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `name`         | lower case letters, digits, hyphens; up to 41 | The command. Unique in the file.                                               |
| `description`  | 1 to 300                                      | Shown in the `/` menu and on Skills. Write it as what someone is trying to do. |
| `instructions` | 1 to 8000                                     | Followed when the skill is called.                                             |
| `tools`        | built-in or `mcp__` names                     | What the skill needs. A declaration, not a grant.                              |

A skill adds no permission. It can only ask the agent to use tools the agent already holds, and
every call it leads to is decided by the gateway like any other. Skill names are unique across the
package and the person's own: while your package has `/weekly-review`, the Skills page will not
make another, and the person can copy yours instead. A skill the person already had under that
name before your package added it stays theirs, and yours is not offered to them.

What makes a skill good:

- **Address the agent, in the imperative,** as numbered steps when order matters.
- **Say what to do when a step finds nothing.** That is the case a weak skill leaves out and the
  case that happens most.
- **Name what the answer contains:** a table with these columns, a verdict first, a saved page.
- **Say what not to claim.** "Never say a claim was made until the confirmation says so."
- **Do not restate the base prompt.** The agent already knows how to write and when to ask.

## rules.yaml

Extra rules, layered on Steward's presets. The full language is in
[governance.md](governance.md#writing-rules).

```yaml
rules:
  - name: Routines never send
    effect: deny
    when: 'initiator.kind == "routine" && tool.kind == "send"'
    description: >-
      A routine runs while you are away. Sending waits until you ask for it in a conversation.
```

| Field         | Limits                       | What it does                                                                                   |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `name`        | 1 to 120, unique             | Shown on Rules, on approval cards and in the record. Rules are matched by name on each start.  |
| `effect`      | `allow`, `ask` or `deny`     | What happens when `when` is true.                                                              |
| `when`        | a CEL expression, up to 2000 | The condition. Put it in single quotes so YAML leaves the double quotes and backslashes alone. |
| `description` | up to 500                    | Why the rule exists. Shown as the reason when it decides.                                      |

On every start, the gateway brings the stored tenant rules in line with the file: new ones are
added, changed ones are updated, and ones you removed from the file are removed. The person can
switch a tenant rule off on Rules, and that choice survives restarts, even when a later version of
your package changes the rule; they cannot edit or delete it there, because the file is where it is
changed.

The file is checked when the server starts, and each of these stops it, naming the file, the line
and the rule:

- a condition that does not compile;
- two rules with the same name, since rules are matched by name;
- an allow rule that would let Steward send, pay, sign, delete or run a command without asking.

```text
rules.yaml line 3: rules[0] "Mail to my boss runs": an allow rule cannot let Steward send, pay, sign, delete or run a command without asking you, and this one would allow mail_send. Use effect: ask or deny for those, or narrow "when", for example with tool.kind == "write"
```

A check at start-up cannot try every recipient or argument, so every allow rule from a package is
also limited to reads and writes. One written as `contains(args.to, "boss@acme.example")` loads, and
still never covers a send. On Rules, that limit shows in front of its condition.

Where each effect sits in the order of checks matters:

- `deny` beats everything, including Always allow and the safety floor.
- `ask` beats every allow rule, and removes Always allow for what it catches.
- `allow` can let a write on the calendar or a connected app run without asking, but it can never
  let anything send, pay, sign, delete or run a command, and never lifts passwords, taint or the
  outbound check.

Test every rule with **Would this be allowed?** on Rules before you rely on it.

## model.yaml

The model the package expects. `STEWARD_MODEL_PROVIDER`, `STEWARD_MODEL` and
`STEWARD_MODEL_BASE_URL` in the environment or `.env` override it, and a choice saved on the
Settings page overrides both.

```yaml
provider: openrouter
model: anthropic/claude-sonnet-5.5
apiKeyEnv: OPENROUTER_API_KEY
```

| Field       | What it does                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`  | `openrouter`, `openai`, `anthropic`, `nvidia`, `gemini`, `xai`, `ollama`, `openai-compatible` or `scripted`.                                                                                                                                            |
| `model`     | The model id at that provider.                                                                                                                                                                                                                          |
| `baseUrl`   | Optional, and only for `ollama` and `openai-compatible`: every other provider has its own address, so its key only ever goes there. It must start with `https://`; plain `http://` is only for this machine or your local network.                      |
| `apiKeyEnv` | Optional. The name of the environment variable that holds the key, never the key itself. It ends in `_KEY`, and it cannot be another provider's key: a package for an `openai-compatible` server names a variable of its own, such as `ACME_MODEL_KEY`. |

See [models.md](models.md).

## harnesses.yaml

The external coding agents the package offers, such as Claude Code, Gemini CLI and Codex. Each one
is the vendor's own tool, started by Steward in the agent's workspace, and every permission it asks
for becomes a Steward approval. `tenants/steward/harnesses.yaml` offers all three; a package without
the file offers none.

```yaml
harnesses:
  - id: claude-code
    name: Claude Code
    title: Anthropic's coding agent, through Zed's ACP adapter
    kind: acp
    command: claude-agent-acp
    signIn: vendor-tool
```

The loader refuses an entry that would switch the tool's own permission checks off, an `env` value
that looks like a key, and an id another agent already uses. Every field is in
[harnesses.md](harnesses.md#adding-one).

## shortcuts.yaml

The package's own phone shortcuts. They appear in the Steward shortcut's menu, as launchers on the
Shortcuts page and, with `share: true`, in the iPhone's share sheet. Each one asks Steward
something, through the gateway like anything typed in the app, so a shortcut adds no permission.

```yaml
shortcuts:
  - id: scam-spotter
    title: Scam Spotter
    description: Share a text or email that looks off. Steward checks it for the signs of a scam.
    siri: "Tempo: Scam Spotter"
    skill: scam-check
    prompt: "Is this message a scam? It reached my phone: {input}"
    share: true
```

| Field         | Limits                                    | What it does                                                                                |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`          | lower case letters, digits, `-`, `_`, `.` | Stable id. Launchers on the phone find the shortcut by it, so do not rename it once in use. |
| `title`       | 1 to 60                                   | The name in the menu and on Shortcuts.                                                      |
| `description` | 1 to 300                                  | What it does, in a sentence.                                                                |
| `siri`        | optional, up to 60                        | The phrase for Siri.                                                                        |
| `skill`       | optional, a name from skills.yaml         | Runs as that skill, as if the person typed `/skill` first. It must exist in `skills.yaml`.  |
| `prompt`      | 1 to 2000                                 | What Steward is asked. `{input}` is where the shared or dictated words go.                  |
| `share`       | optional, `true` or `false`               | Offered from the share sheet.                                                               |
| `scopes`      | optional                                  | What a phone needs to use it. Most need only `chat`, the default.                           |

A package can have up to 20. How phones pair and what a phone may do is in [phone.md](phone.md).

## Tempo, file by file

Tempo is a worked example of turning Steward into something else without touching code.

| File             | What Tempo changes                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand.yaml`     | Name, an amber accent, a brisker voice, and starters that work on the demo inbox: a scam check on its fake "mailbox 98% full" email, a subscription audit, a Delay Repay check on a train booking.                                                                                                                                        |
| `agents.yaml`    | One agent, `tempo`, whose job is compensation owed, money leaking away and scams. Its instructions say to put a number on everything, to read each company's own rules before counting on them, to fill in forms but stop at submit, and why it never pays or types bank details.                                                         |
| `skills.yaml`    | `/delay-repay-claim`, `/scam-check` and `/subscription-audit`, each with the steps, what to show, and what to do when a step finds nothing.                                                                                                                                                                                               |
| `rules.yaml`     | Three deny rules: Tempo never pays (`tool.kind == "pay"`, which also catches buttons named like Pay or Place order); never types into a field named like a sort code, account or card number, whether all at once or one key at a time; and never lets a card number, IBAN or bank account leave in anything it would send, type or save. |
| `model.yaml`     | The same model as Steward. A smaller one would be cheaper, but scam checks reward care.                                                                                                                                                                                                                                                   |
| `shortcuts.yaml` | Delay Spotter and Scam Spotter: share a delay alert or an odd message from the iPhone, and Tempo runs `/delay-repay-claim` or `/scam-check` on it.                                                                                                                                                                                        |

What Tempo does not change: the gateway, the presets, the approval flow, the record, the computer,
the web app. Those are Steward's, and every improvement to them reaches Tempo for free.

## What a package cannot change

Some things are not configuration, on purpose:

- **The gateway's order of checks,** the safety floor (payments and passwords always ask) and taint.
  A package can be stricter than Steward, never looser, and the loader holds it to that: its allow
  rules can never let anything send, pay, sign, delete or run a command without asking.
- **The presets.** The person can switch them off on Rules; a package cannot.
- **Honest labels.** Demo data and the scripted model say so on screen whatever the brand.
- **The product rules:** every tool call through the gateway, fail closed, no secrets in the record,
  and never calling the person by a name they did not give.
