# @steward/gateway

The one door every Steward tool call goes through. It decides, writes the decision to the record,
and only then lets the call act. If it cannot decide, or cannot write the record, nothing acts.

```
call ─► prepare (catalogue kind, escalation, target) ─► decide (CEL rules, floor, taint, outbound check)
     ─► record tool.decided ─► allow: act ─► record tool.completed / tool.failed
                             ─► deny:  refuse, with a sentence the model relays
                             ─► ask:   open an approval, park the run ─► person answers ─► resume (claimed once) ─► act
```

## What it guarantees

- **Nothing acts unrecorded.** `tool.decided` is written before any action. A failure to write it
  refuses the call.
- **Fail closed.** An unknown tool is a write. A rule that cannot be evaluated refuses the call and
  names itself. Any internal error refuses. A tenant rule that does not compile stops the server at
  start.
- **Payments and secrets always ask.** Kind `pay`, `request_secret` and typing into a password, PIN,
  card or code field ask every time. No rule can lift that, and "Always allow" is never offered.
- **Taint.** Once a conversation has read the web, mail or MCP output, anything that sends, pays,
  signs, deletes or runs a command asks, whatever the rules say, without "Always allow".
- **What leaves is checked.** Card numbers, IBANs, national ids, keys, passwords, bank details and
  health words in outgoing text make the call ask, with masked findings on the card.
- **An answer acts once.** A resume claims the approval atomically; a second resume, a resume from a
  different conversation, or a resume with different arguments (checked by digest) is refused.
- **The record is tamper-evident.** Append-only at the database (triggers refuse UPDATE and DELETE),
  hash-chained row to row, and `verify()` names the first row that no longer matches.
- **Secrets stay out.** Arguments are redacted by key name before any rule, approval or record sees
  them; the record also masks card numbers, keys and the like inside text and keeps only a
  200-character preview of anything long.

## Use

```ts
import { createGateway, gateCallFor } from "@steward/gateway";

const gateway = createGateway({
  db,
  bus,
  tenantRules: tenant.rules,
  expiryHours: () => settings.approvalExpiryHours,
});

const outcome = await gateway.governance.execute(call, () => computer.click(ref));
// outcome.status is one of:
//   "done"     → outcome.result
//   "failed"   → outcome.error
//   "refused"  → give outcome.message to the model as the tool result
//   "parked"   → end the run with an interrupt keyed by call.toolCallId; outcome.approval is the card

// POST /api/approvals/:id/decision
gateway.approvals.decide(approvalId, "once", actorId, note); // or "always", "refuse"

// the resume run (browser or server sweep), with the same tool call from the transcript
const resumed = await gateway.governance.resume(call, () => computer.click(ref));

// "would this be allowed?" (POST /api/rules/dry-run)
gateway.governance.dryRun(gateCallFor({ tool, args, tainted, initiator })); // → Decision, writes nothing
```

`createGateway` applies `migrations` itself (it is idempotent), so the server may also pass them to
`db.migrate` with everyone else's. The returned stores are the concrete classes, which add:
`approvals.waitFor(id, { signal, timeoutMs })`, `approvals.cancel(id, actorId, reason)`,
`approvals.claim(toolCallId)`, `audit.forToolCall(toolCallId)`, `rules.current()`.

Store errors are `GatewayError` with `code` `invalid` (400), `not_found` (404) or `conflict` (409),
and a message meant for the person.

## Precedence

The first step that matches decides.

| #   | Step                                                                                                               | Result             | "Always allow" offered                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| 1   | Deny rules                                                                                                         | deny               | no                                                                                  |
| 2   | Safety floor: kind `pay`; `request_secret`; `browser_type` into a password, PIN, code, card, IBAN or account field | ask                | no                                                                                  |
| 3   | Taint: `tainted` and kind is `send`, `pay`, `sign`, `delete` or `shell`                                            | ask                | no                                                                                  |
| 4   | Outbound check: any finding                                                                                        | ask, with findings | no                                                                                  |
| 5   | Ask rules                                                                                                          | ask                | no (an ask rule outranks every allow rule, so a standing allow could never lift it) |
| 6   | Allow rules: presets, tenant, person, always (in that order, oldest first)                                         | allow              | —                                                                                   |
| 7   | Defaults by kind (below)                                                                                           | allow or ask       | yes, when it asks                                                                   |

Defaults: `read` and `ui` run. `write` runs on Steward's own surfaces (`browser`, `file`, `memory`,
`task`) and asks anywhere else (`calendar`, `mail`, `mcp`, …). `send`, `sign`, `delete` and `shell` ask.
An unknown kind is a `write`.

Every `Decision` has a plain-language `reason` and a `rule`. Built-in steps name themselves with
ids starting `default:` (`default:floor-pay`, `default:floor-credential`, `default:taint`,
`default:outbound-check`, `default:read-runs`, `default:ui-runs`, `default:write-runs`,
`default:write-asks`, `default:send-asks`, `default:sign-asks`, `default:delete-asks`,
`default:shell-asks`, `default:error`, `default:answer-check`) and carry `source: "preset"`. A
resumed call is decided by the person's answer: `default:answer-once` or `default:answer-refused`
with `source: "person"`, or the standing rule an "Always allow" wrote.

