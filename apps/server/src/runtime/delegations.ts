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

/** Child conversations are named so they read as what they are wherever an id shows. */
export const CHILD_THREAD_PREFIX = "sub_";

/** A child's run as the parent's middleware follows it. Only the public fields are data. */
class ChildRun implements DelegationRun {
  readonly subagentRunId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly task: string;
  readonly #run: ServerRun;
  readonly #result: Promise<DelegationResult>;
  readonly #stop: () => Promise<void>;

  constructor(
    record: DelegationRecord,
    agentName: string,
    run: ServerRun,
    result: Promise<DelegationResult>,
    stop: () => Promise<void>,
  ) {
    this.subagentRunId = record.subagentRunId;
    this.agentId = record.childAgentId;
    this.agentName = agentName;
    this.task = record.task;
    this.#run = run;
    this.#result = result;
    this.#stop = stop;
  }

  events(): Observable<BaseEvent> {
    return this.#run.events;
  }

  done(): Promise<DelegationResult> {
    return this.#result;
  }

  stop(): Promise<void> {
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
    if (depth > this.maxDepth)
      throw new Error("This task was handed on already, so it cannot be handed on again.");
    if (!task) throw new Error("The task was empty. Say what the other agent should do.");
    const target = this.targets(parent.agentId).find((a) => a.id === agentId);
    if (!target) throw new Error(`There is no agent "${agentId}" to hand this to right now.`);
    if (this.deps.store.runningFor(parent.runId) >= this.maxConcurrent) {
      throw new Error(
        `At most ${this.maxConcurrent} handed-on tasks can run at once. Wait for one to finish.`,
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
      this.deps.store.setStatus(record.subagentRunId, "failed");
      throw error;
    }
    const result = run.done.then((summary) => this.settle(record, summary));
    const stop = async () => {
      await this.deps.runner.stop({ threadId: record.childThreadId });
    };
    return new ChildRun(record, agentName, run, result, stop);
  }

  private settle(record: DelegationRecord, summary: RunResult): DelegationResult {
    const outcome = summary.outcome;
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
