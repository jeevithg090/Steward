import type { ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { maskKeys } from "./secrets.ts";

/**
 * What both backends share about the process they run: it starts in a process group of its own,
 * so stopping it also stops whatever it started (a dev server, a test watcher); a start that never
 * answers gives up; and an exit is told in plain words, with the tool's own last line.
 */

/** How long a harness may take to start and open its session before Steward gives up. */
export const START_TIMEOUT_MS = 30_000;
/** How long a harness and what it started may take to stop before they are killed. */
export const KILL_GRACE_MS = 3_000;
/** How long an exit waits for the last of what the tool wrote on stderr. */
const STDERR_WAIT_MS = 250;

/** Waits `ms`, without keeping the server up for it. */
export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer: NodeJS.Timeout = setTimeout(resolve, ms);
    timer.unref();
  });
}

/** Whether a child still runs: it has neither exited nor been killed by a signal. */
export function running(child: ChildProcess | undefined): child is ChildProcess {
  return child !== undefined && child.exitCode === null && child.signalCode === null;
}

/** Whether anything in the process group led by `pid` still runs. */
function groupAlive(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalAll(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // No such group (it has gone, or the child was not started in one): the child alone below.
    }
  }
  if (running(child)) {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

/**
 * Stops a harness and everything it started: SIGTERM to its process group, then SIGKILL to
 * whatever is still there after the grace. Resolves once the harness itself has exited.
 */
export async function stopProcessGroup(
  child: ChildProcess,
  exited: Promise<void> | undefined,
  graceMs = KILL_GRACE_MS,
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (!running(child) && !groupAlive(pid)) return;
  signalAll(child, "SIGTERM");
  const deadline = Date.now() + graceMs;
  await Promise.race([exited ?? Promise.resolve(), delay(graceMs)]);
  while (Date.now() < deadline && (running(child) || groupAlive(pid))) await delay(50);
  if (running(child) || groupAlive(pid)) signalAll(child, "SIGKILL");
  if (running(child) && exited) await exited;
}

/** Waits a moment for a child's stderr to end, so its last words are read before they are told. */
export async function stderrSettled(child: ChildProcess): Promise<void> {
  const stderr = child.stderr;
  if (!stderr || stderr.readableEnded || stderr.destroyed) return;
  await Promise.race([
    new Promise<void>((resolve) => {
      stderr.once("end", resolve);
      stderr.once("close", resolve);
    }),
    delay(STDERR_WAIT_MS),
  ]);
}

/** The last thing a tool said on stderr, as one plain line: colours stripped, keys masked, clipped. */
export function lastLine(stderr: string): string | undefined {
  const lines = stderr
    // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal colour codes start with ESC.
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (!last) return undefined;
  const masked = maskKeys(last);
  return masked.length > 200 ? `${masked.slice(0, 199)}…` : masked;
}

/** "Codex stopped (exit code 3): you are not signed in." from how it ended and what it said last. */
export function plainExit(
  name: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): string {
  const how = signal ? ` (${signal})` : code !== null ? ` (exit code ${code})` : "";
  const said = lastLine(stderr);
  return said ? `${name} stopped${how}: ${said}` : `${name} stopped${how}.`;
}

/** The program as the person wrote it in harnesses.yaml, short enough to read in a sentence. */
export function commandLineOf(profile: { command: string; args: readonly string[] }): string {
  const line = [basename(profile.command), ...profile.args].join(" ");
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/** Said when a harness does not open its session in time. */
export function startTimedOut(
  profile: { name: string; command: string; args: readonly string[]; kind: "acp" | "codex" },
  timeoutMs: number,
): Error {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const mode = profile.kind === "codex" ? "the Codex app-server" : "its Agent Client Protocol mode";
  return new Error(
    `${profile.name} did not answer within ${seconds} second${seconds === 1 ? "" : "s"}. Check that '${commandLineOf(profile)}' starts ${mode}.`,
  );
}

/** A start that could not spawn the program at all, in plain words. */
export function spawnFailed(
  profile: { name: string; command: string },
  error: NodeJS.ErrnoException,
  notInstalled: string,
): Error {
  if (error.code === "ENOENT") return new Error(notInstalled);
  if (error.code === "EACCES")
    return new Error(
      `${profile.name} could not be started: Steward is not allowed to run "${basename(profile.command)}".`,
    );
  return new Error(`${profile.name} could not be started (${error.code ?? "unknown error"}).`);
}
