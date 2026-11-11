import type {
  ApprovalStore,
  BriefService,
  InboxWatchService,
  NotificationStore,
  Routine,
  RoutineStore,
} from "@steward/shared";
import { routineFiring } from "../runtime/frames.ts";
import { clip, interruptSummary } from "../runtime/run-summary.ts";
import {
  type RunResult,
  type ServerRun,
  type ServerRuns,
  ThreadWaitingError,
} from "../runtime/server-runs.ts";
import type { SettingsStore } from "../store/settings.ts";
import type { ThreadStore } from "../store/threads.ts";
import { localDate, localMinutes, parseClock, zonedParts } from "../util/time.ts";
import type { ResumeSweep } from "./resume-sweep.ts";

export const INTERVALS = {
  routines: 30_000,
  brief: 60_000,
  approvals: 60_000,
  watch: 30 * 60_000,
} as const;

/** The inbox watch looks from the person's brief time until this local time. */
export const WATCH_UNTIL = "21:00";

/** How long a due routine waits for its busy conversation before the firing is skipped. */
const ROUTINE_BUSY_WAIT_MS = 5 * 60_000;
/** A firing that starts this long after its slot says so, so the run knows it is late. */
const ROUTINE_LATE_NOTE_MS = 5 * 60_000;
/** A failed brief is retried at most this often on the same day. */
const BRIEF_RETRY_MS = 30 * 60_000;
const BRIEF_DATE_KEY = "worker.briefDate";
/** What a routine's last run says after the person stopped it. */
export const STOPPED_RUN = "You stopped this run.";

export interface WorkerDeps {
  routines: RoutineStore;
  brief: BriefService;
  notifications: NotificationStore;
  approvals: ApprovalStore;
  sweep: ResumeSweep;
  runs: ServerRuns;
  settings: SettingsStore;
  threads: ThreadStore;
  /** The inbox watch. It looks only when the person has switched it on. */
  watch?: InboxWatchService;
  now?: () => Date;
}

/**
 * Routines of one agent share its computer, one browser page, so they run one at a time; and at
 * most `concurrent` run at once, so a busy 08:00 does not start every model call and browser
 * together. A run holds its agent's turn until it finishes or `turnMs` has passed.
 */
export const ROUTINE_QUEUE = { concurrent: 3, turnMs: 15 * 60_000 } as const;

/**
 * The background loops: routines that are due, the daily brief at the person's brief time, and
 * approval expiry with the resume catch-up. Every timer is unref'd (it never keeps the process
 * alive) and each loop skips a tick while its previous one is still running.
 */
export class Workers {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly busy = new Set<string>();
  private lastBriefAttempt = 0;
  private stopped = false;
  /** Claimed routines waiting for their turn, oldest first. */
  private readonly waiting: Routine[] = [];
  /** Agents with a routine under way. */
  private readonly running = new Set<string>();

