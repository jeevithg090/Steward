import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clampTimeout, runShell, SHELL_OUTPUT_LIMIT, shellEnvironment } from "../src/shell.ts";

let dir: string;
let tmp: string;

beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "steward-shell-")));
  tmp = join(dir, ".tmp");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runShell", () => {
  it("runs bash in the workspace and reports the exit code and both streams", async () => {
    const result = await runShell("pwd; echo out; echo err >&2; exit 3", { cwd: dir, tmpDir: tmp });
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe(`${dir}\nout\n`);
    expect(result.stderr).toBe("err\n");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes only allow-listed variables, with HOME set to the workspace", async () => {
    const result = await runShell("env", {
      cwd: dir,
      tmpDir: tmp,
      baseEnv: {
        PATH: process.env.PATH,
        LANG: "en_GB.UTF-8",
        LC_ALL: "C",
        TZ: "Europe/London",
        HOME: "/Users/someone",
        OPENROUTER_API_KEY: "sk-or-should-not-leak",
        GITHUB_TOKEN: "ghp_should_not_leak",
        BASH_ENV: "/tmp/evil.sh",
        NODE_OPTIONS: "--require /tmp/evil.js",
      },
    });
    const env = Object.fromEntries(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    expect(env.HOME).toBe(dir);
    expect(env.TMPDIR).toBe(tmp);
    expect(env.LANG).toBe("en_GB.UTF-8");
    expect(env.LC_ALL).toBe("C");
    expect(env.TZ).toBe("Europe/London");
    expect(result.stdout).not.toContain("should-not-leak");
    expect(result.stdout).not.toContain("should_not_leak");
    expect(env.BASH_ENV).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("never passes loader or bash hooks, even when asked", () => {
    const env = shellEnvironment(
      { BASH_ENV: "x", LD_PRELOAD: "y", DYLD_INSERT_LIBRARIES: "z", LC_CTYPE: "UTF-8" },
      dir,
      tmp,
    );
    expect(env).toMatchObject({ HOME: dir, TMPDIR: tmp, LC_CTYPE: "UTF-8" });
    expect(Object.keys(env)).not.toContain("BASH_ENV");
    expect(Object.keys(env)).not.toContain("LD_PRELOAD");
    expect(Object.keys(env)).not.toContain("DYLD_INSERT_LIBRARIES");
  });

  it("kills the whole process group on timeout", async () => {
    const marker = join(dir, "late.txt");
    const started = Date.now();
    const result = await runShell(`(sleep 2; touch "${marker}") & sleep 30`, {
      cwd: dir,
      tmpDir: tmp,
      timeoutMs: 1000,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
    await delay(1500);
    expect(await exists(marker)).toBe(false);
  });

  it("ends background jobs with the command", async () => {
    const marker = join(dir, "background.txt");
    const result = await runShell(`(sleep 1; touch "${marker}") & echo started`, { cwd: dir, tmpDir: tmp });
    expect(result.stdout).toBe("started\n");
    await delay(1500);
    expect(await exists(marker)).toBe(false);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    const result = await runShell("sleep 30", { cwd: dir, tmpDir: tmp, signal: controller.signal });
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("keeps the last 64 KiB of long output", async () => {
    const result = await runShell("head -c 200000 /dev/zero | tr '\\0' 'a'; echo END", {
      cwd: dir,
      tmpDir: tmp,
    });
    expect(result.stdout.startsWith("[… earlier output cut …]\n")).toBe(true);
    expect(result.stdout.endsWith("aEND\n")).toBe(true);
    const body = result.stdout.slice("[… earlier output cut …]\n".length);
    expect(Buffer.byteLength(body)).toBe(SHELL_OUTPUT_LIMIT);
  });

  it("refuses empty commands and clamps timeouts", async () => {
    await expect(runShell("  ", { cwd: dir, tmpDir: tmp })).rejects.toThrow(/Give a command/);
    expect(clampTimeout(undefined)).toBe(120_000);
    expect(clampTimeout(10)).toBe(1_000);
    expect(clampTimeout(10_000_000)).toBe(600_000);
  });
});
