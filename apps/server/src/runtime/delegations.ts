import { randomUUID } from "node:crypto";
import type { BaseEvent, ResumeEntry } from "@ag-ui/client";
import type { DelegateTarget, DelegationResult, DelegationRun, DelegationService } from "@steward/agent";
import type { AgentInfo, AuditLog, Initiator } from "@steward/shared";
import type { Observable } from "rxjs";
import type { DelegationRecord, DelegationStore } from "../store/delegations.ts";
import { clip } from "./run-summary.ts";
import type { NodeSqliteAgentRunner } from "./runner.ts";
import type { RunResult, ServerRun, ServerRuns } from "./server-runs.ts";

/** How deep hand-offs go by default: a task can be handed on once (plan §5). */
export const DEFAULT_MAX_DEPTH = 1;
/** How many of one run's tasks may run at once by default (plan §5). */
export const DEFAULT_MAX_CONCURRENT = 2;
/** How long a stopped parent waits for its child to stop before it stops waiting. */
export const STOP_GRACE_MS = 15_000;

/**
 * A limit from an env var (`STEWARD_DELEGATION_DEPTH`, `STEWARD_DELEGATION_CONCURRENCY`): a whole
 * number from `min` to 10, else the default. A depth of 0 means no task is ever handed on.
 */
export function delegationLimit(value: string | undefined, fallback: number, min: 0 | 1): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= 10 ? n : fallback;
}

/** Child conversations are named so they read as what they are wherever an id shows. */
export const CHILD_THREAD_PREFIX = "sub_";

/**
 * A child's run as the parent's middleware follows it. Only the public fields are data. Once it is
 * stopped, `done` settles within the grace even if the child never stops: a child that ignores
 * Stop must not hold its parent's conversation open for good.
 */
class ChildRun implements DelegationRun {
  readonly subagentRunId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly task: string;
  readonly #run: ServerRun;
  readonly #done: Promise<DelegationResult>;
  readonly #stop: () => Promise<void>;
  readonly #giveUpLater: () => void;

  constructor(
    record: DelegationRecord,
    agentName: string,
    run: ServerRun,
    result: Promise<DelegationResult>,
    opts: { stop: () => Promise<void>; abandon: () => DelegationResult; graceMs: number },
  ) {
    this.subagentRunId = record.subagentRunId;
    this.agentId = record.childAgentId;
    this.agentName = agentName;
    this.task = record.task;
    this.#run = run;
    this.#stop = opts.stop;
    let settled = false;
    let giveUp: (result: DelegationResult) => void = () => {};
    const gaveUp = new Promise<DelegationResult>((resolve) => {
      giveUp = resolve;
    });
    void result.then(() => {
      settled = true;
    });
    this.#done = Promise.race([result, gaveUp]);
    let timer: NodeJS.Timeout | undefined;
    this.#giveUpLater = () => {
      if (timer || settled) return;
      timer = setTimeout(() => {
        if (!settled) giveUp(opts.abandon());
      }, opts.graceMs);
      timer.unref();
      void result.then(() => clearTimeout(timer));
    };
  }

  events(): Observable<BaseEvent> {
    return this.#run.events;
  }

  done(): Promise<DelegationResult> {
    return this.#done;
  }

  stop(): Promise<void> {
    this.#giveUpLater();
    return this.#stop();
  }
}

/**
 * Handing tasks from one agent to another (plan §5). Each task runs on the target agent in a
 * conversation of its own, through the runner, exactly as a routine's run does: the child's
 * history is kept, its approvals are ordinary approvals, and its rules are the person's. The
 * parent's middleware follows the child and tags its events with the delegation's id.
 */
export class Delegations implements DelegationService {
  readonly maxDepth: number;
  private readonly maxConcurrent: number;
  /** Children the parent stopped waiting for: their late end changes nothing. */
  private readonly abandoned = new Set<string>();

