import type { Message } from "@ag-ui/client";
import type { EventBus, NotificationStore, Task, TaskStore } from "@steward/shared";
import { type ThreadStore, titleFrom } from "../store/threads.ts";
import { unframe } from "./frames.ts";
import { clip, interruptSummary } from "./run-summary.ts";
import type { NodeSqliteAgentRunner, RunFinished } from "./runner.ts";
import type { ServerRuns } from "./server-runs.ts";

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
}): () => void {
  const { runner, threads, tasks, notifications, runs, bus } = deps;

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
    } finally {
      // After the bookkeeping, so a browser that refreshes on it sees the title and the task state.
      bus.emit({ type: "run.finished", threadId: run.threadId, runId: run.runId, agentId: run.agentId });
    }
  });

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
