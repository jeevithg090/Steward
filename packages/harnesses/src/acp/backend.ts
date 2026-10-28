// Process handling, the stdout line filter and the stream plumbing are adapted from Happy's
// happy-cli/src/agent/acp/AcpBackend.ts (MIT, Happy Coder Contributors), on @agentclientprotocol/sdk 2.0.2.
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  type ClientConnection,
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import type { HarnessProfile } from "@steward/shared";
import { harnessEnvironment } from "../profiles.ts";
import type { BackendEvents, HarnessBackend, HarnessUpdate, TurnEnd } from "../types.ts";
import { filterStdoutLine, outcomeFor, outputOf, permissionFrom, toolNameOf } from "./mapping.ts";

const STDERR_TAIL = 4096;
const KILL_GRACE_MS = 3_000;

/** A byte stream of newline-delimited lines, keeping only the lines `keep` returns. */
export function lineFilter(keep: (line: string) => string | null): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const kept = keep(line);
        if (kept !== null) controller.enqueue(encoder.encode(`${kept}\n`));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      const kept = buffer ? keep(buffer) : null;
      if (kept !== null) controller.enqueue(encoder.encode(`${kept}\n`));
    },
  });
}

/** One ACP session update in Steward's terms, or nothing for updates Steward does not show. */
export function updateFrom(update: SessionUpdate): HarnessUpdate[] {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      if (update.content.type !== "text" || !update.content.text) return [];
      const type = update.sessionUpdate === "agent_message_chunk" ? "text" : "thought";
      return [
        { type, delta: update.content.text, ...(update.messageId ? { messageId: update.messageId } : {}) },
      ];
    }
    case "tool_call": {
      const out: HarnessUpdate[] = [
        {
          type: "tool_start",
          callId: update.toolCallId,
          name: toolNameOf(update),
          input: update.rawInput ?? {},
        },
      ];
      if (update.status === "completed" || update.status === "failed") {
        const output = outputOf(update.content, update.rawOutput);
        out.push({
          type: "tool_end",
          callId: update.toolCallId,
          ok: update.status === "completed",
          ...(output !== undefined ? { output } : {}),
        });
      }
      return out;
    }
    case "tool_call_update": {
      if (update.status !== "completed" && update.status !== "failed") return [];
      const output = outputOf(update.content, update.rawOutput);
      return [
        {
          type: "tool_end",
          callId: update.toolCallId,
          ok: update.status === "completed",
          ...(output !== undefined ? { output } : {}),
        },
      ];
    }
    default:
      return [];
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

/**
 * A harness that speaks the Agent Client Protocol over stdio: Gemini CLI natively, Claude Code and
 * Codex through Zed's adapters, and the ~40 others. Steward is the client. It offers no file system
 * or terminal of its own, so the agent uses its own tools, and asks before it does.
 */
export class AcpBackend implements HarnessBackend {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | undefined;
  private connection: ClientConnection | undefined;
  private sessionId: string | undefined;
  /** True while `session/load` replays the old conversation, which must not reach the new run. */
  private loading = false;
  private stderr = "";
  private exitedPromise: Promise<void> | undefined;
  private closing = false;

  constructor(
    private readonly opts: {
      profile: HarnessProfile;
      cwd: string;
      env: NodeJS.ProcessEnv;
      events: BackendEvents;
      /** Steward's version, sent as the client's name. */
      version?: string;
    },
  ) {}

  get pid(): number | undefined {
    return this.child?.exitCode === null ? this.child.pid : undefined;
  }

  async start({ resumeHandle }: { resumeHandle?: string }): Promise<{ handle: string; resumed: boolean }> {
    const { profile, cwd, events } = this.opts;
    const child = spawn(profile.command, profile.args, {
      cwd,
      env: harnessEnvironment(profile, this.opts.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.child = child;
    this.exitedPromise = new Promise((resolveExit) => {
      child.once("exit", (code, signal) => {
        resolveExit();
        if (!this.closing) {
          events.exited(
            `${profile.name} stopped${signal ? ` (${signal})` : code !== null ? ` (exit code ${code})` : ""}.`,
          );
        }
      });
    });
    // Fails the start, and only the start: a later exit is reported through `events.exited`.
    let ready = false;
    const exited = this.exitedPromise;
    const failed = new Promise<never>((_, reject) => {
      child.on("error", (err) => {
        if (!ready) reject(new Error(`${profile.name} could not be started: ${err.message}`));
      });
      void exited.then(() => {
        if (!ready) reject(this.diedError());
      });
    });
    failed.catch(() => {});
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-STDERR_TAIL);
    });
    child.stdin.on("error", () => {});

    const input = (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>).pipeThrough(
      lineFilter(filterStdoutLine),
    );
    const output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const app = client({ name: "steward" })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (this.loading || params.sessionId !== this.sessionId) return;
        for (const update of updateFrom(params.update)) events.update(update);
      })
      .onRequest(methods.client.session.requestPermission, async ({ params }) => {
        if (params.sessionId !== this.sessionId) return { outcome: { outcome: "cancelled" } };
        const answer = await events.permission(permissionFrom(params, cwd));
        return { outcome: outcomeFor(answer, params.options) };
      });
    const connection = app.connect(ndJsonStream(output, input));
    this.connection = connection;

    const opened = (async () => {
      const init = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "steward", title: "Steward", version: this.opts.version ?? "0.0.0" },
      });
      if (resumeHandle && init.agentCapabilities?.loadSession) {
        this.sessionId = resumeHandle;
        this.loading = true;
        try {
          await connection.agent.request(methods.agent.session.load, {
            sessionId: resumeHandle,
            cwd,
            mcpServers: [],
          });
          return { handle: resumeHandle, resumed: true };
        } catch {
          // The agent no longer has it: start afresh below.
        } finally {
          this.loading = false;
        }
      }
      const created = await connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] });
      this.sessionId = created.sessionId;
      return { handle: created.sessionId, resumed: false };
    })();
    opened.catch(() => {});
    try {
      const result = await Promise.race([opened, failed]);
      ready = true;
      return result;
    } catch (error) {
      ready = true;
      await this.close();
      throw error instanceof Error ? error : new Error(errorText(error));
    }
  }

  private diedError(): Error {
    const tail = this.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
    return new Error(`${this.opts.profile.name} stopped before it was ready${tail ? `: ${tail}` : "."}`);
  }

  async prompt(text: string): Promise<TurnEnd> {
    const { connection, sessionId } = this;
    if (!connection || !sessionId)
      return { stopReason: "error", error: `${this.opts.profile.name} is not running.` };
    try {
      const response = await connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text }],
      });
      const stopReason = response.stopReason === "max_turn_requests" ? "max_tokens" : response.stopReason;
      return { stopReason };
    } catch (error) {
      return {
        stopReason: "error",
        error: `${this.opts.profile.name} could not finish: ${errorText(error)}`,
      };
    }
  }

  async cancel(): Promise<void> {
    const { connection, sessionId } = this;
    if (!connection || !sessionId) return;
    try {
      await connection.agent.notify(methods.agent.session.cancel, { sessionId });
    } catch {
      // The process is already gone; there is nothing left to cancel.
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      this.connection?.close();
    } catch {
      // Closing an already closed connection.
    }
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    timer.unref();
    await this.exitedPromise;
    clearTimeout(timer);
  }
}
