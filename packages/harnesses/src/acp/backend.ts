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
import {
  delay,
  plainExit,
  running,
  START_TIMEOUT_MS,
  spawnFailed,
  startTimedOut,
  stderrSettled,
  stopProcessGroup,
} from "../process.ts";
import { harnessEnvironment, notInstalled } from "../profiles.ts";
import type { BackendEvents, HarnessBackend, HarnessUpdate, TurnEnd } from "../types.ts";
import { filterStdoutLine, outcomeFor, outputOf, permissionFrom, toolNameOf } from "./mapping.ts";

const STDERR_TAIL = 4096;
/** How long a turn that failed waits to learn whether the process exited, so it can say why. */
const EXIT_WAIT_MS = 1_000;

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
  /** Why the process ended, in plain words, once it has. */
  private exitReason: Promise<string> | undefined;
  private closing = false;

  constructor(
    private readonly opts: {
      profile: HarnessProfile;
      cwd: string;
      env: NodeJS.ProcessEnv;
      events: BackendEvents;
      /** Steward's version, sent as the client's name. */
      version?: string;
      /** How long `initialize` and opening the session may take. 30 seconds by default. */
      startTimeoutMs?: number;
    },
  ) {}

  get pid(): number | undefined {
    return running(this.child) ? this.child.pid : undefined;
  }

  async start({ resumeHandle }: { resumeHandle?: string }): Promise<{ handle: string; resumed: boolean }> {
    const { profile, cwd, events } = this.opts;
    // A group of its own, so stopping it also stops whatever it started.
    const child = spawn(profile.command, profile.args, {
      cwd,
      env: harnessEnvironment(profile, this.opts.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
    this.child = child;
    // Fails the start, and only the start: a later exit is reported through `events.exited`.
    let ready = false;
    this.exitedPromise = new Promise((resolveExit) => child.once("exit", () => resolveExit()));
    this.exitReason = new Promise((resolveReason) => {
      child.once("exit", (code, signal) => {
        void stderrSettled(child).then(() => {
          const reason = plainExit(profile.name, code, signal, this.stderr);
          resolveReason(reason);
          if (!this.closing && ready) events.exited(reason);
        });
      });
    });
    const exited = this.exitedPromise;
    // What failed the start, when it was not the protocol: the program, its death, or the clock.
    let reason: Error | undefined;
    let timer: NodeJS.Timeout | undefined;
    const failed = new Promise<never>((_, reject) => {
      const fail = (error: Error) => {
        reason ??= error;
        reject(reason);
      };
      child.on("error", (err) => {
        if (!ready) fail(spawnFailed(profile, err, notInstalled(profile)));
      });
      void exited.then(async () => {
        if (ready) return;
        await stderrSettled(child);
        fail(this.diedError());
      });
      const timeoutMs = this.opts.startTimeoutMs ?? START_TIMEOUT_MS;
      timer = setTimeout(() => fail(startTimedOut(profile, timeoutMs)), timeoutMs);
      timer.unref();
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
      // The connection closes when the process dies: say how it died, not that it closed.
      const died = reason ?? (connection.signal.aborted ? await this.diedWithin(EXIT_WAIT_MS) : undefined);
      ready = true;
      await this.close();
      throw died ?? (error instanceof Error ? error : new Error(errorText(error)));
    } finally {
      clearTimeout(timer);
    }
  }

  private diedError(): Error {
    const child = this.child;
    const { name } = this.opts.profile;
    const said = plainExit(name, child?.exitCode ?? null, child?.signalCode ?? null, this.stderr);
    return new Error(said.replace(`${name} stopped`, `${name} stopped before it was ready`));
  }

  /** The reason the process died, if it does within `ms`. */
  private async diedWithin(ms: number): Promise<Error | undefined> {
    const child = this.child;
    if (!child || !this.exitedPromise) return undefined;
    const ended = await Promise.race([this.exitedPromise.then(() => true), delay(ms).then(() => false)]);
    if (!ended) return undefined;
    await stderrSettled(child);
    return this.diedError();
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
      // The connection closes when the process ends: say how it ended, in its own last words.
      const reason = this.exitReason;
      const exited =
        reason && (connection.signal.aborted || !running(this.child))
          ? await Promise.race([reason, delay(EXIT_WAIT_MS).then(() => undefined)])
          : undefined;
      if (exited) return { stopReason: "error", error: exited };
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
    if (!child) return;
    await stopProcessGroup(child, this.exitedPromise);
  }
}