  constructor(
    private readonly deps: {
      store: DelegationStore;
      /** Read late: the runs are built after the agents that use this. */
      runs: () => ServerRuns;
      runner: NodeSqliteAgentRunner;
      /** Every agent with whether it can answer now. */
      agents: () => AgentInfo[];
      audit?: AuditLog;
      actorId: string;
      maxDepth?: number;
      maxConcurrent?: number;
      /** Stops a child conversation's coding agent once its task has ended (`AgentHost.closeThread`). */
      closeChild?: (childThreadId: string) => Promise<void>;
      /** How long a stopped parent waits for its child. */
      stopGraceMs?: number;
    },
  ) {
    this.maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  targets(fromAgentId: string): DelegateTarget[] {
    return this.deps
      .agents()
      .filter((a) => a.available && a.id !== fromAgentId)
      .map((a) => ({ id: a.id, name: a.name, title: a.title }));
  }

  async start(request: Parameters<DelegationService["start"]>[0]): Promise<DelegationRun> {
    const { parent, agentId, task, depth, initiator } = request;
    if (depth > this.maxDepth) {
      throw new Error(
        this.maxDepth === 0
          ? "Handing tasks to other agents is turned off here."
          : "This task was handed on already, so it cannot be handed on again.",
      );
    }
    if (!task) throw new Error("The task was empty. Say what the other agent should do.");
    const target = this.targets(parent.agentId).find((a) => a.id === agentId);
    if (!target) throw new Error(`There is no agent "${agentId}" to hand this to right now.`);
    if (this.deps.store.runningFor(parent.runId) >= this.maxConcurrent) {
      throw new Error(
        `At most ${this.maxConcurrent} handed-on tasks can run at once. Wait for one to finish.`,
      );
    }
    // A coding agent works in one folder: two tasks at once would edit the same files.
    const harness = this.deps.agents().find((a) => a.id === target.id)?.harness;
    if (harness && this.deps.store.runningForAgent(target.id) > 0) {
      throw new Error(
        `${target.name} is already working on another task in its folder. Wait for it to finish.`,
      );
    }
    const id = this.deps.store.get(`sub-${parent.toolCallId}`)
      ? `sub-${parent.toolCallId}-${randomUUID().slice(0, 8)}`
      : `sub-${parent.toolCallId}`;
    const record = this.deps.store.insert({
      subagentRunId: id,
      parentThreadId: parent.threadId,
      parentAgentId: parent.agentId,
      parentRunId: parent.runId,
      parentToolCallId: parent.toolCallId,
      childThreadId: `${CHILD_THREAD_PREFIX}${randomUUID()}`,
      childAgentId: target.id,
      task,
      depth,
    });
    this.record("delegation.started", record, { agent: target.id, task: clip(task, 200) });
    return this.launch(record, target.name, { userText: task, initiator });
  }

  async resume(subagentRunId: string, entries: ResumeEntry[], initiator: Initiator): Promise<DelegationRun> {
    const record = this.deps.store.get(subagentRunId);
    if (!record) throw new Error("That handed-on task is not here any more.");
    // Only a task waiting on a question goes on; one that ended stays ended.
    if (record.status !== "waiting") throw new Error("That handed-on task already ended.");
    const name = this.deps.agents().find((a) => a.id === record.childAgentId)?.name ?? record.childAgentId;
    this.deps.store.setStatus(subagentRunId, "running");
    return this.launch(record, name, { resume: entries, initiator });
  }

  ownerOf(interruptId: string): string | undefined {
    return this.deps.store.ownerOf(interruptId);
  }

  parentCallOf(subagentRunId: string): string | undefined {
    return this.deps.store.get(subagentRunId)?.parentToolCallId;
  }

  /**
   * At boot: a task still marked running was cut off when Steward stopped, so it is marked
   * stopped, and the record says so. Returns how many.
   */
  reconcile(): number {
    const cut = this.deps.store.reconcile();
    for (const record of cut) {
      this.record("delegation.finished", record, {
        agent: record.childAgentId,
        outcome: "cancelled",
        error: "Steward stopped before it finished.",
      });
    }
    return cut.length;
  }

  /** The parent a waiting child's answer must go to, for the resume sweep. */
  parentOf(childThreadId: string): { threadId: string; agentId: string } | undefined {
    const record = this.deps.store.byChildThread(childThreadId);
    return record && record.status === "waiting"
      ? { threadId: record.parentThreadId, agentId: record.parentAgentId }
      : undefined;
  }

  private launch(
    record: DelegationRecord,
    agentName: string,
    opts: { userText?: string; resume?: ResumeEntry[]; initiator: Initiator },
  ): DelegationRun {
    let run: ServerRun;
    try {
      run = this.deps.runs().start({
        agentId: record.childAgentId,
        threadId: record.childThreadId,
        ...(opts.userText ? { userText: opts.userText } : {}),
        ...(opts.resume ? { resume: opts.resume } : {}),
        initiator: opts.initiator,
        delegation: { depth: record.depth, subagentRunId: record.subagentRunId },
      });
    } catch (error) {
      // It never started: the record says it ended, so no start is left without an end.
      this.deps.store.setStatus(record.subagentRunId, "failed");
      this.record("delegation.finished", record, {
        agent: record.childAgentId,
        outcome: "error",
        error: clip(error instanceof Error ? error.message : String(error), 200),
      });
      throw error;
    }
    const result = run.done.then((summary) => this.settle(record, summary));
    const stop = async () => {
      await this.deps.runner.stop({ threadId: record.childThreadId });
    };
    return new ChildRun(record, agentName, run, result, {
      stop,
      abandon: () => this.abandon(record, agentName),
      graceMs: this.deps.stopGraceMs ?? STOP_GRACE_MS,
    });
  }

  /** The parent stopped waiting for a child that did not stop: it is marked stopped, and its coding agent too. */
  private abandon(record: DelegationRecord, agentName: string): DelegationResult {
    this.abandoned.add(record.subagentRunId);
    const error = `${agentName} did not stop in time, so Steward stopped waiting for it.`;
    this.deps.store.setStatus(record.subagentRunId, "stopped");
    this.record("delegation.finished", record, { agent: record.childAgentId, outcome: "cancelled", error });
    this.closeChild(record);
    return { outcome: "cancelled", text: "", error, interrupts: [] };
  }

  /** A child conversation is never written to again once its task ends, so its coding agent stops. */
  private closeChild(record: DelegationRecord): void {
    void this.deps.closeChild?.(record.childThreadId).catch((error: unknown) => {
      console.error(
        "[steward] could not stop a handed-on task's agent:",
        error instanceof Error ? error.message : error,
      );
    });
  }

  private settle(record: DelegationRecord, summary: RunResult): DelegationResult {
    const outcome = summary.outcome;
    if (this.abandoned.delete(record.subagentRunId)) {
      // The parent already stopped waiting; the record said so then.
      return { outcome: "cancelled", text: summary.text, interrupts: [] };
    }
    if (outcome === "interrupt") {
      this.deps.store.setStatus(
        record.subagentRunId,
        "waiting",
        summary.interrupts.map((i) => i.id),
      );
      return { outcome, text: summary.text, interrupts: summary.interrupts };
    }
    const status = outcome === "success" ? "done" : outcome === "cancelled" ? "stopped" : "failed";
    this.deps.store.setStatus(record.subagentRunId, status);
    this.record("delegation.finished", record, {
      agent: record.childAgentId,
      outcome,
      ...(summary.error ? { error: clip(summary.error, 200) } : {}),
    });
    this.closeChild(record);
    return {
      outcome,
      text: summary.text,
      ...(summary.error ? { error: summary.error } : {}),
      interrupts: [],
    };
  }

  private record(
    type: "delegation.started" | "delegation.finished",
    record: DelegationRecord,
    detail: Record<string, unknown>,
  ): void {
    try {
      this.deps.audit?.append({
        type,
        actorId: this.deps.actorId,
        agentId: record.parentAgentId,
        threadId: record.parentThreadId,
        runId: record.parentRunId,
        toolCallId: record.parentToolCallId,
        detail: { ...detail, subagentRunId: record.subagentRunId, childThreadId: record.childThreadId },
      });
    } catch (error) {
      console.error(
        "[steward] could not record a delegation:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}
