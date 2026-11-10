import type { Db } from "@steward/db";
import type {
  BriefService,
  InboxWatch,
  InboxWatchService,
  MailCalendar,
  NotificationStore,
  Task,
  TaskStore,
  TextModel,
  TriageItem,
} from "@steward/shared";
import { suggestFromBrief } from "./suggestions.ts";
import { isKnownTimeZone, localDate } from "./time.ts";
import type { TriageCache, TriageEmail } from "./triage.ts";
import type { TriageService } from "./triage-service.ts";

/** What one look reads: the newest mail in the inbox from the last day. */
export const WATCH_QUERY = "in:inbox newer_than:1d";
export const WATCH_MAIL_LIMIT = 25;
/** At most this many suggestions from one look, so a busy morning does not flood Tasks. */
export const WATCH_MAX_SUGGESTIONS = 2;

export const WATCH_NOTES = {
  noMail: "Couldn't look: no mailbox is connected.",
  noModel: "Couldn't look: no model is set up to sort mail.",
  noBrief: "Waiting for today's brief. It starts looking after that.",
  readFailed: "Couldn't read the inbox just now. It will try again.",
  sortFailed: "Couldn't sort the new mail just now. It will try again.",
} as const;

interface WatchRow {
  enabled: number;
  checked_at: string | null;
  note: string | null;
  note_at: string | null;
}

/**
 * The inbox watch: a small, safe first step towards Steward working through the day, not only in
 * the morning brief. It runs only when the person has switched it on, a mailbox is connected, a
 * real model is set (the scripted one cannot sort mail) and today's brief exists, so the brief has
 * already covered the morning. Each look reads at most 25 emails from the last day, leaves out any
 * the brief or an earlier look already sorted (the triage cache bounds the model's cost), and turns
 * at most two that the model says need the person into suggestions, through the brief's own
 * de-duplication. It says once per look what it found.
 */
export function createInboxWatch(opts: {
  db: Db;
  mail: () => MailCalendar | undefined;
  model: () => TextModel | undefined;
  triage: TriageService;
  cache: TriageCache;
  brief: Pick<BriefService, "get">;
  tasks: TaskStore;
  notifications: NotificationStore;
  timezone: () => string;
  now: () => Date;
}): InboxWatchService {
  const { db, now } = opts;

  function read(): WatchRow {
    return (
      db.get<WatchRow>(
        "SELECT enabled, checked_at, note, note_at FROM proactive_inbox_watch WHERE id = 1",
      ) ?? {
        enabled: 0,
        checked_at: null,
        note: null,
        note_at: null,
      }
    );
  }

  function toWatch(row: WatchRow): InboxWatch {
    return {
      enabled: row.enabled === 1,
      ...(row.checked_at ? { checkedAt: row.checked_at } : {}),
      ...(row.note ? { note: row.note } : {}),
      ...(row.note_at ? { noteAt: row.note_at } : {}),
    };
  }

  function write(patch: Partial<WatchRow>): InboxWatch {
    const next = { ...read(), ...patch };
    db.run(
      `INSERT INTO proactive_inbox_watch (id, enabled, checked_at, note, note_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, checked_at = excluded.checked_at,
         note = excluded.note, note_at = excluded.note_at, updated_at = excluded.updated_at`,
      [next.enabled, next.checked_at, next.note, next.note_at, now().toISOString()],
    );
    return toWatch(next);
  }

  /** Records a try that could not look: `checkedAt` stays at the last time it really did. */
  function couldNot(note: string): InboxWatch {
    return write({ note, note_at: now().toISOString() });
  }

  return {
    status() {
      return toWatch(read());
    },

    setEnabled(enabled) {
      return write({ enabled: enabled ? 1 : 0 });
    },

    async check(checkOpts = {}) {
      if (read().enabled !== 1) return toWatch(read());
      const mail = opts.mail();
      if (!mail) return couldNot(WATCH_NOTES.noMail);
      if (!opts.model()) return couldNot(WATCH_NOTES.noModel);
      const configured = opts.timezone();
      const today = localDate(now(), isKnownTimeZone(configured) ? configured : "UTC");
      const brief = opts.brief.get(today);
      if (!brief) return couldNot(WATCH_NOTES.noBrief);

      let emails: TriageEmail[];
      try {
        emails = (await mail.listEmails({ query: WATCH_QUERY, limit: WATCH_MAIL_LIMIT })) as TriageEmail[];
      } catch {
        checkOpts.signal?.throwIfAborted();
        // Provider error text is never stored: it can echo parts of a key.
        return couldNot(WATCH_NOTES.readFailed);
      }
      const inBrief = new Set([...brief.needsYou, ...brief.canWait].map((item) => item.emailId));
      const fresh = emails.filter((e) => !inBrief.has(e.id) && opts.cache.get(e.id) === undefined);

      let items: TriageItem[] = [];
      let unsorted = 0;
      if (fresh.length > 0) {
        try {
          const run = await opts.triage.run(fresh, checkOpts.signal ? { signal: checkOpts.signal } : {});
          items = run.items;
          unsorted = run.unsorted;
        } catch {
          checkOpts.signal?.throwIfAborted();
          return couldNot(WATCH_NOTES.sortFailed);
        }
      }

      const suggested = suggest(items);
      const at = now().toISOString();
      if (suggested.length > 0) notify(suggested, mail.isDemo);
      return write({ checked_at: at, note: noteFor(fresh.length, unsorted, suggested.length), note_at: at });
    },
  };

  /** Model-sorted needs-you mail becomes suggestions, at most two, never twice for one email. */
  function suggest(items: readonly TriageItem[]): { item: TriageItem; task: Task }[] {
    const made: { item: TriageItem; task: Task }[] = [];
    for (const item of items) {
      if (made.length >= WATCH_MAX_SUGGESTIONS) break;
      if (item.verdict !== "needs_you" || item.by !== "model") continue;
      // One item at a time through the brief's suggester, so its de-duplication is the only one.
      const [task] = suggestFromBrief({ needsYou: [item] } as Parameters<typeof suggestFromBrief>[0], {
        tasks: opts.tasks,
        now,
      });
      if (task) made.push({ item, task });
    }
    return made;
  }

  function notify(made: readonly { item: TriageItem }[], isDemo: boolean): void {
    const [first] = made;
    if (!first) return;
    const sender = first.item.from.name?.trim() || first.item.from.email;
    const subject = first.item.subject.trim() || "(no subject)";
    const more = made.length > 1 ? ` and ${made.length - 1} more` : "";
    opts.notifications.add({
      title: "New mail needs you",
      body: `${isDemo ? "From the demo inbox: " : ""}${sender}: ${subject}${more}`,
      href: "/tasks?view=suggested",
      level: "needs_you",
    });
  }
}

/** "Read 3 new emails; suggested 1 task." in plain words, saying what it could not sort. */
function noteFor(fresh: number, unsorted: number, suggested: number): string {
  if (fresh === 0) return "Nothing new since the brief or the last look.";
  const read = `Read ${fresh} new ${fresh === 1 ? "email" : "emails"}`;
  const found =
    suggested > 0 ? `suggested ${suggested} ${suggested === 1 ? "task" : "tasks"}` : "nothing new needs you";
  // Mail the model did not sort is never suggested, so "nothing needs you" would be a guess.
  if (unsorted > 0) return `${read}; ${found}, and ${unsorted} couldn't be sorted. It will try them again.`;
  return `${read}; ${found}.`;
}
