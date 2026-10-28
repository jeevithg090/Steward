import type { Message, TokenUsage } from "@ag-ui/client";
import type { AuditLog, EventBus, NotificationStore, Task, TaskStore } from "@steward/shared";
import { type ThreadStore, titleFrom } from "../store/threads.ts";
import { unframe } from "./frames.ts";
import { clip, interruptSummary } from "./run-summary.ts";
import type { NodeSqliteAgentRunner, RunFinished } from "./runner.ts";
import type { ServerRuns } from "./server-runs.ts";

/** One provider and model's share of a run, as the record keeps it. */
export interface RecordedUsage {
  provider?: string;
  model?: string;
  input?: number;
  output?: number;
  total?: number;
  cachedInput?: number;
  reasoning?: number;
}

/**
 * AG-UI usage in the record's words. The record hides the value of any key named like a secret,
 * and `inputTokens` reads like one, so the counts are kept under plain names (never under a key
 * with "token" in it). The total is the sum of input and output when the provider gave none.
 */
export function recordedUsage(usage: readonly TokenUsage[]): RecordedUsage[] {
  return usage.map((entry) => {
    const total =
      entry.totalTokens ??
      (entry.inputTokens !== undefined || entry.outputTokens !== undefined
        ? (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0)
        : undefined);
    const row: RecordedUsage = {};
    if (entry.provider) row.provider = entry.provider;
    if (entry.model) row.model = entry.model;
    if (entry.inputTokens !== undefined) row.input = entry.inputTokens;
    if (entry.outputTokens !== undefined) row.output = entry.outputTokens;
    if (total !== undefined) row.total = total;
    if (entry.cachedInputTokens) row.cachedInput = entry.cachedInputTokens;
    if (entry.reasoningTokens) row.reasoning = entry.reasoningTokens;
    return row;
  });
}

function firstUserText(messages: readonly Message[]): string | undefined {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : (m.content ?? [])
            .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
            .join(" ");
    const { body } = unframe(text);
    if (body.trim()) return body;
  }
  return undefined;
}

/** A new run in a task's conversation means work has started again. */
const RESTARTS: ReadonlySet<Task["state"]> = new Set(["needs_input", "ready_for_review", "failed"]);

/**
 * What happens around every run, whoever started it:
 * - the thread gets a row (so it is listed while it runs) and, after its first run, a title taken
 *   from the first thing the person said;
 * - a task's state follows its conversation: working → ready for review, or failed. While an
 *   approval is waiting the task store already reads `needs_you` (it is derived from the approval,
 *   never stored), so a parked run only updates the task's next step. A task the server started
 *   also leaves a notification, since nobody was watching;
 * - every finished run gets a `run.finished` row in the record: how it ended, who started it, and
 *   the tokens it used per provider and model when the agent reported them;
 * - `run.started` and `run.finished` go out live, so a conversation already open in a browser
 *   follows a run it did not start (a routine, a task, a resume).
 */
export function wireRunLifecycle(deps: {
  runner: NodeSqliteAgentRunner;
  threads: ThreadStore;
  tasks: TaskStore;
  notifications: NotificationStore;
  runs: ServerRuns;
  bus: EventBus;
  /** The record. Without it, runs are not written there (the runner's own tests). */
  audit?: AuditLog;
  /** Who runs are recorded as: `local` in single-user mode. */
  actorId?: string;
}): () => void {
  const { runner, threads, tasks, notifications, runs, bus, audit } = deps;
  const actorId = deps.actorId ?? "local";

  const offStarted = runner.onRunStarted(({ threadId, runId, agentId }) => {
    try {
      threads.upsertMeta({ id: threadId, agentId });
      const task = tasks.byThread(threadId);
      if (task && RESTARTS.has(task.state)) tasks.update(task.id, { state: "working" });
    } finally {
      // Said even when the bookkeeping fails: the run is real either way.
      bus.emit({ type: "run.started", threadId, runId, agentId });
    }
  });

  const offFinished = runner.onRunFinished((run: RunFinished) => {
    try {
      followRun(run);
      recordRun(run);
    } finally {
      // After the bookkeeping, so a browser that refreshes on it sees the title and the task state.
      bus.emit({ type: "run.finished", threadId: run.threadId, runId: run.runId, agentId: run.agentId });
    }
  });

  /** One row per run: its outcome, its initiator when the server started it, and its token usage. */
  function recordRun(run: RunFinished): void {
    if (!audit) return;
    const initiator = runs.initiatorOf(run.runId);
    try {
      audit.append({
        type: "run.finished",
        actorId,
        agentId: run.agentId,
        threadId: run.threadId,
        runId: run.runId,
        detail: {
          outcome: run.outcome,
          ...(initiator ? { initiator: initiator.kind } : {}),
          ...(run.usage ? { usage: recordedUsage(run.usage) } : {}),
          ...(run.outcome === "error" && run.error ? { error: clip(run.error, 200) } : {}),
        },
      });
    } catch (err) {
      console.error("[steward] could not record a run:", err instanceof Error ? err.message : err);
    }
  }

  function followRun(run: RunFinished): void {
    const meta = threads.upsertMeta({ id: run.threadId, agentId: run.agentId });
    if (!meta.title) {
      const text = firstUserText(run.messages);
      if (text) threads.setTitle(run.threadId, titleFrom(text));
    }

    const task = tasks.byThread(run.threadId);
    if (!task) return;
    const fromServer = runs.initiatorOf(run.runId) !== undefined;
    const href = `/chat/${run.threadId}`;
    if (run.outcome === "interrupt") {
      const waitingFor = interruptSummary(run);
      tasks.update(task.id, { nextStep: waitingFor });
      if (fromServer) {
        notifications.add({
          title: `${task.title} needs your answer`,
          body: waitingFor,
          href,
          level: "needs_you",
        });
      }
      return;
    }
    if (task.state !== "working") return;
    if (run.outcome === "error") {
      const error = clip(run.error ?? "It stopped before finishing.", 400);
      tasks.update(task.id, { state: "failed", error });
      if (fromServer)
        notifications.add({ title: `${task.title} failed`, body: clip(error), href, level: "problem" });
    } else if (run.outcome === "success") {
      tasks.update(task.id, { state: "ready_for_review" });
      if (fromServer) {
        notifications.add({
          title: `${task.title} is ready for review`,
          body: clip(run.text) || "It finished.",
          href,
          level: "done",
        });
      }
    }
  }

  return () => {
    offStarted();
    offFinished();
  };
}
