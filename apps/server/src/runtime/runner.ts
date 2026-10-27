// Adapted from CopilotKit packages/sqlite-runner/src/sqlite-runner.ts and
// packages/runtime/src/v2/runtime/runner/in-memory.ts (MIT, CopilotKit)
import {
  type AbstractAgent,
  type BaseEvent,
  compactEvents,
  EventType,
  type Message,
  type RunAgentInput,
  type RunStartedEvent,
  type StateSnapshotEvent,
} from "@ag-ui/client";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  finalizeRunEvents,
  type LocalThreadEndpointRecord,
  type LocalThreadEndpointRunner,
  ThreadAlreadyRunningError,
} from "@copilotkit/runtime/v2";
import type { Db } from "@steward/db";
import { fromJson } from "@steward/db";
import { type Observable, ReplaySubject } from "rxjs";
import { type RunSummary, summariseRun } from "./run-summary.ts";

/** One run in flight. The lock is in memory, so a crash never leaves a thread stuck "running". */
interface LiveRun {
  runId: string;
  agentId: string;
  agent: AbstractAgent;
  /** Every event of this run, for `connect` while it is live. */
  subject: ReplaySubject<BaseEvent>;
  stopRequested: boolean;
  done: Promise<void>;
}

export interface RunStarted {
  threadId: string;
  runId: string;
  agentId: string;
}

export interface RunFinished extends RunSummary {
  threadId: string;
  runId: string;
  agentId: string;
  /** The whole conversation after the run. */
  messages: Message[];
}

export interface RunnerThreadRecord {
  id: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  preview?: string;
}

interface ThreadRow {
  id: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
  preview: string | null;
}

/** The server run token rides in `forwardedProps.steward`; it must never be stored or replayed. */
export const SERVER_PROPS_KEY = "steward";

function withoutServerProps(input: RunAgentInput): RunAgentInput {
  const props = input.forwardedProps;
  if (!props || typeof props !== "object" || !(SERVER_PROPS_KEY in props)) return input;
  const { [SERVER_PROPS_KEY]: _hidden, ...rest } = props as Record<string, unknown>;
  return { ...input, forwardedProps: rest };
}

function messageIdOf(event: BaseEvent): string | undefined {
  const id = (event as { messageId?: unknown }).messageId;
  return typeof id === "string" ? id : undefined;
}

/**
 * The stored conversation with what `incoming` adds to it. A browser that missed a run the server
 * started (a routine, a resume) sends a stale history; when it lacks stored messages, the stored
 * order comes first and the messages only the browser has follow it. Otherwise `incoming` itself
 * is returned.
 */
export function mergeHistory(stored: readonly Message[], incoming: Message[]): Message[] {
  const incomingIds = new Set(incoming.map((m) => m.id));
  if (stored.every((m) => incomingIds.has(m.id))) return incoming;
  const storedIds = new Set(stored.map((m) => m.id));
  return [...stored, ...incoming.filter((m) => !storedIds.has(m.id))];
}

/** A short plain-text preview of the last message with words in it. */
export function previewOf(messages: readonly Message[], max = 140): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant" && m.role !== "user") continue;
    const content = m.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
              .join(" ")
          : "";
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean) return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  }
  return undefined;
}

/**
 * Persists AG-UI runs in Steward's SQLite file and replays them on `connect`, so a refreshed page
 * gets its conversation back and a server-initiated run (a routine, a task, a resume) shows up live
 * in any browser watching that thread.
 *
 * Differences from `@copilotkit/sqlite-runner`: it uses `node:sqlite` through `@steward/db` (no
 * native build), the running lock lives in memory (no stale locks after a crash), it opts into the
 * runtime's local thread routes, the server run token is stripped before anything is stored, and it
 * tells listeners when runs start and finish.
 */
