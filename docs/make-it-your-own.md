# Make it your own

Everything that makes Steward "Steward" lives in one folder, `tenants/steward/`: the name and
colour, the agent and its standing instructions, the skills, a few extra rules, and the default
model. Copy the folder, change it, point Steward at the copy, and it becomes your product. The code
underneath stays the same, so you can keep pulling Steward's fixes.

The repository ships two packages:

- **`tenants/steward/`** is Steward itself: a proactive steward for mail, calendar and errands.
- **`tenants/tempo/`** turns it into **Tempo**, a personal agent that wins back money and time: it
  finds Delay Repay claims for late trains, checks messages and links for scams, and audits bills and
  subscriptions. It never pays and never types bank details, and those two promises are rules, not
  prompts.

Try Tempo now:

```sh
STEWARD_TENANT=tempo pnpm dev
```

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

### 3. Change the files

Each is described below. Every file is optional: a missing one falls back to Steward's defaults. A
file that is there but wrong (a typo in a field name, a skill an agent names but nobody wrote, a rule
that does not compile) stops the server at start-up with the file, the field and the reason, for
example:

```text
agents.yaml: agents[0].skills[2]: no skill named "plan-trip" (skills.yaml has: weekly-review, plan-a-trip)
```

A silently ignored typo in a rule is a rule that does not apply, so Steward refuses to start rather
than run without it.

### 4. Restart and check

Restart the server (`pnpm dev` restarts it when server code changes, but not when YAML does). Open
Today: the name, the accent and the starters are yours. Open Rules: your rules are listed as "From
your setup". Open Skills: your skills are listed. Use **Would this be allowed?** on Rules to check
that each rule decides what you meant.

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

| Field      | Limits                  | What it does                                                                                                                                                                                                            |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | 1 to 60 characters      | The product's name: the rail, the tab title, the welcome, and how the agent introduces itself.                                                                                                                          |
| `tagline`  | up to 200               | The line under the name on the welcome page.                                                                                                                                                                            |
| `accent`   | a CSS colour            | Buttons, links, the focus ring. Text on it is white, so pick a colour with a contrast ratio of at least 4.5:1 against white (`#0f6e66` is about 6.1:1, Tempo's `#b45309` about 5.0:1). Check with any contrast checker. |
| `voice`    | up to 1000              | How the agent speaks of itself. It is folded into the system prompt as "Your voice".                                                                                                                                    |
| `starters` | up to 8, each up to 200 | One-tap asks on Today. Write them so they work with the demo inbox and the scripted model, so a first run with no key still shows something real.                                                                       |

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

| Field          | Limits                                         | What it does                                                                                                                                |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | lower case letters, digits, hyphens; up to 41  | Stable id. Conversations, the computer and its files are kept per agent id, so do not rename it once in use.                                |
| `name`         | 1 to 60                                        | What the agent is called.                                                                                                                   |
| `title`        | up to 120                                      | A short role: "Your steward", "Your money and time agent".                                                                                  |
| `instructions` | up to 20,000                                   | Standing instructions, appended to Steward's base prompt.                                                                                   |
| `skills`       | names from skills.yaml                         | The skills this agent offers with `/`. Each must exist in `skills.yaml`.                                                                    |
| `tools`        | `"*"`, built-in names, `mcp__<server>__<tool>` | What it may call. `"*"` grants every built-in tool. Tools from connected apps can also be granted on Connections. See [tools.md](tools.md). |
| `model`        | optional                                       | A model id for this agent only, on the same provider.                                                                                       |

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
every call it leads to is decided by the gateway like any other. A skill the person writes on the
Skills page with the same name as yours takes its place for them.

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
added, changed ones are updated, and ones you removed from the file are removed. A rule that does
not compile stops the server, naming the rule. The person can switch a tenant rule off on Rules, and
that choice survives restarts, but they cannot edit or delete it there; the file is where it is
changed.

Where each effect sits in the order of checks matters:

- `deny` beats everything, including Always allow and the safety floor.
- `ask` beats every allow rule, and removes Always allow for what it catches.
- `allow` can let a write on the calendar or a connected app run without asking, but it can never
  lift payments, passwords, taint or the outbound check.

Test every rule with **Would this be allowed?** on Rules before you rely on it.

## model.yaml

The model the package expects. Environment variables and the Settings page override it.

```yaml
provider: openrouter
model: anthropic/claude-sonnet-5.5
apiKeyEnv: OPENROUTER_API_KEY
```

| Field       | What it does                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `provider`  | `openrouter`, `openai`, `anthropic`, `nvidia`, `gemini`, `ollama`, `openai-compatible` or `scripted`. |
| `model`     | The model id at that provider.                                                                        |
| `baseUrl`   | Optional. Another endpoint.                                                                           |
| `apiKeyEnv` | Optional. The name of the environment variable that holds the key, never the key itself.              |

See [models.md](models.md).

## Tempo, file by file

Tempo is a worked example of turning Steward into something else without touching code.

| File          | What Tempo changes                                                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand.yaml`  | Name, an amber accent, a brisker voice, and starters that work on the demo inbox: a scam check on its fake "mailbox 98% full" email, a subscription audit, a Delay Repay check on a train booking.                                                                                              |
| `agents.yaml` | One agent, `tempo`, whose job is compensation owed, money leaking away and scams. Its instructions say to put a number on everything, to read each company's own rules before counting on them, to fill in forms but stop at submit, and why it never pays or types bank details.               |
| `skills.yaml` | `/delay-repay-claim`, `/scam-check` and `/subscription-audit`, each with the steps, what to show, and what to do when a step finds nothing.                                                                                                                                                     |
| `rules.yaml`  | Three deny rules: Tempo never pays (`tool.kind == "pay"`, which also catches buttons named like Pay or Place order); never types into a field named like a sort code, account or card number; and never lets a card number, IBAN or bank account leave in anything it would send, type or save. |
| `model.yaml`  | The same model as Steward. A smaller one would be cheaper, but scam checks reward care.                                                                                                                                                                                                         |

What Tempo does not change: the gateway, the presets, the approval flow, the record, the computer,
the web app. Those are Steward's, and every improvement to them reaches Tempo for free.

## What a package cannot change

Some things are not configuration, on purpose:

- **The gateway's order of checks,** the safety floor (payments and passwords always ask) and taint.
  A package can be stricter than Steward, never looser.
- **The presets.** The person can switch them off on Rules; a package cannot.
- **Honest labels.** Demo data and the scripted model say so on screen whatever the brand.
- **The product rules:** every tool call through the gateway, fail closed, no secrets in the record,
  and never calling the person by a name they did not give.
