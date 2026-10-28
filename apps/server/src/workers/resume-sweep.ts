import type { ResumeEntry } from "@ag-ui/client";
import type { Approval, ApprovalStore } from "@steward/shared";
import type { NodeSqliteAgentRunner } from "../runtime/runner.ts";
import type { RunResult, ServerRuns } from "../runtime/server-runs.ts";

/** Decided approvals older than this are not picked up again after a restart. */
const CATCH_UP_WINDOW_MS = 24 * 3_600_000;
const BUSY_RETRY_MS = 5_000;
const BUSY_RETRIES = 6;

export interface ResumeSweepDeps {
  approvals: ApprovalStore;
  runner: NodeSqliteAgentRunner;
  runs: ServerRuns;
  delayMs: number;
  /** Called with each resume run's result, for notifications. */
  onResumed?: (approval: Approval, result: RunResult) => void;
  /**
   * The conversation to resume instead, when the approval was asked by a task another agent handed
   * on: the parent resumes, and its run carries the answer to the child (plan §5).
   */
  parentOf?: (threadId: string) => { threadId: string; agentId: string } | undefined;
  now?: () => number;
}

/**
 * When the person answers an approval, the browser that showed the card normally resumes the run
 * itself. If no browser does within a few seconds (they answered from Tasks, a notification, or it
 * was a routine's), the sweep resumes it through the runner. The gateway claims each answer exactly
 * once, so a sweep racing a browser is harmless: whichever resume comes second is told "already
 * handled".
 */
export class ResumeSweep {
  private readonly timers = new Set<NodeJS.Timeout>();
  /** Approvals this server has already resumed since it started. */
  private readonly swept = new Set<string>();
  private stopped = false;

  constructor(private readonly deps: ResumeSweepDeps) {}

  /** After a decision: wait, then resume if nobody has claimed the answer. */
  schedule(approvalId: string, attempt = 0, delay = this.deps.delayMs): void {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.sweep(approvalId, attempt).catch((err: unknown) => {
        console.error("[steward] resume sweep failed:", err instanceof Error ? err.message : err);
      });
    }, delay);
    timer.unref();
    this.timers.add(timer);
  }

  /**
   * Resumes the run an approval parked, once every approval parked by that run has an answer.
   * Returns the run's result, or `undefined` when there was nothing to do.
   */
  async sweep(approvalId: string, attempt = 0): Promise<RunResult | undefined> {
    const { approvals, runner, runs } = this.deps;
    const approval = approvals.get(approvalId);
    if (!approval || approval.status === "pending" || approval.claimedAt || this.swept.has(approval.id))
      return;

    // A run that parked several calls is resumed once, with every answer.
    const siblings = approvals
      .list({ threadId: approval.threadId, limit: 200 })
      .filter((a) => a.runId === approval.runId);
    const group = siblings.some((a) => a.id === approval.id) ? siblings : [approval, ...siblings];
    if (group.some((a) => a.status === "pending")) return;
    const open = group.filter((a) => !a.claimedAt && !this.swept.has(a.id) && this.isUnanswered(a));
    if (open.length === 0) return;

    const parent = this.deps.parentOf?.(approval.threadId);
    const target = parent ?? { threadId: approval.threadId, agentId: approval.agentId };
    if (runner.isThreadBusy(approval.threadId) || runner.isThreadBusy(target.threadId)) {
      // Most likely the browser's own resume is running. Look again once it is done.
      if (attempt < BUSY_RETRIES) this.schedule(approval.id, attempt + 1, BUSY_RETRY_MS);
      return;
    }

    for (const a of open) this.swept.add(a.id);
    const resume: ResumeEntry[] = open.map((a) => ({
      interruptId: a.toolCallId,
      status: a.status === "allowed" ? "resolved" : "cancelled",
    }));
    let result: RunResult;
    try {
      const run = runs.start({
        agentId: target.agentId,
        threadId: target.threadId,
        resume,
        // A routine's or task's run stays one when resumed, so their stricter rules still apply.
        initiator:
          approval.initiator && approval.initiator.kind !== "person"
            ? approval.initiator
            : { kind: "resume", id: approval.id },
      });
      result = await run.done;
    } catch (err) {
      for (const a of open) this.swept.delete(a.id);
      if (attempt < BUSY_RETRIES) this.schedule(approval.id, attempt + 1, BUSY_RETRY_MS);
      console.error("[steward] could not resume a run:", err instanceof Error ? err.message : err);
      return;
    }
    try {
      this.deps.onResumed?.(approval, result);
    } catch (err) {
      console.error("[steward] resume listener failed:", err instanceof Error ? err.message : err);
    }
    return result;
  }

  /**
   * Picks up answers no run has claimed: decisions made just before a restart, and approvals that
   * expired (the agent is told nobody answered, so a routine or task does not hang for ever).
   * Cancelled approvals are left alone: the run was stopped on purpose.
   */
  async catchUp(): Promise<void> {
    const now = this.deps.now?.() ?? Date.now();
    const candidates = (["allowed", "refused", "expired"] as const).flatMap((status) =>
      this.deps.approvals.list({ status, limit: 100 }),
    );
    for (const a of candidates) {
      if (a.claimedAt || this.swept.has(a.id)) continue;
      const at = Date.parse(a.decidedAt ?? a.expiresAt);
      if (Number.isNaN(at) || now - at < this.deps.delayMs || now - at > CATCH_UP_WINDOW_MS) continue;
      await this.sweep(a.id);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** True when the thread still holds the parked call and nothing has answered it. */
  private isUnanswered(approval: Approval): boolean {
    const messages = this.deps.runner.getThreadMessages(approval.threadId);
    const called = messages.some(
      (m) => m.role === "assistant" && (m.toolCalls ?? []).some((tc) => tc.id === approval.toolCallId),
    );
    const answered = messages.some((m) => m.role === "tool" && m.toolCallId === approval.toolCallId);
    return called && !answered;
  }
}