export class NodeSqliteAgentRunner extends AgentRunner implements LocalThreadEndpointRunner {
  override readonly ɵsupportsLocalThreadEndpoints = true as const;
  private readonly live = new Map<string, LiveRun>();
  private readonly startedListeners = new Set<(run: RunStarted) => void>();
  private readonly finishedListeners = new Set<(run: RunFinished) => void>();

  constructor(private readonly db: Db) {
    super();
  }

  // ── AgentRunner ─────────────────────────────────────────────────────────────────────────────

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const { threadId } = request;
    if (this.live.has(threadId)) throw new ThreadAlreadyRunningError();

    // Turns only the server saw (a routine's parked call, a sweep's resume) must reach the model,
    // or it answers without them and the snapshot the sweep reads loses them.
    const given = Array.isArray(request.agent.messages) ? request.agent.messages : [];
    const merged = mergeHistory(this.getThreadMessages(threadId), given);
    if (merged !== given) request.agent.setMessages(merged);

    const input = withoutServerProps(request.input);
    const runId = input.runId;
    const agentId = request.agent.agentId ?? "default";
    const historic = this.history(threadId);
    const seen = new Set<string>();
    for (const event of historic) {
      const id = messageIdOf(event);
      if (id) seen.add(id);
      if (event.type === EventType.RUN_STARTED) {
        for (const m of (event as RunStartedEvent).input?.messages ?? []) seen.add(m.id);
      }
    }
    const parentRunId = this.latestRunId(threadId);
    const newInput = (): RunAgentInput => ({
      ...input,
      messages: input.messages.filter((m) => !seen.has(m.id)),
    });

    const runSubject = new ReplaySubject<BaseEvent>(Infinity);
    const liveSubject = new ReplaySubject<BaseEvent>(Infinity);
    const events: BaseEvent[] = [];
    let resolveDone!: () => void;
    const live: LiveRun = {
      runId,
      agentId,
      agent: request.agent,
      subject: liveSubject,
      stopRequested: false,
      done: new Promise<void>((r) => {
        resolveDone = r;
      }),
    };
    this.live.set(threadId, live);

    const emit = (event: BaseEvent) => {
      runSubject.next(event);
      liveSubject.next(event);
    };

    const finish = (interruptionMessage?: string) => {
      const agentEventCount = events.length;
      // A stop can arrive before the agent's first event.
      if (live.stopRequested && !events.some((e) => e.type === EventType.RUN_STARTED)) {
        const started: RunStartedEvent = { type: EventType.RUN_STARTED, threadId, runId, input: newInput() };
        events.unshift(started);
        emit(started);
      }
      const appended = finalizeRunEvents(events, {
        stopRequested: live.stopRequested,
        protocolVersion: input.protocolVersion,
        ...(interruptionMessage !== undefined ? { interruptionMessage } : {}),
      });
      for (const event of appended) emit(event);

      // Merged again, so the snapshot never drops a turn only the server saw, whatever the agent did
      // with its messages.
      let stored: Message[] = [];
      try {
        stored = this.getThreadMessages(threadId);
      } catch (err) {
        console.error("[steward] could not read a thread:", err instanceof Error ? err.message : err);
      }
      const messages = [
        ...mergeHistory(stored, Array.isArray(request.agent.messages) ? request.agent.messages : []),
      ];
      // An immediate failure that produced nothing is not history.
      if (interruptionMessage === undefined || agentEventCount > 0 || live.stopRequested) {
        try {
          this.persist({ threadId, runId, parentRunId, agentId, events, messages });
        } catch (err) {
          console.error("[steward] could not store a run:", err instanceof Error ? err.message : err);
        }
      }
      this.live.delete(threadId);

      // Listeners hear about the run before its stream completes, so they can still tell which
      // runs the server started; the thread is already free for a follow-up run.
      const summary = summariseRun(events, interruptionMessage);
      for (const listener of this.finishedListeners) {
        try {
          listener({ ...summary, threadId, runId, agentId, messages });
        } catch (err) {
          console.error("[steward] run listener failed:", err instanceof Error ? err.message : err);
        }
      }
      runSubject.complete();
      liveSubject.complete();
      resolveDone();
    };

