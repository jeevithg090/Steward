# @steward/proactive

The part of Steward that works before you ask: it sorts your mail, writes the morning brief,
suggests what it could take off your plate, runs your routines, and keeps your tasks, skills,
memory and notifications. Everything lives in the one SQLite file Steward already uses.

Nothing in here acts on the world. It reads mail and calendar through the `MailCalendar` connector,
asks a `TextModel` for short structured answers, and writes its own tables. Anything that sends,
pays, signs or deletes happens in the agent, through the gateway.

## Wiring

```ts
import { createProactive, migrations } from "@steward/proactive";

const proactive = createProactive({
  db, // @steward/db; this package's migrations are applied here
  bus, // optional EventBus; events listed below
  mail: () => currentMailCalendar, // read on every use, so mail can be connected while running
  model: () => currentTextModel, // without one, triage and the summary fall back to rules
  timezone: () => settings.timezone, // the person's IANA zone: "today" and the calendar day use it
  tenantSkills: tenant.skills, // seeded on start, read only
  approvals: gateway.approvals, // optional, recommended: see "Tasks" below
});

proactive.tasks;
proactive.memory;
proactive.skills;
proactive.routines;
proactive.triage;
proactive.brief;
proactive.notifications;
```

`migrations` is exported too (ids start with `proactive.`), for a server that migrates every
package up front. Applying them twice is harmless.

Every refusal is a `ProactiveError` with a sentence a person can act on, a `code`
(`invalid`, `not_found`, `conflict`, `limit`, `read_only`) and the HTTP `status` to answer with.

## What it keeps, and the rules it keeps to

### Tasks

Needs you · Suggested · Working · Ready for review · Needs input · Resolved · Failed · Hidden.

- **One derived rule.** The stored state is what was last set. A task linked to an approval that is
  still **pending** reads as `needs_you` in `list`, `get`, `byThread` and `counts`, whatever was
  stored, because the work cannot move until you answer. Once the approval is decided, the stored
  state shows again. Deriving it on read means an expired or answered approval can never leave a task
  stuck on "needs you". Hidden tasks stay hidden.
- **Links come from the bus.** When the gateway emits `approval.created` in a task's conversation,
  the task is linked to it and `task.updated` fires; `approval.decided` fires it again. Pass
  `approvals` (the gateway's store) so the rule holds across restarts; without it the store goes by
  what the bus told it since start.
- `list()` leaves hidden tasks out unless the filter asks for them. Newest change first.

### Routines

Standing instructions on a five-field cron, each with its own conversation (`threadId`).

- Refuses anything that could fire more often than **every 15 minutes**. The check scans 200 firings
  from a fixed start (1 January 2024), so whether a schedule is accepted never depends on the time
  of asking (`45,55 8 * * *` is refused at 08:50 as at 03:00). Also refuses unreadable schedules,
  nicknames like `@daily`, unknown timezones and dates that never come (`0 9 31 2 *`).
- At most **20 switched on**; the 21st is refused with "You already have 20 routines switched on.
  Switch one off before adding another."
- **Ten failures in a row** (failed or refused) switch a routine off, emit `routine.updated` and add a
  notification. The first failure after a success also notifies; the ones in between stay quiet.
  Switching a routine back on starts the count again.
- `due(now)` **claims** what is due: each firing is handed out once and the next run moves on in the
  same transaction. A routine still running is skipped (its slot is not made up), unless its run
  started over an hour ago and never reported back. A server that slept fires each routine once, not
  once per missed slot. Call `recordRun` when the run ends.
- `scheduleText` is plain words: "Every day at 08:00", "Weekdays at 08:00", "Mondays at 09:30",
  "Every hour", "Every 15 minutes", "On the 1st of every month at 09:00", or the cron itself when
  the shape is stranger than words.

### Triage

Needs you or can wait, with a one-line reason, for each email. Adapted from OpenDuet.

1. **Rules first**, and they only ever say "can wait": bulk mail (list headers **and** filed under
   Promotions or Social), anything filed under Promotions or Social, automatic replies
   (`Auto-Submitted: auto-replied`, or an "Automatic reply:" subject), and answers to invitations.
   List headers alone are not enough: a security report to your team's group and a vendor's
   "rotate your tokens" notice both carry them. `auto-generated` is not a rule either: bank alerts
   and failed payments are auto-generated.
2. **Then the model**, eight at a time, with the prompt in `TRIAGE_SYSTEM` + `triagePrompt`. It never
   names you: it knows your address (from the connector or the most-addressed recipient) and what you
   told Steward about yourself in Memory. The message is fenced as data. Your own address is shown
   bare, without the display name your mail account puts on it, and if the model still uses that
   name (from a "Hi Sam," in the body), the reason and the brief's summary say "you" instead.
3. **Never a silent guess.** When the model fails or is missing, the email goes under needs you with
   "Couldn't sort this one; showing it to be safe.", `by: "rules"`, confidence 0, and the brief says
   how many and why. Provider error text is never stored: it can echo parts of a key.

The model's answer is read after dropping any thinking (`<think>…</think>`, as reasoning models such
as qwen3 and deepseek-r1 write it); then each `{…}` in it is tried, the last first. The brief's
summary drops thinking too.

