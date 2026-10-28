// A Codex app-server client, ported and trimmed from Happy's happy-cli/src/codex/codexAppServerClient.ts
// (MIT, Happy Coder Contributors): the newline-delimited JSON-RPC framing, the process lifecycle,
// the server-request (approval) handling, the decision mapping, and interrupt with a forced restart.
// Dropped: sandbox wrapping, the legacy patch paths, goals, forks, rollback and subagent activity.
//
// Steward always runs Codex with `approvalPolicy: untrusted` and `sandbox: workspace-write`, so it
// asks before anything leaves its sandbox, and every question is a Steward approval.
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { TokenUsage } from "@ag-ui/client";
import type { HarnessProfile } from "@steward/shared";
import { filterStdoutLine } from "../acp/mapping.ts";
import { harnessEnvironment } from "../profiles.ts";
import type { BackendEvents, HarnessBackend, HarnessPermission, TurnEnd } from "../types.ts";
import {
  commandPermission,
  decisionFor,
  elicitationPermission,
  elicitationResponse,
  fileChangePermission,
  itemCompleted,
  itemStarted,
  scopedId,
  usageFrom,
} from "./mapping.ts";
import type {
  CodexInitializeParams,
  CodexThreadItem,
  CodexThreadParams,
  CodexThreadResponse,
  CodexTokenUsage,
  CodexTurnStartParams,
} from "./types.ts";

const REQUEST_TIMEOUT_MS = 30_000;
/** How long an interrupt may take before the app-server is restarted (Happy's ABORT_GRACE_MS). */
export const INTERRUPT_GRACE_MS = 3_000;
const KILL_GRACE_MS = 3_000;
const STDERR_TAIL = 4096;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