    for (const listener of this.startedListeners) {
      try {
        listener({ threadId, runId, agentId });
      } catch (err) {
        console.error("[steward] run listener failed:", err instanceof Error ? err.message : err);
      }
    }

    request.agent
      .runAgent(request.input, {
        onEvent: ({ event }) => {
          let processed = event;
          if (event.type === EventType.RUN_STARTED) {
            const started = event as RunStartedEvent;
            processed = {
              ...started,
              input: started.input ? withoutServerProps(started.input) : newInput(),
            } as RunStartedEvent;
          }
          events.push(processed);
          emit(processed);
        },
      })
      .then(
        () => finish(),
        (error: unknown) => finish(error instanceof Error ? error.message : String(error)),
      );

    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const out = new ReplaySubject<BaseEvent>(Infinity);
    const emitted = new Set<string>();
    for (const event of compactEvents(this.history(request.threadId))) {
      out.next(event);
      const id = messageIdOf(event);
      if (id) emitted.add(id);
    }
    const live = this.live.get(request.threadId);
    if (!live) {
      out.complete();
      return out.asObservable();
    }
    live.subject.subscribe({
      next: (event) => {
        const id = messageIdOf(event);
        if (id && emitted.has(id)) return;
        out.next(event);
      },
      complete: () => out.complete(),
      error: (err: unknown) => out.error(err),
    });
    return out.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return Promise.resolve(this.isThreadRunning(request.threadId));
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const live = this.live.get(request.threadId);
    if (!live || live.stopRequested) return Promise.resolve(false);
    if (request.runId !== undefined && request.runId !== live.runId) return Promise.resolve(false);
    live.stopRequested = true;
    try {
      live.agent.abortRun();
      return Promise.resolve(true);
    } catch (err) {
      console.error("[steward] could not stop a run:", err instanceof Error ? err.message : err);
      live.stopRequested = false;
      return Promise.resolve(false);
    }
  }

  // ── Local thread routes (GET /api/copilotkit/threads…) ─────────────────────────────────────

  listThreads(): LocalThreadEndpointRecord[] {
    return this.threadRecords().map((t) => ({
      id: t.id,
      name: null,
      agentId: t.agentId,
      organizationId: "",
      createdById: "",
      archived: false,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  getThreadMessages(threadId: string): Message[] {
    const row = this.db.get<{ messages: string }>("SELECT messages FROM runner_threads WHERE id = ?", [
      threadId,
    ]);
    return fromJson<Message[]>(row?.messages, []);
  }

  getThreadEvents(threadId: string): BaseEvent[] {
    return compactEvents(this.history(threadId));
  }

  getThreadState(threadId: string): Record<string, unknown> | null {
    const events = this.getThreadEvents(threadId);
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.type !== EventType.STATE_SNAPSHOT) continue;
      const snapshot = (event as StateSnapshotEvent).snapshot;
      return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? { ...(snapshot as Record<string, unknown>) }
        : null;
    }
    return null;
  }

  /**
   * Deliberately does nothing. The runtime exposes `POST /threads/clear` as a demo convenience;
   * Steward deletes conversations one at a time through `DELETE /api/threads/:id` instead, so one
   * stray request cannot wipe every conversation.
   */
  clearThreads(): void {}

  // ── Steward additions ───────────────────────────────────────────────────────────────────────

  isThreadRunning(threadId: string): boolean {
    const live = this.live.get(threadId);
    return live !== undefined && !live.stopRequested;
  }

  /** True while a run on this thread has not finished, including one that is stopping. */
  isThreadBusy(threadId: string): boolean {
    return this.live.has(threadId);
  }

  threadRecord(threadId: string): RunnerThreadRecord | undefined {
    const row = this.db.get<ThreadRow>(
      "SELECT id, agent_id, created_at, updated_at, preview FROM runner_threads WHERE id = ?",
      [threadId],
    );
    return row ? toRecord(row) : undefined;
  }

  threadRecords(): RunnerThreadRecord[] {
    return this.db
      .all<ThreadRow>(
        "SELECT id, agent_id, created_at, updated_at, preview FROM runner_threads ORDER BY updated_at DESC",
      )
      .map(toRecord);
  }

  /** Removes a conversation's history. Refuses while a run is in flight on it. */
  deleteThread(threadId: string): void {
    if (this.live.has(threadId)) throw new ThreadAlreadyRunningError();
    this.db.tx(() => {
      this.db.run("DELETE FROM runner_runs WHERE thread_id = ?", [threadId]);
      this.db.run("DELETE FROM runner_threads WHERE id = ?", [threadId]);
    });
  }

  onRunStarted(listener: (run: RunStarted) => void): () => void {
    this.startedListeners.add(listener);
    return () => this.startedListeners.delete(listener);
  }

  onRunFinished(listener: (run: RunFinished) => void): () => void {
    this.finishedListeners.add(listener);
    return () => this.finishedListeners.delete(listener);
  }

  /** Resolves when the thread's current run (if any) has finished and been stored. */
  async whenIdle(threadId: string): Promise<void> {
    await this.live.get(threadId)?.done;
  }

  /**
   * Stops every run and waits (up to `timeoutMs`) for each to be stored. Used at shutdown. An agent
   * that ignores the stop is detached halfway through, so its run is still finalised and stored.
   */
  async stopAll(timeoutMs = 5000): Promise<void> {
    const runs = [...this.live.entries()];
    if (runs.length === 0) return;
    for (const [threadId] of runs) void this.stop({ threadId });
    const all = Promise.all(runs.map(([, live]) => live.done));
    if (await settlesWithin(all, timeoutMs / 2)) return;
    for (const [, live] of this.live.entries()) void live.agent.detachActiveRun().catch(() => {});
    await settlesWithin(all, timeoutMs / 2);
  }

  get runningCount(): number {
    return this.live.size;
  }

  // ── Storage ─────────────────────────────────────────────────────────────────────────────────

  private history(threadId: string): BaseEvent[] {
    return this.db
      .all<{ events: string }>("SELECT events FROM runner_runs WHERE thread_id = ? ORDER BY seq", [threadId])
      .flatMap((row) => fromJson<BaseEvent[]>(row.events, []));
  }

  private latestRunId(threadId: string): string | null {
    const row = this.db.get<{ run_id: string }>(
      "SELECT run_id FROM runner_runs WHERE thread_id = ? ORDER BY seq DESC LIMIT 1",
      [threadId],
    );
    return row?.run_id ?? null;
  }

  private persist(run: {
    threadId: string;
    runId: string;
    parentRunId: string | null;
    agentId: string;
    events: BaseEvent[];
    messages: Message[];
  }): void {
    const now = new Date().toISOString();
    this.db.tx(() => {
      this.db.run(
        "INSERT INTO runner_runs (thread_id, run_id, parent_run_id, agent_id, events, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [
          run.threadId,
          run.runId,
          run.parentRunId,
          run.agentId,
          JSON.stringify(compactEvents(run.events)),
          now,
        ],
      );
      if (run.messages.length > 0) {
        this.db.run(
          `INSERT INTO runner_threads (id, agent_id, created_at, updated_at, messages, preview)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, messages = excluded.messages,
             preview = excluded.preview, agent_id = excluded.agent_id`,
          [
            run.threadId,
            run.agentId,
            now,
            now,
            JSON.stringify(run.messages),
            previewOf(run.messages) ?? null,
          ],
        );
      } else {
        // An empty snapshot (an early failure) never replaces the history we have.
        this.db.run(
          `INSERT INTO runner_threads (id, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
          [run.threadId, run.agentId, now, now],
        );
      }
    });
  }
}

async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]);
  clearTimeout(timer);
  return settled;
}

function toRecord(row: ThreadRow): RunnerThreadRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.preview ? { preview: row.preview } : {}),
  };
}
