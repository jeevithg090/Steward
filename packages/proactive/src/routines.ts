import type { Db } from "@steward/db";
import type { EventBus, NotificationStore, Routine, RoutineStore } from "@steward/shared";
import { newId, ROUTINE_LIMITS } from "@steward/shared";
import { ProactiveError, requireText } from "./errors.ts";
import { checkSchedule, describeSchedule, latestRun, nextRun } from "./schedule.ts";
import { localDate } from "./time.ts";

type RunStatus = Parameters<RoutineStore["recordRun"]>[1];

const RUN_STATUSES: readonly RunStatus[] = ["ok", "failed", "refused", "skipped"];
const ERROR_MAX = 400;
/** A claimed run that has not reported back after this long is taken to have died with the server. */
const RUN_STALE_MS = 60 * 60_000;
/**
 * The longest a firing may start after its time. A slot later than this, or than half the gap to
 * the slot after it, is missed rather than run late: a morning inbox check at half past seven in
 * the evening is not the routine the person set up.
 */
export const MISSED_GRACE_MS = 2 * 60 * 60_000;

export const ROUTINE_MESSAGES = {
  noTitle: "A routine needs a short title.",
  noPrompt: "A routine needs an instruction to carry out.",
  noAgent: "Choose which agent runs this routine.",
  tooMany: `You already have ${ROUTINE_LIMITS.maxEnabled} routines switched on. Switch one off before adding another.`,
  notFound: "Couldn't find that routine.",
  stopped: "Steward stopped while this was running.",
} as const;

interface RoutineRow {
  id: string;
  title: string;
  prompt: string;
  schedule: string;
  timezone: string;
  enabled: number;
  agent_id: string;
  thread_id: string;
  consecutive_failures: number;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  next_run_at: string | null;
  running_since: string | null;
  created_at: string;
  updated_at: string;
}

function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    scheduleText: describeSchedule(row.schedule),
    timezone: row.timezone,
    enabled: row.enabled === 1,
    agentId: row.agent_id,
    threadId: row.thread_id,
    consecutiveFailures: row.consecutive_failures,
    ...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
    ...(row.last_status ? { lastStatus: row.last_status as Routine["lastStatus"] } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.next_run_at ? { nextRunAt: row.next_run_at } : {}),
    createdAt: row.created_at,
  };
}

function cleanTimezone(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "UTC";
}

/** "at 08:00" today in the routine's zone, or "on Monday 26 October at 08:00" for an earlier day. */
function slotWords(slot: Date, at: Date, timeZone: string): string {
  try {
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(slot);
    if (localDate(slot, timeZone) === localDate(at, timeZone)) return `at ${clock}`;
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(slot);
    return `on ${day} at ${clock}`;
  } catch {
    return `at ${slot.toISOString().slice(11, 16)} UTC`;
  }
}

/**
 * Routines: standing instructions on a five-field cron, each with its own conversation.
 *
 * The limits are enforced here, not in a prompt, because a model can be talked into anything:
 * nothing may fire more often than every 15 minutes, at most 20 may be switched on, and ten
 * failures in a row switch one off (counted since it was last switched on) and tell the person.
 *
 * `due(now)` claims what is due: each firing is handed out once, and the routine's next run moves
 * on in the same transaction, so a slow run is never started twice and a server that was asleep
 * fires each routine once rather than once per missed slot. A slot missed by more than its grace is
 * not run late at all: it is marked missed and the person is told. `recover()` at start records
 * the runs the last server was in the middle of as failed.
 */