interface Turn {
  id?: string;
  done: (end: TurnEnd) => void;
  usage: TokenUsage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export class CodexBackend implements HarnessBackend {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private threadId: string | undefined;
  private model: string | undefined;
  private turn: Turn | undefined;
  private stderr = "";
  private exited: Promise<void> | undefined;
  private closing = false;
  /** Item ids whose words arrived as deltas, so the completed item is not shown again. */
  private readonly streamed = new Set<string>();
  /** File changes seen on `item/started`, for a change request that does not list them. */
  private readonly changes = new Map<string, unknown>();
  /** Approval ids open now, so a second request for the same item gets its own id. */
  private readonly openApprovals = new Set<string>();

  constructor(
    private readonly opts: {
      profile: HarnessProfile;
      cwd: string;
      env: NodeJS.ProcessEnv;
      events: BackendEvents;
      version?: string;
      interruptGraceMs?: number;
    },
  ) {}

  get pid(): number | undefined {
    return this.child?.exitCode === null ? this.child.pid : undefined;
  }

  async start({ resumeHandle }: { resumeHandle?: string }): Promise<{ handle: string; resumed: boolean }> {
    const { profile, cwd } = this.opts;
    const env = harnessEnvironment(profile, this.opts.env);
    // Codex logs every rollout it lists unless told not to (Happy does the same).
    env.RUST_LOG = env.RUST_LOG
      ? `${env.RUST_LOG},codex_core::rollout::list=off`
      : "codex_core::rollout::list=off";
    const child = spawn(profile.command, profile.args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.child = child;
    let ready = false;
    this.exited = new Promise((resolveExit) => {
      child.once("exit", (code, signal) => {
        resolveExit();
        for (const [id, request] of this.pending) {
          request.reject(new Error(`${profile.name} stopped while waiting for ${request.method}`));
          this.pending.delete(id);
        }
        this.turn?.done({
          stopReason: this.closing ? "cancelled" : "error",
          error: `${profile.name} stopped.`,
        });
        this.turn = undefined;
        if (!this.closing && ready) {
          this.opts.events.exited(
            `${profile.name} stopped${signal ? ` (${signal})` : code !== null ? ` (exit code ${code})` : ""}.`,
          );
        }
      });
    });
    const failed = new Promise<never>((_, reject) => {
      child.on("error", (err) => {
        if (!ready) reject(new Error(`${profile.name} could not be started: ${err.message}`));
      });
      void this.exited?.then(() => {
        if (!ready) reject(this.diedError());
      });
    });
    failed.catch(() => {});
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-STDERR_TAIL);
    });
    child.stdin.on("error", () => {});
    createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));

    const opened = (async () => {
      const init: CodexInitializeParams = {
        clientInfo: { name: "steward", title: "Steward", version: this.opts.version ?? "0.0.0" },
        capabilities: { experimentalApi: true },
      };
      await this.request("initialize", init);
      this.notify("initialized");
      const thread: CodexThreadParams = {
        model: null,
        modelProvider: null,
        cwd,
        approvalPolicy: "untrusted",
        sandbox: "workspace-write",
        config: null,
        baseInstructions: null,
        developerInstructions: null,
        persistExtendedHistory: true,
      };
      if (resumeHandle) {
        try {
          const resumed = (await this.request("thread/resume", {
            ...thread,
            threadId: resumeHandle,
          })) as CodexThreadResponse;
          this.threadId = resumed.thread.id;
          this.model = resumed.model;
          return { handle: resumed.thread.id, resumed: true };
        } catch {
          // Codex no longer has it: start afresh.
        }
      }
      const started = (await this.request("thread/start", thread)) as CodexThreadResponse;
      this.threadId = started.thread.id;
      this.model = started.model;
      return { handle: started.thread.id, resumed: false };
    })();
    opened.catch(() => {});
    try {
      const result = await Promise.race([opened, failed]);
      ready = true;
      return result;
    } catch (error) {
      ready = true;
      await this.close();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private diedError(): Error {
    const tail = this.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
    return new Error(`${this.opts.profile.name} stopped before it was ready${tail ? `: ${tail}` : "."}`);
  }

  async prompt(text: string): Promise<TurnEnd> {
    const { threadId } = this;
    if (!threadId) return { stopReason: "error", error: `${this.opts.profile.name} is not running.` };
    const ended = new Promise<TurnEnd>((resolveTurn) => {
      let settled = false;
      this.turn = {
        usage: [],
        done: (end) => {
          if (settled) return;
          settled = true;
          resolveTurn(end);
        },
      };
    });
    const turn = this.turn;
    const params: CodexTurnStartParams = {
      threadId,
      input: [{ type: "text", text }],
      approvalPolicy: "untrusted",
      sandboxPolicy: { type: "workspaceWrite" },
    };
    try {
      const result = (await this.request("turn/start", params)) as { turn?: { id?: unknown } };
      const id = str(result?.turn?.id);
      if (turn && id && !turn.id) turn.id = id;
    } catch (error) {
      turn?.done({
        stopReason: "error",
        error: `${this.opts.profile.name} could not start: ${(error as Error).message}`,
      });
    }
    return ended;
  }

  /** Interrupts the turn; if Codex does not settle it in time, restarts the app-server (Happy's fallback). */
  async cancel(): Promise<void> {
    const turn = this.turn;
    if (!turn || !this.threadId) return;
    const grace = this.opts.interruptGraceMs ?? INTERRUPT_GRACE_MS;
    const settled = new Promise<boolean>((resolveSettled) => {
      const done = turn.done;
      turn.done = (end) => {
        done(end);
        resolveSettled(true);
      };
      setTimeout(() => resolveSettled(false), grace).unref();
    });
    if (turn.id) {
      this.request("turn/interrupt", { threadId: this.threadId, turnId: turn.id }, grace).catch(() => {});
    }
    if (await settled) return;
    // Wedged: the process is replaced on the next message, which resumes the thread.
    turn.done({ stopReason: "cancelled" });
    this.turn = undefined;
    await this.close();
    this.opts.events.exited(`${this.opts.profile.name} did not stop in time, so it was restarted.`);
  }

  async close(): Promise<void> {
    this.closing = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    timer.unref();
    await this.exited;
    clearTimeout(timer);
  }

  // ── JSON-RPC ────────────────────────────────────────────────────────────────────────────────

  private write(message: Record<string, unknown>): void {
    const stdin = this.child?.stdin;
    if (!stdin?.writable) return;
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  private request(method: string, params?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolveRequest, reject) => {
      if (!this.child?.stdin?.writable) {
        reject(new Error(`Cannot send ${method}: ${this.opts.profile.name} is not running`));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolveRequest(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.write({ id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  private notify(method: string, params?: unknown): void {
    this.write({ method, ...(params !== undefined ? { params } : {}) });
  }

  private handleLine(line: string): void {
    if (filterStdoutLine(line) === null) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = message.id;
    if (id !== undefined && id !== null && ("result" in message || "error" in message)) {
      const pending = typeof id === "number" ? this.pending.get(id) : undefined;
      if (!pending) return;
      this.pending.delete(id as number);
      const error = message.error as { message?: unknown; code?: unknown } | undefined;
      if (error) pending.reject(new Error(`${pending.method}: ${String(error.message ?? "failed")}`));
      else pending.resolve(message.result);
      return;
    }
    const method = str(message.method);
    if (!method) return;
    const params = isRecord(message.params) ? message.params : {};
    if (id !== undefined && id !== null) {
      void this.handleServerRequest(id as number | string, method, params);
      return;
    }
    this.handleNotification(method, params);
  }

  // ── What Codex asks ─────────────────────────────────────────────────────────────────────────

  private callIdFor(params: Record<string, unknown>, fallback: string): string {
    const threadId = str(params.threadId) ?? this.threadId;
    const itemId = str(params.itemId) ?? str(params.callId) ?? fallback;
    const base = scopedId(threadId, itemId);
    // A second request for the same item while the first is open gets its own id (Happy's fix).
    return this.openApprovals.has(base) ? `${base}:${fallback}` : base;
  }

  private async ask(callId: string, permission: HarnessPermission) {
    this.openApprovals.add(callId);
    try {
      return await this.opts.events.permission(permission);
    } catch {
      return "reject" as const;
    } finally {
      this.openApprovals.delete(callId);
    }
  }

  private async handleServerRequest(
    id: number | string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const { cwd } = this.opts;
    if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
      const callId = this.callIdFor(params, String(id));
      const answer = await this.ask(callId, commandPermission(params, callId));
      this.write({ id, result: { decision: decisionFor(answer) } });
      return;
    }
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      const callId = this.callIdFor(params, String(id));
      const answer = await this.ask(
        callId,
        fileChangePermission(params, callId, cwd, this.changes.get(callId)),
      );
      this.write({ id, result: { decision: decisionFor(answer) } });
      return;
    }
    if (method === "mcpServer/elicitation/request") {
      const callId = this.callIdFor(
        { ...params, itemId: `${str(params.serverName) ?? "mcp"}:${id}` },
        String(id),
      );
      const answer = await this.ask(callId, elicitationPermission(params, callId));
      this.write({ id, result: elicitationResponse(answer) });
      return;
    }
    // Requests Steward does not answer (wider network or file grants, user input, dynamic tools)
    // are refused, never answered with an empty result Codex could read as a yes.
    this.write({ id, error: { code: -32601, message: `Steward does not answer ${method}.` } });
  }

  // ── What Codex says ─────────────────────────────────────────────────────────────────────────

  private handleNotification(method: string, params: Record<string, unknown>): void {
    const { events } = this.opts;
    const threadId = str(params.threadId) ?? this.threadId;
    const turn = this.turn;
    switch (method) {
      case "turn/started": {
        const id = str(isRecord(params.turn) ? params.turn.id : undefined) ?? str(params.turnId);
        if (turn && id) turn.id = id;
        return;
      }
      case "turn/completed": {
        const info = isRecord(params.turn) ? params.turn : params;
        const status = str(info.status) ?? "completed";
        const error = isRecord(info.error) ? str(info.error.message) : str(info.error);
        this.endTurn(
          status === "completed"
            ? { stopReason: "end_turn" }
            : status === "interrupted"
              ? { stopReason: "cancelled" }
              : {
                  stopReason: "error",
                  error: `${this.opts.profile.name} could not finish${error ? `: ${error}` : "."}`,
                },
        );
        return;
      }
      case "thread/tokenUsage/updated": {
        const usage = (isRecord(params.tokenUsage) ? params.tokenUsage : {}) as CodexTokenUsage;
        const entry = usageFrom(usage.last, this.model, `harness:${this.opts.profile.id}`);
        if (turn && entry) turn.usage.push(entry);
        return;
      }
      case "item/agentMessage/delta": {
        const itemId = str(params.itemId);
        const delta = typeof params.delta === "string" ? params.delta : "";
        if (!itemId || !delta) return;
        this.streamed.add(itemId);
        events.update({ type: "text", delta, messageId: itemId });
        return;
      }
      case "item/started":
      case "item/completed": {
        const item = isRecord(params.item) ? (params.item as CodexThreadItem) : undefined;
        if (!item || typeof item.id !== "string") return;
        const callId = scopedId(threadId, item.id);
        if (method === "item/started") {
          if (item.type === "fileChange") this.changes.set(callId, item.changes);
          for (const update of itemStarted(item, callId)) events.update(update);
        } else {
          this.changes.delete(callId);
          for (const update of itemCompleted(item, callId, this.streamed.delete(item.id)))
            events.update(update);
        }
        return;
      }
      case "codex/event/task_complete":
        this.endTurn({ stopReason: "end_turn" });
        return;
      case "codex/event/turn_aborted":
        this.endTurn({ stopReason: "cancelled" });
        return;
      default:
        return;
    }
  }

  private endTurn(end: TurnEnd): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    turn.done({ ...end, ...(turn.usage.length > 0 ? { usage: turn.usage } : {}) });
  }
}