A refusal reads: `Refused by the rule '<name>': <reason>. Tell the person; do not try another way around it.`

### Escalation

A browser action that commits something is judged by the element it touches (from the computer's
own snapshot, never the model's words): `browser_click`, `browser_press` of Enter, and
`browser_type` with `submit: true`. The first match wins:

| Kind   | Element names like                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| pay    | pay, payment, buy, purchase, checkout, place order, complete order, confirm payment, subscribe, donate, transfer, send money |
| sign   | sign, sign here, agree and sign, e-sign (not sign in, sign up, sign out)                                                     |
| delete | delete, remove, trash, erase, deactivate, unsubscribe, cancel subscription, close account                                    |
| send   | send, submit, post, reply, reply all, publish                                                                                |

The list lives in `ESCALATIONS` (`src/escalate.ts`).

## Rules

Rules are [CEL](https://github.com/google/cel-spec) expressions evaluated with
[cel-js](https://github.com/ChromeGG/cel-js) 0.8.2. They are compiled once and cached, and checked
when saved: a typo, an unknown name or field, an unknown function, or an answer that is not
true/false is refused with a readable reason.

### Variables

Every variable is always present. A field that does not apply is empty (`""`, `[]`, `0`), so
`target.host == "x"` is simply false for a shell command.

| Variable                                                                           | Example                                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `tool.name`, `tool.kind`, `tool.surface`, `tool.source`                            | `tool.kind == "send"`, `tool.source == "mcp:github"`     |
| `target.url`, `target.host` (lower case, no port), `target.path`, `target.command` | `target.host == "shop.example.com"`                      |
| `target.recipients` (lower-case addresses)                                         | `"boss@example.com" in target.recipients`                |
| `target.amount.value` (minor units), `target.amount.currency`                      | `target.amount.value > 5000`                             |
| `target.element.ref`, `.role`, `.name`                                             | `target.element.name == "Send"`                          |
| `target.mcp.server`, `target.mcp.tool`                                             | `target.mcp.server == "notion"`                          |
| `args` (redacted arguments)                                                        | `has(args.subject) && contains(args.subject, "invoice")` |
| `intent` (the model's reason, may be empty)                                        | `contains(intent, "refund")`                             |
| `tainted`                                                                          | `tainted && tool.surface == "mail"`                      |
| `initiator.kind` (`person`, `routine`, `task`, `resume`, `system`), `initiator.id` | `initiator.kind == "routine"`                            |
| `agent.id`, `actor.id`                                                             | `agent.id == "steward"`                                  |
| `findings` (finding kinds)                                                         | `"health" in findings`                                   |

A missing `args` key is absent, not an error: `args.to == "x"` is false and `has(args.to)` is false
when there is no `to`. Secret-named arguments read as `"[redacted]"`.

### Functions

`contains(text, part)`, `matches(text, regex)`, `startsWith(text, prefix)`, `endsWith(text, suffix)`
and `lower(text)`. All ignore case; given a list they test each item (`contains` on a list checks
membership). Plus CEL's `size(x)`, `has(x.y)`, `in`, and the list macros `all`, `exists`,
`exists_one`, `filter`, `map`. String methods (`x.startsWith(...)`) are not supported; use the
functions.

Strings take the usual escapes (`\"`, `\\`, `\n`, `\t`, `\uXXXX`); any other backslash is kept, so
a regex reads the same written as `"\bsudo\b"` or `"\\bsudo\\b"`.

### Presets

Shipped with source `preset`, switched on. They can be switched off on `/rules`, not edited or
deleted.

| Name                                 | Effect | When                                                                                                                                                                    |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Never touch cloud metadata           | deny   | `target.host` is 169.254.169.254, metadata.google.internal, and the other cloud metadata addresses                                                                      |
| Never run destructive shell commands | deny   | shell commands with `rm -r` on `/`, `~` or `$HOME`, `--no-preserve-root`, `mkfs`, `dd if=`, fork bombs, `shutdown`/`reboot`/`halt`, `sudo`/`doas`, writes to `/dev/sd*` |
| Never pipe a download into a shell   | deny   | `curl … \| sh`, `wget … \| bash`                                                                                                                                        |
| Never touch key and password files   | deny   | file tools on `.env`, `id_rsa`, `*.pem`, `credentials.json`, `.ssh/`, `.aws/`, `.gnupg/` (not `.env.example`)                                                           |
| Routines ask before they send        | ask    | `initiator.kind == "routine"` and kind `send`, `sign` or `delete`                                                                                                       |
| Routines ask before running commands | ask    | `initiator.kind == "routine"` and kind `shell`                                                                                                                          |
| Reads run freely                     | allow  | `tool.kind == "read"`                                                                                                                                                   |

Tenant rules (`tenants/<id>/rules.yaml`) are stored with source `tenant`, upserted by name on start
and removed when the package drops them. They too can be switched off but not edited here.

## The outbound check

What is scanned:

- `GateCall.outbound`, always, for everything below.
- Every string argument (nested too) when the call sends, pays or signs, or writes through MCP;
  plus any argument whose name is a credential (`apiKey`, `password`, …), whatever its value.
- The text of `browser_type`, for values but not health words (a health search is not a leak).
- `target.url`, for keys and passwords only (long numeric ids in URLs would look like cards).

| Finding        | Detected by                                                                                                                           | Hint                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `card_number`  | 13–19 digits, optional consistent spaces or dashes, Luhn, major network prefix                                                        | `•••• 4242`                            |
| `iban`         | country code, the country's exact length, mod-97                                                                                      | `GB•• •••• 5432`                       |
| `national_id`  | UK National Insurance (valid prefixes), US SSN with separators, NHS number next to "NHS" (mod-11)                                     | `••••6C`, `•••-••-••89`                |
| `api_key`      | `sk-…`, `sk_live_…`, `ghp_…`, `github_pat_…`, `xox?-…`, `AKIA…`, `AIza…`, JWTs, private key blocks, Bearer/Basic headers, `api_key=…` | `ghp_••••`                             |
| `password`     | `password: x`, `my password is x`, `PIN: 1234` (not "password is required")                                                           | `password: ••••`                       |
| `bank_account` | a UK sort code and an 8-digit account number within 80 characters, near "sort", "account" or "bank"                                   | `sort code ••-••-56, account ••••5678` |
| `health`       | a short whole-word list: diagnosis, prescription, medication, cancer, pregnancy, depression, therapist, biopsy, …                     | `mentions "diagnosis"`                 |

Findings never carry the value. Each detector has false positives, which is why a finding asks and
never refuses. Text over 2,000,000 characters is not scanned; the call is refused instead.

## Approvals

`pending → allowed | refused | expired | cancelled`, answered once.

- The action digest is sha256 of the canonical tool name and arguments. A resume must match it.
- `decide(id, "always", …)` writes a standing allow rule in the same transaction, scoped as narrowly
  as the call allows: the tool name, plus the host, the MCP server, the element name for browser
  actions, the exact command for shell, and the recipients for mail (every recipient must be one of
  those approved). It is refused when `canAlways` is false.
- Answering the same way twice returns the approval unchanged; answering differently, or after it
  expired, is a `conflict`.
- Pending approvals expire after `expiryHours` (default 24). `expireDue()` sweeps; `list()`,
  `decide()` and `resume()` also expire what is due.
- A resume that finds the approval still pending cancels it ("the person moved on") so it can never
  act later.
- Every summary is one plain sentence: "Send an email to sam@example.com: 'Re: Friday'", "Run a
  command: ls -la", "Click 'Place order' on shop.example.com".

Live events on the bus: `approval.created`, `approval.decided` (answered, expired or cancelled),
`audit.appended`.

## The record

Table `gateway_audit`. Each row: `seq` (from 1, no gaps), `prevHash`, and
`hash = sha256(prevHash + canonical JSON of the row without hash)`, where canonical JSON sorts keys
at every level. Triggers refuse UPDATE and DELETE. `verify()` walks the chain in pages and returns
`{ ok, count, brokenAt }`; it finds edited, rehashed and deleted rows. It cannot see rows cut from
the end; keep a copy of the latest hash elsewhere if that matters to you.

Redaction before hashing: values under keys such as password, secret, token, key, authorization,
cookie, otp, pin, cvv (in any spelling: `apiKey`, `x-auth-token`) become `[redacted]`; the text
typed into a password field and a secret tool's `value` are hidden; card numbers, IBANs, keys and
the like inside strings are masked; strings are cut to 200 characters; query values with secret
names are dropped from URLs.

`page({ before, limit, type, effect, q })`: newest first. `type` takes one type, a comma list or a
prefix (`approval.*`). `effect` is `allow`, `ask`, `deny` (matched on `tool.decided` rows) or
`failed`. `q` searches tool names, hosts, commands, summaries and rule names.

## Arguments the gateway reads

For summaries and targets the gateway reads these argument names when present: `to`, `cc`, `bcc`,
`recipients`, `attendees` (strings, `Name <addr>` or `{ email }`), `subject`, `title`, `start`,
`url`, `path`/`dir`, `command`, `text`, `submit`, `key`, `query`, `label`, `amount`
(`{ value, currency }` or a number with `currency`). The target the agent resolves always wins.

## Tests

```
pnpm vitest run packages/gateway/test
pnpm --filter @steward/gateway typecheck
```

Ported in part from [CopilotKit/openbot](https://github.com/CopilotKit/openbot) (MIT): the CEL
helpers and fail-closed rules, the approval semantics, audit redaction by key, and the credential
patterns of the outbound check. See the root `NOTICE`.
