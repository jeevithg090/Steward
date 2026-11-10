import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { AuditLog, GateCall, GateOutcome, HarnessProfile } from "@steward/shared";
import { AgUiStream } from "./events.ts";
import type { HarnessSessionStore } from "./store.ts";
import type {
  BackendFactory,
  HarnessBackend,
  HarnessPermission,
  HarnessUpdate,
  PermissionAnswer,
  TurnEnd,
} from "./types.ts";

/** What the run reading a thread sees, in the order the harness produced it. */
export type ThreadEvent =
  | { type: "update"; update: HarnessUpdate }
  | { type: "permission"; request: HarnessPermission; answer: (answer: PermissionAnswer) => void }
  | { type: "end"; end: TurnEnd }
  | { type: "exited"; reason: string };

/** A permission parked on the person: the harness's request stays open until the resume run answers. */
export interface ParkedPermission {
  call: GateCall;
  request: HarnessPermission;
  answer: (answer: PermissionAnswer) => void;
  parkedAt: number;
  /** What the gateway said when it parked the call: the approval the card shows. */
  outcome: Extract<GateOutcome<unknown>, { status: "parked" }>;
}

/** A process with nothing to do is stopped after this long; its session reopens on the next message. */
export const IDLE_MS = 15 * 60_000;
/** A parked request keeps its process at most this long: an approval expires after a day by default. */
export const PARKED_MS = 24 * 60 * 60_000;

/**
 * One conversation's harness: its process, the session in it, the turn in flight, the permissions
 * parked on the person, and the events no run has read yet. A run attaches, reads until the turn
 * ends or parks, and detaches; whatever the harness says meanwhile waits here for the next run.
 */
export class HarnessThread {
  readonly stream: AgUiStream;
  readonly parked = new Map<string, ParkedPermission>();
  private readonly queue: ThreadEvent[] = [];
  private wake: (() => void) | undefined;
  private turnInFlight = false;
  private timer: NodeJS.Timeout | undefined;
  private lastActive = Date.now();
  private reading = false;
  closed = false;

  constructor(
    readonly threadId: string,
    readonly backend: HarnessBackend,
    /** Unique per process, so a fresh session's call ids never collide with an earlier one's. */
    readonly idPrefix: string,
    private readonly onIdle: (thread: HarnessThread) => void,
    private readonly limits: { idleMs: number; parkedMs: number },
  ) {
    this.stream = new AgUiStream((callId) => `${idPrefix}${callId}`);
  }

  /** Called once the process is up: from now on an unused process is stopped. */
  started(): void {
    this.touch();
    this.arm();
  }

  get busy(): boolean {
    return this.turnInFlight;
  }

  push(event: ThreadEvent): void {
    if (this.closed) {
      if (event.type === "permission") event.answer("cancelled");
      return;
    }
    this.queue.push(event);
    this.touch();
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  /** The next event, or `undefined` when `signal` aborts first. */
  async next(signal: AbortSignal): Promise<ThreadEvent | undefined> {
    this.reading = true;
    try {
      while (this.queue.length === 0) {
        if (signal.aborted || this.closed) return undefined;
        await new Promise<void>((resolve) => {
          const done = () => {
            signal.removeEventListener("abort", done);
            resolve();
          };
          this.wake = done;
          signal.addEventListener("abort", done, { once: true });
        });
      }
      this.touch();
      return this.queue.shift();
    } finally {
      this.reading = false;
    }
  }

  /** Starts a turn. Its end arrives as an `end` event after everything the harness said in it. */
  startTurn(text: string): void {
    this.turnInFlight = true;
    this.stream.beginTurn();
    this.touch();
    void this.backend.prompt(text).then(
      (end) => {
        this.turnInFlight = false;
        this.push({ type: "end", end });
      },
      (error: unknown) => {
        this.turnInFlight = false;
        this.push({ type: "end", end: { stopReason: "error", error: String(error) } });
      },
    );
  }

  /**
   * Stops the turn in flight: every permission still open is answered `cancelled` (ACP asks the
   * client to do so when it cancels), then the harness is asked to stop.
   */
  async cancelTurn(): Promise<void> {
    for (const [id, parked] of this.parked) {
      this.parked.delete(id);
      parked.answer("cancelled");
    }
    for (const event of this.queue) if (event.type === "permission") event.answer("cancelled");
    this.queue.splice(0, this.queue.length, ...this.queue.filter((e) => e.type !== "permission"));
    if (this.turnInFlight) await this.backend.cancel();
  }

  /** Reads and drops events until the turn ends, answering any permission `cancelled`. False on timeout. */
  async drainTurn(timeoutMs: number): Promise<boolean> {
    const signal = AbortSignal.timeout(timeoutMs);
    while (this.turnInFlight || this.queue.some((e) => e.type === "end")) {
      const event = await this.next(signal);
      if (!event) return !this.turnInFlight;
      if (event.type === "permission") event.answer("cancelled");
      if (event.type === "end" || event.type === "exited") return true;
    }
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const parked of this.parked.values()) parked.answer("cancelled");
    this.parked.clear();
    // Requests are answered; what the harness said, and how it ended, stay for the run reading
    // them, so it can tell the person why it stopped ("not signed in"), not only that it did.
    for (const event of this.queue) if (event.type === "permission") event.answer("cancelled");
    this.queue.splice(0, this.queue.length, ...this.queue.filter((e) => e.type !== "permission"));
    this.wake?.();
    try {
      if (this.turnInFlight) await this.backend.cancel();
    } finally {
      await this.backend.close();
    }
  }