export function createRoutineStore(opts: {
  db: Db;
  bus?: EventBus;
  now: () => Date;
  notifications: NotificationStore;
}): RoutineStore {
  const { db, bus, now, notifications } = opts;

  function row(id: string): RoutineRow {
    const r = db.get<RoutineRow>("SELECT * FROM proactive_routines WHERE id = ?", [id]);
    if (!r) throw new ProactiveError("not_found", ROUTINE_MESSAGES.notFound);
    return r;
  }

  function emit(routineId: string): void {
    bus?.emit({ type: "routine.updated", routineId });
  }

  function enabledCount(exceptId?: string): number {
    const r = db.get<{ n: number }>(
      "SELECT count(*) AS n FROM proactive_routines WHERE enabled = 1 AND id != ?",
      [exceptId ?? ""],
    );
    return r?.n ?? 0;
  }

  function nextRunIso(schedule: string, timezone: string, after: Date, previous?: Date): string | null {
    return nextRun(schedule, timezone, after, previous)?.toISOString() ?? null;
  }

  /**
   * Records one run. `failed` and `refused` both count towards the ten in a row: either way the
   * routine did not do its job, and one refused every time will not start working by itself.
   * Only the first failure after a success notifies; the tenth switches it off and says so.
   * `skipped` (the last run still waits for the person's answer) is neither a success nor a
   * failure: the count stays where it was, so an unanswered approval never switches a routine off.
   */
  function recordRun(id: string, status: RunStatus, error?: string): Routine {
    if (!RUN_STATUSES.includes(status)) {
      throw new ProactiveError("invalid", "A run is ok, failed, refused or skipped.");
    }
    const current = row(id);
    const at = now();
    const ok = status === "ok";
    const skipped = status === "skipped";
    const failures = ok ? 0 : skipped ? current.consecutive_failures : current.consecutive_failures + 1;
    const given = error?.trim().replace(/\s+/g, " ").slice(0, ERROR_MAX);
    const fallback = status === "refused" ? "Steward's rules refused part of it." : "It didn't finish.";
    const reason = ok
      ? null
      : given || (skipped ? "Its last run is still waiting for your answer." : fallback);
    const switchOff =
      !ok && !skipped && current.enabled === 1 && failures >= ROUTINE_LIMITS.maxConsecutiveFailures;
    const enabled = switchOff ? 0 : current.enabled;
    const previousFiring =
      current.next_run_at && current.next_run_at <= at.toISOString()
        ? new Date(current.next_run_at)
        : undefined;
    const nextRunAt =
      enabled === 1 ? nextRunIso(current.schedule, current.timezone, at, previousFiring) : null;
    db.run(
      `UPDATE proactive_routines SET last_run_at = ?, last_status = ?, last_error = ?, consecutive_failures = ?,
         enabled = ?, next_run_at = ?, running_since = NULL, updated_at = ? WHERE id = ?`,
      [at.toISOString(), status, reason, failures, enabled, nextRunAt, at.toISOString(), id],
    );
    if (switchOff) {
      notifications.add({
        title: "A routine was switched off",
        body: `“${current.title}” failed ${ROUTINE_LIMITS.maxConsecutiveFailures} times in a row, so it is switched off. Turn it back on when whatever it needs is working.`,
        href: "/routines",
        level: "problem",
      });
    } else if (!ok && !skipped && failures === 1) {
      notifications.add({
        title: "A routine didn't finish",
        body: `“${current.title}”: ${reason}`,
        href: `/chat/${current.thread_id}`,
        level: "problem",
      });
    }
    emit(id);
    return toRoutine(row(id));
  }

  return {
    list() {
      return db.all<RoutineRow>("SELECT * FROM proactive_routines ORDER BY rowid").map(toRoutine);
    },

    get(id) {
      const r = db.get<RoutineRow>("SELECT * FROM proactive_routines WHERE id = ?", [id]);
      return r ? toRoutine(r) : undefined;
    },

    create(input) {
      const title = requireText(
        input.title,
        120,
        ROUTINE_MESSAGES.noTitle,
        "Keep the title under 120 characters.",
      );
      const prompt = requireText(
        input.prompt,
        4000,
        ROUTINE_MESSAGES.noPrompt,
        "Keep the instruction under 4,000 characters.",
      );
      const agentId = requireText(input.agentId, 120, ROUTINE_MESSAGES.noAgent);
      const timezone = cleanTimezone(input.timezone);
      const schedule = checkSchedule(input.schedule, timezone);
      const enabled = input.enabled !== false;
      const at = now();
      const id = newId("rtn");
      db.tx(() => {
        if (enabled && enabledCount() >= ROUTINE_LIMITS.maxEnabled) {
          throw new ProactiveError("limit", ROUTINE_MESSAGES.tooMany);
        }
        db.run(
          `INSERT INTO proactive_routines
             (id, title, prompt, schedule, timezone, enabled, agent_id, thread_id, consecutive_failures,
              next_run_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [
            id,
            title,
            prompt,
            schedule,
            timezone,
            enabled ? 1 : 0,
            agentId,
            newId("thr"),
            enabled ? nextRunIso(schedule, timezone, at) : null,
            at.toISOString(),
            at.toISOString(),
          ],
        );
      });
      emit(id);
      return toRoutine(row(id));
    },

    /** Switching a routine back on clears its failure count and schedules it from now. */
    update(id, patch) {
      const current = row(id);
      const next: RoutineRow = { ...current };
      if (patch.title !== undefined) {
        next.title = requireText(
          patch.title,
          120,
          ROUTINE_MESSAGES.noTitle,
          "Keep the title under 120 characters.",
        );
      }
      if (patch.prompt !== undefined) {
        next.prompt = requireText(
          patch.prompt,
          4000,
          ROUTINE_MESSAGES.noPrompt,
          "Keep the instruction under 4,000 characters.",
        );
      }
      if (patch.timezone !== undefined) next.timezone = cleanTimezone(patch.timezone);
      if (patch.schedule !== undefined || patch.timezone !== undefined) {
        next.schedule = checkSchedule(patch.schedule ?? current.schedule, next.timezone);
      }
      if (patch.enabled !== undefined) next.enabled = patch.enabled ? 1 : 0;
      const switchedOn = current.enabled === 0 && next.enabled === 1;
      if (switchedOn) next.consecutive_failures = 0;
      const timing = switchedOn || next.schedule !== current.schedule || next.timezone !== current.timezone;
      const at = now();
      if (next.enabled === 0) next.next_run_at = null;
      else if (timing) next.next_run_at = nextRunIso(next.schedule, next.timezone, at);
      next.updated_at = at.toISOString();
      db.tx(() => {
        if (switchedOn && enabledCount(id) >= ROUTINE_LIMITS.maxEnabled) {
          throw new ProactiveError("limit", ROUTINE_MESSAGES.tooMany);
        }
        db.run(
          `UPDATE proactive_routines SET title = ?, prompt = ?, schedule = ?, timezone = ?, enabled = ?,
             consecutive_failures = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
          [
            next.title,
            next.prompt,
            next.schedule,
            next.timezone,
            next.enabled,
            next.consecutive_failures,
            next.next_run_at,
            next.updated_at,
            id,
          ],
        );
      });
      emit(id);
      return toRoutine(next);
    },

    remove(id) {
      row(id);
      db.run("DELETE FROM proactive_routines WHERE id = ?", [id]);
      emit(id);
    },

    recordRun,

    /**
     * Claims the routines due at `at`. A routine still running from its last claim is skipped (its
     * missed slot is not made up), unless that run started over an hour ago and never reported back.
     *
     * Lateness is measured from the newest slot that has passed, so a server that slept through
     * five hourly slots is late only for the last. Within the grace (the smaller of two hours and
     * half the gap to the following slot) the routine is claimed with `dueAt` set; past it, the slot
     * is marked missed, the next run moves on, and one notification names what was missed.
     */
    due(at = now()) {
      const iso = at.toISOString();
      const stale = new Date(at.getTime() - RUN_STALE_MS).toISOString();
      const missed: { title: string; when: string }[] = [];
      const touched: string[] = [];
      const claimed = db.tx(() => {
        const rows = db.all<RoutineRow>(
          `SELECT * FROM proactive_routines
           WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
             AND (running_since IS NULL OR running_since < ?)
           ORDER BY next_run_at`,
          [iso, stale],
        );
        const out: Routine[] = [];
        for (const r of rows) {
          touched.push(r.id);
          const slot = latestRun(r.schedule, r.timezone, new Date(r.next_run_at!), at);
          const following = nextRun(r.schedule, r.timezone, slot);
          const grace = Math.min(
            MISSED_GRACE_MS,
            following ? (following.getTime() - slot.getTime()) / 2 : MISSED_GRACE_MS,
          );
          const nextRunAt = nextRunIso(r.schedule, r.timezone, at, slot);
          if (at.getTime() - slot.getTime() > grace) {
            const when = slotWords(slot, at, r.timezone);
            db.run(
              `UPDATE proactive_routines SET next_run_at = ?, last_run_at = ?, last_status = 'missed',
                 last_error = ?, updated_at = ? WHERE id = ?`,
              [nextRunAt, iso, `Missed the run due ${when} while Steward wasn't running.`, iso, r.id],
            );
            missed.push({ title: r.title, when });
            continue;
          }
          r.next_run_at = nextRunAt;
          r.running_since = iso;
          db.run("UPDATE proactive_routines SET next_run_at = ?, running_since = ? WHERE id = ?", [
            r.next_run_at,
            iso,
            r.id,
          ]);
          out.push({ ...toRoutine(r), dueAt: slot.toISOString() });
        }
        return out;
      });
      const [first] = missed;
      if (first) {
        const more = missed.length - 1;
        notifications.add({
          title: more ? `${missed.length} routines missed their time` : "A routine missed its time",
          body: more
            ? `“${first.title}” and ${more} more were due while Steward wasn't running. Press Run now on Routines for any you still need.`
            : `“${first.title}” was due ${first.when} while Steward wasn't running. Press Run now on Routines if you still need it.`,
          href: "/routines",
          level: "problem",
        });
      }
      for (const id of touched) emit(id);
      return claimed;
    },

    recover() {
      const running = db.all<{ id: string }>(
        "SELECT id FROM proactive_routines WHERE running_since IS NOT NULL ORDER BY rowid",
      );
      for (const r of running) recordRun(r.id, "failed", ROUTINE_MESSAGES.stopped);
      return running.length;
    },
  };
}
