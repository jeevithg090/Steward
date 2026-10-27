import type { ApprovalStore, BriefService, NotificationStore, Routine, RoutineStore } from "@steward/shared";
import { routineFiring } from "../runtime/frames.ts";
import { clip, interruptSummary } from "../runtime/run-summary.ts";
import type { RunResult, ServerRun, ServerRuns } from "../runtime/server-runs.ts";
import type { SettingsStore } from "../store/settings.ts";
import type { ThreadStore } from "../store/threads.ts";
import { localDate, localMinutes, parseClock } from "../util/time.ts";
import type { ResumeSweep } from "./resume-sweep.ts";

export const INTERVALS = {
  routines: 30_000,
  brief: 60_000,
  approvals: 60_000,
} as const;

/** How long a due routine waits for its busy conversation before the firing is skipped. */
const ROUTINE_BUSY_WAIT_MS = 5 * 60_000;
/** A failed brief is retried at most this often on the same day. */
const BRIEF_RETRY_MS = 30 * 60_000;
const BRIEF_DATE_KEY = "worker.briefDate";

export interface WorkerDeps {
  routines: RoutineStore;
  brief: BriefService;
  notifications: NotificationStore;
  approvals: ApprovalStore;
  sweep: ResumeSweep;
  runs: ServerRuns;
  settings: SettingsStore;
  threads: ThreadStore;
  now?: () => Date;
}

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

  constructor(private readonly deps: WorkerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(): void {
    this.every("routines", INTERVALS.routines, () => this.tickRoutines());
    this.every("brief", INTERVALS.brief, () => this.tickBrief());
    this.every("approvals", INTERVALS.approvals, () => this.tickApprovals());
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
      void this.fire(routine);
    }
  }

  /**
   * Fires a claimed routine. When its conversation is busy (a resume, or the person chatting in it)
   * the firing waits for the conversation to be free rather than being lost.
   */
  private async fire(routine: Routine): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.runRoutine(routine);
        return;
      } catch (err) {
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

  /** Fires one routine now. Used by the schedule and by "Run now". Throws 409 when its thread is busy. */
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
      userText: routineFiring(routine.prompt),
      initiator: { kind: "routine", id: routine.id },
    });
    void run.done.then((result) => {
      if (result.outcome === "error") this.record(routine, { status: "failed", error: result.error }, result);
      else if (result.refusals.length > 0)
        this.record(routine, { status: "refused", error: result.refusals[0] }, result);
      else this.record(routine, { status: "ok" }, result);
    });
    return run;
  }

  /**
   * Records a run on the routine. The routine store itself says when a routine fails for the first
   * time or is switched off; this adds what only the server knows: that a run is waiting for the
   * person's answer, or that it finished and what it said.
   */
  private record(
    routine: Routine,
    outcome: { status: "ok" | "failed" | "refused"; error?: string },
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

  // ── Approvals ───────────────────────────────────────────────────────────────────────────────

  async tickApprovals(): Promise<void> {
    this.deps.approvals.expireDue(this.now());
    await this.deps.sweep.catchUp();
  }
}
