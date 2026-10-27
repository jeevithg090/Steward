/**
 * Adapted from openbot/agent-computer/src/shell.ts (MIT, CopilotKit).
 *
 * Runs one command with `bash -c` in the agent's workspace. Nothing here decides whether a command
 * may run: that is the gateway's job, and the shell asks by default. What this module guarantees:
 *
 * - `bash -c`, never a login shell: HOME is the agent-writable workspace, and a login shell would
 *   source files the agent can write, so what ran would differ from what was approved.
 * - An allow-listed environment. Steward's own keys (model API keys, tokens) never reach commands.
 * - A time limit (120 s by default, at most 600 s), after which the whole process group is killed,
 *   because pipes keep children alive. Background jobs end with the command.
 * - At most 64 KiB of each stream, keeping the end, because a failing command says why last.
 */
import { spawn } from "node:child_process";
import type { ShellResult } from "@steward/shared";
import { ComputerError } from "./errors.ts";
import { decodeUtf8Tail } from "./workspace.ts";

export const SHELL_DEFAULT_TIMEOUT_MS = 120_000;
export const SHELL_MIN_TIMEOUT_MS = 1_000;
export const SHELL_MAX_TIMEOUT_MS = 600_000;
export const SHELL_OUTPUT_LIMIT = 64 * 1024;
const MAX_COMMAND_LENGTH = 20_000;
/** After the shell exits, how long to wait for its pipes before giving up on a stray holder. */
const CLOSE_GRACE_MS = 2_000;

const PASSED = new Set(["PATH", "LANG", "LANGUAGE", "TERM", "TERMINFO", "COLORTERM", "TZ"]);
/** Never passed, even if a future change widens the list: each one changes what bash or the loader runs. */
const NEVER_PASSED = new Set([
  "BASH_ENV",
  "ENV",
  "BASH_XTRACEFD",
  "BASHOPTS",
  "SHELLOPTS",
  "CDPATH",
  "GLOBIGNORE",
  "IFS",
  "PS4",
  "PROMPT_COMMAND",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "NODE_OPTIONS",
]);
const FALLBACK_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/** The environment a command sees: an allow-list of the server's, plus HOME and TMPDIR. */
export function shellEnvironment(
  base: NodeJS.ProcessEnv,
  workspace: string,
  tmpDir: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || NEVER_PASSED.has(name)) continue;
    if (PASSED.has(name) || name.startsWith("LC_")) env[name] = value;
  }
  env.PATH ??= FALLBACK_PATH;
  env.LANG ??= "en_US.UTF-8";
  env.HOME = workspace;
  env.TMPDIR = tmpDir;
  return env;
}

/** Keeps the last `limit` bytes of a stream without holding more than twice that. */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  dropped = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size > this.limit * 2) this.trim();
  }

  text(): string {
    this.trim();
    const body = decodeUtf8Tail(Buffer.concat(this.chunks));
    return this.dropped ? `[… earlier output cut …]\n${body}` : body;
  }

  private trim(): void {
    const all = Buffer.concat(this.chunks);
    if (all.length > this.limit) {
      this.chunks = [all.subarray(all.length - this.limit)];
      this.size = this.limit;
      this.dropped = true;
    } else {
      this.chunks = [all];
    }
  }
}

export interface RunShellOptions {
  cwd: string;
  tmpDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  baseEnv?: NodeJS.ProcessEnv;
  /** Called with a stop function while the command runs, so the computer can kill it on close. */
  onStart?: (stop: () => void) => () => void;
}

export function clampTimeout(timeoutMs: number | undefined): number {
  const value =
    timeoutMs === undefined || !Number.isFinite(timeoutMs) ? SHELL_DEFAULT_TIMEOUT_MS : Math.floor(timeoutMs);
  return Math.min(SHELL_MAX_TIMEOUT_MS, Math.max(SHELL_MIN_TIMEOUT_MS, value));
}

export function runShell(command: string, opts: RunShellOptions): Promise<ShellResult> {
  if (typeof command !== "string" || command.trim() === "") {
    return Promise.reject(new ComputerError("bad_input", "Give a command to run."));
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return Promise.reject(new ComputerError("bad_input", "That command is too long."));
  }
  if (command.includes("\0")) {
    return Promise.reject(new ComputerError("bad_input", "That command has a null character in it."));
  }
  const timeoutMs = clampTimeout(opts.timeoutMs);
  const started = Date.now();

  return new Promise((resolve) => {
    const stdout = new TailBuffer(SHELL_OUTPUT_LIMIT);
    const stderr = new TailBuffer(SHELL_OUTPUT_LIMIT);
    let timedOut = false;
    let settled = false;
    let exitCode: number | null = null;

    const child = spawn("/bin/bash", ["--noprofile", "--norc", "-c", command], {
      cwd: opts.cwd,
      env: shellEnvironment(opts.baseEnv ?? process.env, opts.cwd, opts.tmpDir),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const unregister = opts.onStart?.(killGroup) ?? (() => {});

    const finish = (spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      unregister();
      killGroup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      let errText = stderr.text();
      if (spawnError)
        errText = `${errText}${errText ? "\n" : ""}The command could not start: ${spawnError.message}`;
      resolve({
        command,
        exitCode: spawnError ? null : exitCode,
        stdout: stdout.text(),
        stderr: errText,
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => killGroup();
    if (opts.signal?.aborted) killGroup();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      exitCode = code;
      // End background jobs with the command, then give the pipes a moment to drain.
      killGroup();
      graceTimer = setTimeout(() => finish(), CLOSE_GRACE_MS);
    });
    child.on("close", () => finish());
  });
}