  private touch(): void {
    this.lastActive = Date.now();
  }

  /** Checks once a minute (or sooner for short limits) whether the process has outlived its use. */
  private arm(): void {
    const every = Math.max(50, Math.min(60_000, Math.floor(this.limits.idleMs / 2)));
    this.timer = setTimeout(() => {
      if (this.closed) return;
      const idle = Date.now() - this.lastActive;
      const oldestParked = Math.min(...[...this.parked.values()].map((p) => p.parkedAt), Date.now());
      const expired = this.parked.size > 0 && Date.now() - oldestParked > this.limits.parkedMs;
      const unused =
        this.parked.size === 0 && !this.turnInFlight && !this.reading && idle > this.limits.idleMs;
      if (expired || unused) this.onIdle(this);
      else this.arm();
    }, every);
    this.timer.unref();
  }
}

export interface HarnessThreadsOptions {
  profile: HarnessProfile;
  /** The agent's workspace: `computers/<agentId>/workspace`. Created when missing. */
  workspace: string;
  agentId: string;
  backend: BackendFactory;
  store?: HarnessSessionStore;
  audit?: AuditLog;
  actorId?: string;
  idleMs?: number;
  parkedMs?: number;
}

/** A start that was stopped (the run was stopped, the conversation deleted, Steward shut down). */
export class HarnessStartStopped extends Error {
  constructor(name: string) {
    super(`${name} was stopped before it was ready.`);
    this.name = "HarnessStartStopped";
  }
}

/** A process on its way up: its thread, so it can be closed before it is ready. */
interface Starting {
  promise: Promise<{ thread: HarnessThread; notice?: string }>;
  thread?: HarnessThread;
  stop: AbortController;
}

/**
 * The live harness processes of one harness profile, one per conversation. Kept across agent
 * rebuilds while the profile is unchanged, so a parked request survives a bot being installed.
 */
export class HarnessThreads {
  private readonly threads = new Map<string, HarnessThread>();
  private readonly starting = new Map<string, Starting>();

  constructor(private readonly opts: HarnessThreadsOptions) {}

  get profile(): HarnessProfile {
    return this.opts.profile;
  }

  get workspace(): string {
    return this.opts.workspace;
  }