  constructor(
    private readonly deps: WorkerDeps,
    private readonly queue: { concurrent: number; turnMs: number } = ROUTINE_QUEUE,
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(): void {
    // Runs the last server was in the middle of died with it: say so before anything new is claimed.
    try {
      this.deps.routines.recover();
    } catch (err) {
      console.error("[steward] could not recover routine runs:", err instanceof Error ? err.message : err);
    }
    this.every("routines", INTERVALS.routines, () => this.tickRoutines());
    this.every("brief", INTERVALS.brief, () => this.tickBrief());
    this.every("approvals", INTERVALS.approvals, () => this.tickApprovals());
    this.every("watch", INTERVALS.watch, () => this.tickWatch());
    // First look shortly after boot, not a full interval later.
    const first = setTimeout(() => {
      void this.guard("brief", () => this.tickBrief());
      void this.guard("approvals", () => this.tickApprovals());
    }, 2_000);
    first.unref();
    this.timers.push(first);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
  }

  private every(name: string, ms: number, tick: () => Promise<void>): void {
    const timer = setInterval(() => void this.guard(name, tick), ms);
    timer.unref();
    this.timers.push(timer);
  }

  private async guard(name: string, tick: () => Promise<void>): Promise<void> {
    if (this.stopped || this.busy.has(name)) return;
    this.busy.add(name);
    try {
      await tick();
    } catch (err) {
      console.error(`[steward] ${name} worker failed:`, err instanceof Error ? err.message : err);
    } finally {
      this.busy.delete(name);
    }
  }

  // ── Routines ────────────────────────────────────────────────────────────────────────────────

  async tickRoutines(): Promise<void> {
    const due = this.deps.routines.due(this.now());
    for (const routine of due) {
      if (this.stopped) return;
      if (!routine.enabled) continue;
      if (this.waiting.some((r) => r.id === routine.id)) continue;
      this.waiting.push(routine);
    }
    this.startWaiting();
  }

  /** Starts each waiting routine whose agent is free, while fewer than the limit are under way. */
  private startWaiting(): void {
    for (let i = 0; i < this.waiting.length && this.running.size < this.queue.concurrent; ) {
      if (this.stopped) return;
      const routine = this.waiting[i] as Routine;
      if (this.running.has(routine.agentId)) {
        i++;
        continue;
      }
      this.waiting.splice(i, 1);
      this.running.add(routine.agentId);
      void this.takeTurn(routine)
        .catch((err) => {
          console.error("[steward] a routine did not start:", err instanceof Error ? err.message : err);
        })
        .finally(() => {
          this.running.delete(routine.agentId);
          this.startWaiting();
        });
    }
  }

  /** Fires a routine and holds its agent's turn until the run ends or the turn limit passes. */
  private async takeTurn(queued: Routine): Promise<void> {
    // It may have waited a while: one switched off or removed since does not run, and one edited
    // runs as it is now.
    const current = this.deps.routines.get(queued.id);
    if (!current?.enabled) return;
    // The slot it was claimed for travels with it, so a late start still says when it was due.
    const routine: Routine = queued.dueAt ? { ...current, dueAt: queued.dueAt } : current;
    const run = await this.fire(routine);
    if (!run) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      run.done,
      new Promise((resolve) => {
        timer = setTimeout(resolve, this.queue.turnMs);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * Fires a claimed routine. When its conversation is busy (a resume, or the person chatting in it)
   * the firing waits for the conversation to be free rather than being lost. When its last run still
   * waits for the person's answer, the firing is skipped and recorded as such.
   */
  private async fire(routine: Routine): Promise<ServerRun | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return this.runRoutine(routine);
      } catch (err) {
        if (err instanceof ThreadWaitingError) {
          this.record(routine, {
            status: "skipped",
            error: "Its last run is still waiting for your answer, so this run was skipped.",
          });
          return;
        }
        if ((err as { status?: number }).status !== 409 || attempt > 0) {
          this.record(routine, {
            status: "failed",
            error:
              (err as { status?: number }).status === 409
                ? "Its conversation stayed busy, so this run was skipped."
                : err instanceof Error
                  ? err.message
                  : String(err),
          });
          return;
        }
        await Promise.race([
          this.deps.runs.whenIdle(routine.threadId),
          new Promise((resolve) => setTimeout(resolve, ROUTINE_BUSY_WAIT_MS).unref()),
        ]);
        if (this.stopped) return;
      }
    }
  }

  /**
   * Fires one routine now. Used by the schedule and by "Run now". Throws 409 when its thread is
   * busy or its last run still waits for an answer.
   */
  runRoutine(routine: Routine): ServerRun {
    this.deps.threads.upsertMeta({
      id: routine.threadId,
      agentId: routine.agentId,
      kind: "routine",
      title: routine.title,
    });
    const run = this.deps.runs.start({
      agentId: routine.agentId,
      threadId: routine.threadId,
      userText: routineFiring(routine.prompt) + this.lateNote(routine),
      initiator: { kind: "routine", id: routine.id },
    });
    void run.done.then((result) => {
      // Stopped on purpose: nothing failed, and the person who stopped it needs no notification.
      if (result.outcome === "cancelled") this.record(routine, { status: "skipped", error: STOPPED_RUN });
      else if (result.outcome === "error")
        this.record(routine, { status: "failed", error: result.error }, result);
      else if (result.refusals.length > 0)
        this.record(routine, { status: "refused", error: result.refusals[0] }, result);
      else this.record(routine, { status: "ok" }, result);
    });
    return run;
  }

  /** "(Due at 08:00; starting at 08:40.)" after a firing that starts well after its slot, else nothing. */
  private lateNote(routine: Routine): string {
    if (!routine.dueAt) return "";
    const due = new Date(routine.dueAt);
    const now = this.now();
    if (Number.isNaN(due.getTime()) || now.getTime() - due.getTime() <= ROUTINE_LATE_NOTE_MS) return "";
    const clock = (at: Date) => {
      const p = zonedParts(at, routine.timezone);
      return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    };
    return `\n\n(Due at ${clock(due)}; starting at ${clock(now)}.)`;
  }

  /**
   * Records a run on the routine. The routine store itself says when a routine fails for the first
   * time or is switched off; this adds what only the server knows: that a run is waiting for the
   * person's answer, or that it finished and what it said.
   */
  private record(
    routine: Routine,
    outcome: { status: "ok" | "failed" | "refused" | "skipped"; error?: string },
    result?: RunResult,
  ): void {
    const { notifications, routines } = this.deps;
    try {
      routines.recordRun(routine.id, outcome.status, outcome.error ? clip(outcome.error, 400) : undefined);
    } catch (err) {
      // Most likely the routine was deleted while it ran.
      console.error("[steward] could not record a routine run:", err instanceof Error ? err.message : err);
      return;
    }
    if (outcome.status !== "ok" || !result) return;
    const href = `/chat/${routine.threadId}`;
    try {
      if (result.outcome === "interrupt") {
        notifications.add({
          title: `${routine.title} needs your answer`,
          body: interruptSummary(result),
          href,
          level: "needs_you",
        });
      } else {
        notifications.add({
          title: `${routine.title} ran`,
          body: clip(result.text || "It finished."),
          href,
          level: "done",
        });
      }
    } catch (err) {
      console.error("[steward] could not add a notification:", err instanceof Error ? err.message : err);
    }
  }

  // ── The daily brief ─────────────────────────────────────────────────────────────────────────

  /**
   * Makes today's brief once the person's brief time has passed. The brief service announces it
   * (a notification and `brief.ready`); a failure is retried every half hour and said once.
   */
  async tickBrief(): Promise<void> {
    const { brief, notifications, settings } = this.deps;
    const now = this.now();
    const tz = settings.timezone();
    const at = parseClock(settings.briefTime());
    if (at === undefined || localMinutes(now, tz) < at) return;
    const today = localDate(now, tz);
    if (settings.get<string>(BRIEF_DATE_KEY, "") === today) return;
    if (brief.get(today)) {
      // Made by hand earlier today.
      settings.set(BRIEF_DATE_KEY, today);
      return;
    }
    if (this.lastBriefAttempt && now.getTime() - this.lastBriefAttempt < BRIEF_RETRY_MS) return;
    const firstAttempt = this.lastBriefAttempt === 0;
    this.lastBriefAttempt = now.getTime();
    try {
      await brief.generate({ date: today });
      settings.set(BRIEF_DATE_KEY, today);
      this.lastBriefAttempt = 0;
    } catch (err) {
      console.error("[steward] the daily brief failed:", err instanceof Error ? err.message : err);
      if (firstAttempt) {
        notifications.add({
          title: "Couldn't prepare today's brief",
          body: "It will try again later. You can also make it from Today.",
          href: "/",
          level: "problem",
        });
      }
    }
  }

  // ── The inbox watch ─────────────────────────────────────────────────────────────────────────

  /**
   * One look at new mail, if the person switched the watch on and it is between their brief time
   * and 21:00 where they are. The watch itself checks the rest (mail, a model, today's brief).
   */
  async tickWatch(): Promise<void> {
    const { watch, settings } = this.deps;
    if (!watch?.status().enabled) return;
    const now = this.now();
    const tz = settings.timezone();
    const from = parseClock(settings.briefTime());
    const until = parseClock(WATCH_UNTIL) ?? 24 * 60;
    const minutes = localMinutes(now, tz);
    if (from === undefined || minutes < from || minutes >= until) return;
    await watch.check();
  }

  // ── Approvals ───────────────────────────────────────────────────────────────────────────────

  async tickApprovals(): Promise<void> {
    this.deps.approvals.expireDue(this.now());
    await this.deps.sweep.catchUp();
  }
}
