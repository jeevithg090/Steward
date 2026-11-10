/**
 * `pnpm dev` (scripts/dev.mjs) with a stand-in `pnpm` on PATH, so no real server or web app starts:
 * it says when Steward is ready, says why when the server could not start, and never fails silently.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const DEV = fileURLToPath(new URL("./dev.mjs", import.meta.url));
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function emptyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "steward-dev-"));
  dirs.push(dir);
  return dir;
}

/** A folder with a `pnpm` that runs `server` for the server and `web` for the web app. */
function fakePnpm(server: string, web: string): string {
  const dir = emptyDir();
  const file = join(dir, "pnpm");
  writeFileSync(
    file,
    `#!/bin/sh\ncase "$2" in\n  @steward/server) ${server} ;;\n  @steward/web) ${web} ;;\nesac\n`,
  );
  chmodSync(file, 0o755);
  return dir;
}

interface Run {
  child: ChildProcess;
  output: () => string;
  /** Resolves once the output matches, or rejects after `ms`. */
  waitFor(pattern: RegExp, ms?: number): Promise<void>;
  exit: Promise<number | null>;
}

/**
 * Runs dev.mjs by Node's own path, with PATH holding only `path`: never the real pnpm, so a test
 * can never start the real server or web app.
 */
function run(args: string[], path: string[]): Run {
  const child = spawn(process.execPath, [DEV, ...args], {
    cwd: emptyDir(),
    env: { PATH: path.join(":"), HOME: tmpdir() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  const listeners = new Set<() => void>();
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      text += chunk;
      for (const listener of listeners) listener();
    });
  }
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    output: () => text,
    waitFor(pattern, ms = 15_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (!pattern.test(text)) return;
          listeners.delete(check);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`no ${pattern} in:\n${text}`));
        }, ms);
        listeners.add(check);
        check();
      });
    },
    exit,
  };
}

const WEB_UP = `printf '\\033[32m  ➜  Local:   http://localhost:5173/\\033[0m\\n'; exec sleep 30`;

describe.skipIf(process.platform === "win32")("pnpm dev", () => {
  it("prints what it starts for --help, and starts nothing", async () => {
    const r = run(["--help"], [emptyDir()]);
    expect(await r.exit).toBe(0);
    expect(r.output()).toMatch(/starts Steward for development/);
    expect(r.output()).toMatch(/docs\/configuration\.md/);
  });

  it("refuses an argument it does not know", async () => {
    const r = run(["--port", "9000"], [emptyDir()]);
    expect(await r.exit).toBe(1);
    expect(r.output()).toMatch(/pnpm dev takes no arguments, only --help \(it was given --port 9000\)/);
  });

  it("says so in a sentence when pnpm is not installed", async () => {
    const r = run([], [emptyDir()]);
    expect(await r.exit).toBe(1);
    expect(r.output()).toMatch(/Could not run pnpm\. Install pnpm 10/);
    expect(r.output()).not.toMatch(/Unhandled 'error' event|ENOENT/);
  });

  it("says Steward is ready once the server and the web app both are, from lines that arrive in pieces", async () => {
    const pnpm = fakePnpm(
      `printf 'Steward is re'; sleep 0.3; printf 'ady at http://127.0.0.1:8787\\n\\n  tenant    steward\\n'; exec sleep 30`,
      WEB_UP,
    );
    const r = run([], [pnpm, "/usr/bin", "/bin"]);
    await r.waitFor(/Steward is ready: open http:\/\/localhost:5173\//);
    await r.waitFor(/│ {3}tenant {4}steward\n/);
    // Each line once, whole, with its prefix; the blank line the server prints is kept.
    expect(r.output()).toMatch(/server\S*│ Steward is ready at http:\/\/127\.0\.0\.1:8787\n/);
    expect(r.output()).toMatch(/server\S*│ \n/);
    expect(r.output().match(/Steward is ready at/g)).toHaveLength(1);
    r.child.kill("SIGINT");
    expect(await r.exit).toBe(0);
  });

  it("says why when the server could not start, while the web app keeps running", async () => {
    const pnpm = fakePnpm(
      `echo 'Steward could not start: rules.yaml line 4: rules[0] "Bad": it is not valid CEL' >&2; exec sleep 30`,
      WEB_UP,
    );
    const r = run([], [pnpm, "/usr/bin", "/bin"]);
    await r.waitFor(/Fix that, then press Ctrl\+C and run pnpm dev again\./);
    expect(r.output()).toMatch(
      /Steward could not start, so the web app has nothing behind it:\n {4}rules\.yaml line 4: rules\[0\] "Bad"/,
    );
    expect(r.output()).not.toMatch(/Steward is ready: open/);
    r.child.kill("SIGINT");
    expect(await r.exit).toBe(0);
  });

  it("fails when a part dies on a signal, rather than exiting 0", async () => {
    const pnpm = fakePnpm("kill -9 $$", WEB_UP);
    const r = run([], [pnpm, "/usr/bin", "/bin"]);
    expect(await r.exit).toBe(1);
    expect(r.output()).toMatch(/server\S*│ stopped by SIGKILL/);
  });
});
