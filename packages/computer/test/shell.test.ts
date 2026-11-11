import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clampTimeout,
  removeStaleHomes,
  runShell,
  SHELL_OUTPUT_LIMIT,
  shellEnvironment,
} from "../src/shell.ts";

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
const has = (tool: string) => spawnSync("/bin/sh", ["-c", `command -v ${tool}`]).status === 0;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("runShell", () => {
  it("runs bash in the workspace and reports the exit code and both streams", async () => {
    const result = await runShell("pwd; echo out; echo err >&2; exit 3", { cwd: dir, tmpDir: tmp });
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe(`${dir}\nout\n`);
    expect(result.stderr).toBe("err\n");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes only allow-listed variables, with a HOME of the command's own outside the workspace", async () => {
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
    const home = env.HOME ?? "";
    expect(home.startsWith(join(tmp, "home-"))).toBe(true);
    expect(env.XDG_CONFIG_HOME).toBe(join(home, ".config"));
    expect(env.XDG_DATA_HOME).toBe(join(home, ".local", "share"));
    expect(env.XDG_STATE_HOME).toBe(join(home, ".local", "state"));
    expect(env.XDG_CACHE_HOME).toBe(join(home, ".cache"));
    expect(env.PYTHONNOUSERSITE).toBe("1");
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
      { BASH_ENV: "x", LD_PRELOAD: "y", DYLD_INSERT_LIBRARIES: "z", LC_CTYPE: "UTF-8", HOME: "/Users/x" },
      join(tmp, "home-a"),
      tmp,
    );
    expect(env).toMatchObject({ HOME: join(tmp, "home-a"), TMPDIR: tmp, LC_CTYPE: "UTF-8" });
    expect(Object.keys(env)).not.toContain("BASH_ENV");
    expect(Object.keys(env)).not.toContain("LD_PRELOAD");
    expect(Object.keys(env)).not.toContain("DYLD_INSERT_LIBRARIES");
  });

  it("gives every command a fresh, empty HOME and removes it afterwards", async () => {
    const first = await runShell('ls -A "$HOME"; echo "$HOME"; touch "$HOME/left-behind"', {
      cwd: dir,
      tmpDir: tmp,
    });
    const home = first.stdout.trim();
    expect(home.startsWith(join(tmp, "home-"))).toBe(true);
    expect(await exists(home)).toBe(false);
    const second = await runShell('ls -A "$HOME"; echo "$HOME"', { cwd: dir, tmpDir: tmp });
    expect(second.stdout.trim()).not.toBe(home);
    expect(second.stdout).not.toContain("left-behind");
  });

  it("ignores config files saved in the workspace that a HOME there would have read", async () => {
    // file_write saves these without asking; none of them may change what a command runs.
    await writeFile(join(dir, ".gitconfig"), "[user]\n\tname = Planted\n[alias]\n\tst = !echo PLANTED\n");
    await mkdir(join(dir, ".config", "git"), { recursive: true });
    await writeFile(join(dir, ".config", "git", "config"), "[user]\n\temail = planted@example.com\n");
    if (has("git")) {
      const git = await runShell("git config --global user.name; git config --global user.email; echo done", {
        cwd: dir,
        tmpDir: tmp,
      });
      expect(git.stdout).toBe("done\n");
    }
    if (has("python3")) {
      // Where Python's user site would be with HOME set to the workspace.
      const site = spawnSync("python3", ["-c", "import site; print(site.getusersitepackages())"], {
        env: { PATH: process.env.PATH ?? "", HOME: dir },
        encoding: "utf8",
      }).stdout.trim();
      expect(site.startsWith(dir)).toBe(true);
      await mkdir(site, { recursive: true });
      await writeFile(join(site, "zz_planted.pth"), 'import sys; sys.stderr.write("PLANTED CODE RAN\\n")\n');
      const py = await runShell("python3 -c 'print(2 + 2)'", { cwd: dir, tmpDir: tmp });
      expect(py.stdout).toBe("4\n");
      expect(py.stderr).not.toContain("PLANTED");
    }
  });

  it("clears HOME folders left by an earlier process, and nothing else", async () => {
    const left = join(tmp, "home-stale");
    await mkdir(join(left, ".config"), { recursive: true });
    await writeFile(join(tmp, "keep.txt"), "x");
    await removeStaleHomes(tmp);
    expect(await exists(left)).toBe(false);
    expect(await exists(join(tmp, "keep.txt"))).toBe(true);
  });

  it("kills running commands when the server process dies", async () => {
    const pidFile = join(dir, "orphan.pid");
    const script = join(dir, "crash.mts");
    const shell = join(dirname(fileURLToPath(import.meta.url)), "../src/shell.ts");
    await writeFile(
      script,
      [
        `import { existsSync } from "node:fs";`,
        `import { runShell } from ${JSON.stringify(shell)};`,
        `void runShell(${JSON.stringify(`echo $$ > "${pidFile}"; exec sleep 30`)}, { cwd: ${JSON.stringify(dir)}, tmpDir: ${JSON.stringify(tmp)} });`,
        `const wait = setInterval(() => { if (existsSync(${JSON.stringify(pidFile)})) { clearInterval(wait); setTimeout(() => { throw new Error("crash"); }, 50); } }, 20);`,
      ].join("\n"),
    );
    const tsx = join(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/.bin/tsx");
    const child = spawn(tsx, [script], { stdio: "ignore" });
    const code = await new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
    expect(code).not.toBe(0);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    expect(pid).toBeGreaterThan(0);
    const end = Date.now() + 3_000;
    while (alive(pid) && Date.now() < end) await delay(50);
    expect(alive(pid)).toBe(false);
  }, 30_000);

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