Model verdicts are cached by email id, so the inbox and the brief do not pay twice. A cached verdict
is reused only from the same model, with the same prompt and the same facts you gave in Memory, and
for 30 days; telling Steward who your accountant is takes effect on the next sort. With no model set
up, a recent verdict from any model is still shown.
Before the model sorts a message, triage reads it whole with `getEmail` (body, Cc and headers), as
the eval does, so "you are copied" and the ask at the end of a long message are seen. Mail the rules
settle, or the cache knows, is never fetched. A read that fails or takes over five seconds keeps the
summary, and the rest of that run uses summaries. Connectors may also put `headers`, `cc` and `body`
on summaries (see `TriageEmail`).

### The morning brief

`brief.generate({ date?, force?, signal? })` builds one brief per local date and stores it; asking
again returns the stored one unless `force`. The date is today or earlier in your timezone; a later
one is refused with "A brief can be made for today or an earlier day.", and `latest()` never returns
a brief for a later date. Callers asking at once share one build, and each `signal` lets only its own
caller give up: the build stops only when every caller has, so a browser closing its tab never
cancels the brief the morning worker is waiting for.

- Mail since the last brief, so a late morning or a weekend away leaves no gap: at least the last
  day, at most the last 3 days ("Mail: only the last 3 days were checked" when the last brief was
  longer ago). A brief that couldn't read the mail doesn't count, so the next one reads back past
  it. Newest first, at most 50; when there were more, it says so.
- Triage as above; unsorted mail last under needs you.
- Today's calendar from local midnight to midnight in your timezone (late-evening events included).
  Where the clocks skip midnight (Santiago in September, Havana in March), the day starts at 01:00.
- Tasks working, ready for review, needing input, or waiting on an approval.
- `couldNotCheck`, in plain words: "Mail: not connected", "Calendar: couldn't be read just now",
  "Sorting: 2 of 9 emails couldn't be sorted (the model didn't answer), so they are under needs you",
  the 50-message cap, the 3-day reach, an unknown timezone.
- A two- or three-sentence summary from the model (no greeting, no name, facts fenced as data), or
  a plain one written from the counts when there is no model or it fails. Demo mail is labelled
  "From the demo inbox:".
- An empty list is never an all-clear for a source that wasn't read. When mail or the calendar
  couldn't be read, the summary is the plain one and says so ("Your mail couldn't be read just now,
  so this brief may be missing what needs you."), never "Nothing new needs you".

Every build emits `brief.ready` and then suggests. Only the first brief for a date adds the
notification "Your brief is ready"; "Check again" does not add another.

### Suggestions

Up to five `suggested` tasks per brief from the mail the model said needs you: "Reply to Ana
Pereira about Friday ship date", or "Look into “Payment failed” from Stripe" for senders that take
no replies. Never a duplicate: an email that has had a task, in any state, is never suggested
again, so Hide means that email is not offered again. A title is skipped while a task with it is
open, or for 14 days after it was hidden, resolved or failed; after that, next month's "Invoice"
from the same sender is offered again. Unsorted mail is never suggested.

### Skills, memory, notifications

- **Skills** are called with `/name`. Tenant skills are re-seeded on every start and read only; your
  own are editable. Names are unique ignoring case; on a clash your own skill wins. `get` takes an id
  or a name, with or without the slash.
- **Memory** keeps facts newest first and does not store the same fact twice.
- **Notifications** are stored and pushed on the bus; `readAll` marks them read.

## Events

`task.updated`, `routine.updated`, `brief.ready`, `notification`. It listens for
`approval.created` and `approval.decided`.

## The triage eval

`pnpm eval:triage` measures triage against 63 labelled emails. See
[`evals/triage/README.md`](../../evals/triage/README.md).

## Credits

Triage rules and prompt, the schedule floor check and describer, and the eval set are adapted from
[OpenDuet](https://github.com/CopilotKit/OpenDuet) (MIT, CopilotKit). Files that adapt its code say
so at the top.