  /**
   * The conversation's harness, started (and its session reopened) when it is not running. When
   * `signal` aborts while it starts, the starting process is stopped and this rejects.
   */
  async thread(threadId: string, signal?: AbortSignal): Promise<{ thread: HarnessThread; notice?: string }> {
    const live = this.threads.get(threadId);
    if (live && !live.closed) return { thread: live };
    if (signal?.aborted) throw new HarnessStartStopped(this.opts.profile.name);
    let starting = this.starting.get(threadId);
    if (!starting) {
      const entry = { stop: new AbortController() } as Starting;
      entry.promise = this.start(threadId, entry).finally(() => {
        if (this.starting.get(threadId) === entry) this.starting.delete(threadId);
      });
      this.starting.set(threadId, entry);
      starting = entry;
    }
    if (!signal) return starting.promise;
    const entry = starting;
    const onAbort = () => void this.stopStarting(entry);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await entry.promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** Stops a process that is still starting: its start rejects, and nothing of it is kept. */
  private async stopStarting(entry: Starting): Promise<void> {
    entry.stop.abort();
    await entry.thread?.close().catch(() => {});
  }

  /** The running harness for a conversation, without starting one. */
  running(threadId: string): HarnessThread | undefined {
    const live = this.threads.get(threadId);
    return live && !live.closed ? live : undefined;
  }

  private async start(
    threadId: string,
    entry: Starting,
  ): Promise<{ thread: HarnessThread; notice?: string }> {
    const { profile, agentId } = this.opts;
    mkdirSync(this.opts.workspace, { recursive: true });
    let thread: HarnessThread | undefined;
    const backend = this.opts.backend({
      cwd: this.opts.workspace,
      events: {
        update: (update) => thread?.push({ type: "update", update }),
        permission: (request) =>
          new Promise<PermissionAnswer>((resolve) => {
            if (!thread) {
              resolve("cancelled");
              return;
            }
            let answered = false;
            thread.push({
              type: "permission",
              request,
              answer: (answer) => {
                if (answered) return;
                answered = true;
                resolve(answer);
              },
            });
          }),
        exited: (reason) => {
          if (!thread || thread.closed) return;
          thread.push({ type: "exited", reason });
          this.forget(thread, reason);
        },
      },
    });
    const prefix = `${profile.id}-${randomBytes(4).toString("hex")}-`;
    thread = new HarnessThread(threadId, backend, prefix, (idle) => void this.retire(idle, "idle"), {
      idleMs: this.opts.idleMs ?? IDLE_MS,
      parkedMs: this.opts.parkedMs ?? PARKED_MS,
    });
    entry.thread = thread;

    const handle = this.opts.store?.get(threadId, profile.id);
    const stopped = new Promise<never>((_, reject) => {
      const fail = () => reject(new HarnessStartStopped(profile.name));
      if (entry.stop.signal.aborted) fail();
      else entry.stop.signal.addEventListener("abort", fail, { once: true });
    });
    stopped.catch(() => {});
    let opened: { handle: string; resumed: boolean };
    try {
      opened = await Promise.race([backend.start(handle ? { resumeHandle: handle } : {}), stopped]);
    } catch (error) {
      thread.closed = true;
      if (entry.stop.signal.aborted) {
        await backend.close().catch(() => {});
        throw new HarnessStartStopped(profile.name);
      }
      throw error;
    }
    // Stopped while it opened (the conversation was deleted, Steward is shutting down): nothing of
    // it is kept, so a deleted conversation's session is never written back.
    if (entry.stop.signal.aborted || thread.closed) {
      thread.closed = true;
      await backend.close().catch(() => {});
      throw new HarnessStartStopped(profile.name);
    }
    this.threads.set(threadId, thread);
    thread.started();
    this.opts.store?.set(threadId, profile.id, agentId, opened.handle);
    this.record("harness.started", threadId, {
      harness: profile.id,
      resumed: opened.resumed,
      pid: backend.pid,
    });
    const notice =
      handle && !opened.resumed
        ? `${profile.name} started a new session, so it does not remember the earlier part of this conversation.`
        : undefined;
    return { thread, ...(notice ? { notice } : {}) };
  }

  private forget(thread: HarnessThread, reason: string): void {
    if (this.threads.get(thread.threadId) === thread) this.threads.delete(thread.threadId);
    void thread.close().catch(() => {});
    this.record("harness.stopped", thread.threadId, { harness: this.opts.profile.id, reason });
  }

  private async retire(thread: HarnessThread, reason: string): Promise<void> {
    if (this.threads.get(thread.threadId) === thread) this.threads.delete(thread.threadId);
    await thread.close().catch(() => {});
    this.record("harness.stopped", thread.threadId, { harness: this.opts.profile.id, reason });
  }

  /** Stops the conversation's harness, e.g. when the conversation is deleted, even one still starting. */
  async close(threadId: string, forget = false): Promise<void> {
    const starting = this.starting.get(threadId);
    if (starting) await this.stopStarting(starting);
    const thread = this.threads.get(threadId);
    if (thread) await this.retire(thread, forget ? "conversation deleted" : "closed");
    if (forget) this.opts.store?.delete(threadId);
  }

  async closeAll(): Promise<void> {
    await Promise.all([
      ...[...this.starting.values()].map((s) => this.stopStarting(s)),
      ...[...this.threads.values()].map((t) => this.retire(t, "shutdown")),
    ]);
  }

  /** The process ids running now, those still starting included. For tests and the leak check. */
  pids(): number[] {
    const all = [
      ...this.threads.values(),
      ...[...this.starting.values()].flatMap((s) => (s.thread ? [s.thread] : [])),
    ];
    return all.flatMap((t) => (t.backend.pid ? [t.backend.pid] : []));
  }

  private record(
    type: "harness.started" | "harness.stopped",
    threadId: string,
    detail: Record<string, unknown>,
  ): void {
    try {
      this.opts.audit?.append({
        type,
        actorId: this.opts.actorId ?? "local",
        agentId: this.opts.agentId,
        threadId,
        detail,
      });
    } catch {
      // The record is best effort here: it must never stop a harness from starting or stopping.
    }
  }
}
