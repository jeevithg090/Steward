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
proactive.watch; // the inbox watch, off until the person switches it on
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
- **Late or missed.** Lateness is counted from the newest slot that has passed, so a routine every
  15 minutes just runs at the next one. A slot up to two hours late (or half the gap to the slot after
  it, if that is shorter) is claimed with `dueAt`, and the server adds "(Due at 08:00; starting at
  08:40.)" to a firing more than 5 minutes late. Later than that, the slot is not run at all: the
  routine reads `missed` ("Missed the run due at 08:00 while Steward wasn't running."), its next run
  moves on, and one notification names what was missed, so the person can press **Run now**. A
  missed slot is not a failure.
- **`recover()`** is called once when the server starts. A run still marked as running died with the
  last server: it is recorded as failed ("Steward stopped while this was running."), which notifies
  like any first failure, and the routine is scheduled again from now.
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
   told Steward about yourself in Memory. The message is fenced as data.
3. **Never a silent guess.** When the model fails or is missing, the email goes under needs you with
   "Couldn't sort this one; showing it to be safe.", `by: "rules"`, confidence 0, and the brief says
   how many and why. Provider error text is never stored: it can echo parts of a key.

Model verdicts are cached by email id, so the inbox and the brief do not pay twice.
`EmailSummary` has no headers; connectors may add `headers`, `cc` and `body` (see `TriageEmail`).

### The morning brief

`brief.generate({ date?, force? })` builds one brief per local date and stores it; asking again
returns the stored one unless `force`, and two callers at once share one build.

- Mail from the last 24 hours, newest first, at most 50. When there were more, it says so.
- Triage as above; unsorted mail last under needs you.
- Today's calendar from local midnight to midnight in your timezone (late-evening events included).
- Tasks working, ready for review, needing input, or waiting on an approval.
- `couldNotCheck`, in plain words: "Mail: not connected", "Calendar: couldn't be read just now",
  "Sorting: 2 of 9 emails couldn't be sorted (the model didn't answer), so they are under needs you",
  the 50-message cap, an unknown timezone.
- A two- or three-sentence summary from the model (no greeting, no name, facts fenced as data), or
  a plain one written from the counts when there is no model or it fails. Demo mail is labelled
  "From the demo inbox:".

A new brief emits `brief.ready`, adds the notification "Your brief is ready", and then suggests.

### Suggestions

Up to five `suggested` tasks per brief from the mail the model said needs you: "Reply to Ana
Pereira about Friday ship date", or "Look into “Payment failed” from Stripe" for senders that take
no replies. Never a duplicate: an email or title that already has a task is skipped, whatever its
state, except a task hidden more than 14 days ago. Unsorted mail is never suggested.

### The inbox watch

A small, safe first step towards working through the day, not only in the morning brief. It is
**off** until the person switches it on (Routines → Watch my inbox), and it **only reads**: it calls
no tools, never replies, sends or changes mail, and writes only suggestions, one notification and
its own status (migration `proactive.002_inbox_watch`).

- `watch.check()` looks once. It runs only when mail is connected, a real model is set (the scripted
  one cannot sort mail) and today's brief exists. Otherwise it says why ("Couldn't look: no mailbox
  is connected.") and leaves `checkedAt` at the last time it really looked.
- It reads `in:inbox newer_than:1d` (at most 25) and leaves out mail the brief covered or an earlier
  look dealt with. The rest is triaged as usual (the triage cache means the model is asked about
  each email once), and model-sorted needs-you mail becomes at most **two** suggestions per look,
  through the brief's own de-duplication. Mail past those two, and mail the model could not sort,
  is left for the next look; unsorted mail is never suggested.
- At most one notification per look: "New mail needs you", "Ana Pereira: Friday ship date and 1
  more", prefixed "From the demo inbox:" for demo mail, opening Suggested on Tasks.
- `watch.status()` is `{ enabled, checkedAt?, note?, noteAt? }`: when it last read the inbox, and
  what its last try found or why it could not look. Provider error text is never stored.
- The server looks every 30 minutes from the person's brief time until 21:00 local time.

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

`pnpm eval:triage` measures triage against 62 labelled emails. See
[`evals/triage/README.md`](../../evals/triage/README.md).

## Credits

Triage rules and prompt, the schedule floor check and describer, and the eval set are adapted from
[OpenDuet](https://github.com/CopilotKit/OpenDuet) (MIT, CopilotKit). Files that adapt its code say
so at the top.
