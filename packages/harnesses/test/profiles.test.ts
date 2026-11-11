import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  findProgram,
  harnessEnvironment,
  harnessInfo,
  loadHarnesses,
  notInstalled,
  parseHarnesses,
  withProgramDir,
} from "../src/profiles.ts";

const dir = mkdtempSync(join(tmpdir(), "steward-harness-profiles-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CLAUDE = {
  id: "claude-code",
  name: "Claude Code",
  title: "Anthropic's coding agent",
  kind: "acp",
  command: "claude-agent-acp",
  signIn: "vendor-tool",
};

describe("harnesses.yaml", () => {
  it("reads profiles with their defaults", () => {
    expect(parseHarnesses({ harnesses: [CLAUDE] })).toEqual([{ ...CLAUDE, args: [] }]);
    expect(parseHarnesses(undefined)).toEqual([]);
    writeFileSync(
      join(dir, "harnesses.yaml"),
      "harnesses:\n  - id: gemini-cli\n    name: Gemini CLI\n    kind: acp\n    command: gemini\n    args: [--experimental-acp]\n    signIn: vendor-tool\n",
    );
    expect(loadHarnesses(dir)).toMatchObject([{ id: "gemini-cli", args: ["--experimental-acp"], title: "" }]);
    expect(loadHarnesses(join(dir, "missing"))).toEqual([]);
  });

  it("reads Steward's own tenant, each entry saying how to install it", () => {
    const shipped = loadHarnesses(fileURLToPath(new URL("../../../tenants/steward", import.meta.url)));
    expect(shipped.map((p) => p.id)).toEqual(["claude-code", "gemini-cli", "codex"]);
    for (const p of shipped) expect(p.install, p.id).toMatch(/^npm install -g /);
  });

  it("refuses a profile that would switch the tool's own permission checks off", () => {
    for (const args of [
      ["--dangerously-skip-permissions"],
      ["--permission-mode", "bypassPermissions"],
      ["--sandbox", "danger-full-access"],
      ["--dangerously-bypass-approvals-and-sandbox"],
      ["--yolo"],
      // Gemini CLI's own auto-approval: an agent in yolo mode never asks, so Steward never sees.
      ["--experimental-acp", "-y"],
      ["--approval-mode=yolo"],
      ["--approval-mode", "yolo"],
      ["--approval-mode", "auto_edit"],
      // Codex's approval policy, however it is written.
      ["-c", "approval_policy='never'"],
      ["-c", 'approval_policy="on-request"'],
      ["--config", "approval_policy = never"],
      ["-a", "never"],
      ["--ask-for-approval", "never"],
      ["-c", "sandbox_workspace_write.network_access=true"],
      // Claude Code: a permission mode, or tools allowed without asking.
      ["--permission-mode", "acceptEdits"],
      ["--permission-mode=dontAsk"],
      ["--allowedTools", "Bash"],
      ["--allowed-tools", "run_shell_command"],
      ["--dangerously-allow-everything"],
      // `-y` among other one-letter flags, a value written onto `-a`, and a camel-cased name.
      ["--experimental-acp", "-dy"],
      ["-anever"],
      ["--approvalMode=yolo"],
      // A flag inside one argument, as a shell wrapper writes it.
      ["-c", "gemini --experimental-acp --yolo"],
      ["-c", "exec gemini --approval-mode yolo"],
    ]) {
      expect(() => parseHarnesses({ harnesses: [{ ...CLAUDE, args }] }), args.join(" ")).toThrow(
        /permission checks off/,
      );
    }
  });

  it("keeps the ordinary flags", () => {
    for (const args of [
      ["--experimental-acp"],
      ["app-server", "--listen", "stdio://"],
      ["-m", "gpt-5.6"],
      ["-c", "exec gemini --experimental-acp"],
      ["--approval-mode", "default"],
      ["-d"],
    ]) {
      expect(parseHarnesses({ harnesses: [{ ...CLAUDE, args }] })[0]?.args, args.join(" ")).toEqual(args);
    }
  });

  it("refuses a key written into the file, unknown fields and a repeated id", () => {
    expect(() =>
      parseHarnesses({ harnesses: [{ ...CLAUDE, env: { ANTHROPIC_API_KEY: "sk-ant-abcdefghijk" } }] }),
    ).toThrow(/passEnv/);
    for (const env of [
      { SOME_SETTING: `AIzaSy${"A".repeat(33)}` },
      { SOME_SETTING: `ghp_${"a1".repeat(18)}` },
      { SOME_SETTING: `github_pat_${"a1".repeat(18)}` },
      { GITHUB_TOKEN: "anything" },
      { MY_SECRET: "x" },
      { DB_PASSWORD: "x" },
    ]) {
      expect(() => parseHarnesses({ harnesses: [{ ...CLAUDE, env }] }), JSON.stringify(env)).toThrow(
        /passEnv/,
      );
    }
    expect(
      parseHarnesses({ harnesses: [{ ...CLAUDE, env: { CLAUDE_CODE_USE_VERTEX: "1" } }] })[0]?.env,
    ).toEqual({
      CLAUDE_CODE_USE_VERTEX: "1",
    });
    expect(() => parseHarnesses({ harnesses: [{ ...CLAUDE, mode: "auto" }] })).toThrow(
      /unknown field "mode"/,
    );
    expect(() => parseHarnesses({ harnesses: [CLAUDE, CLAUDE] })).toThrow(/used twice/);
    expect(() => parseHarnesses({ harnesses: [{ ...CLAUDE, id: "Claude Code" }] })).toThrow(/lower case/);
  });
});

describe("availability", () => {
  it("finds a program on PATH or at its absolute path, and only when it can run", () => {
    const bin = join(dir, "bin");
    const tool = join(bin, "fake-tool");
    mkdirSync(bin, { recursive: true });
    writeFileSync(tool, "#!/bin/sh\n");
    chmodSync(tool, 0o755);
    const notExec = join(bin, "not-exec");
    writeFileSync(notExec, "");
    expect(findProgram("fake-tool", { PATH: `/nowhere:${bin}` })).toBe(tool);
    expect(findProgram(tool, {})).toBe(tool);
    expect(findProgram("not-exec", { PATH: bin })).toBeUndefined();
    expect(findProgram("../bin/fake-tool", { PATH: bin })).toBeUndefined();
    expect(
      harnessInfo(parseHarnesses({ harnesses: [{ ...CLAUDE, command: "fake-tool" }] })[0]!, { PATH: bin }),
    ).toMatchObject({
      available: true,
      path: tool,
    });
    const missing = { ...CLAUDE, command: "steward-no-such-tool" };
    expect(harnessInfo(parseHarnesses({ harnesses: [missing] })[0]!, { PATH: bin })).toMatchObject({
      available: false,
      reason:
        'Claude Code is not installed here (Steward looked for "steward-no-such-tool"). Install it, then sign in to it.',
    });
  });

  it("says what to install when the profile says, and never to restart", () => {
    const [profile] = parseHarnesses({
      harnesses: [{ ...CLAUDE, install: "npm install -g @zed-industries/claude-agent-acp@0.23.1" }],
    });
    expect(notInstalled(profile!)).toBe(
      "Claude Code is not installed here. To add it, run: npm install -g @zed-industries/claude-agent-acp@0.23.1, then sign in to it.",
    );
  });

  it("looks in the usual places a short PATH leaves out, and puts the folder on the program's PATH", () => {
    const home = join(dir, "home");
    const local = join(home, ".local", "bin");
    mkdirSync(local, { recursive: true });
    const tool = join(local, "fake-local-tool");
    writeFileSync(tool, "#!/bin/sh\n");
    chmodSync(tool, 0o755);
    expect(findProgram("fake-local-tool", { PATH: "/usr/bin:/bin", HOME: home })).toBe(tool);
    expect(findProgram("fake-local-tool", { PATH: "/usr/bin:/bin" })).toBeUndefined();
    expect(withProgramDir({ PATH: "/usr/bin:/bin", HOME: home }, tool).PATH).toBe(`/usr/bin:/bin:${local}`);
    expect(withProgramDir({ PATH: `${local}:/bin` }, tool).PATH).toBe(`${local}:/bin`);
  });
});

describe("the environment a harness runs with", () => {
  it("passes what a program needs and the real HOME, never Steward's keys unless named", () => {
    const [profile] = parseHarnesses({
      harnesses: [{ ...CLAUDE, passEnv: ["GEMINI_API_KEY"], env: { CLAUDE_CONFIG: "x" } }],
    });
    const env = harnessEnvironment(profile!, {
      PATH: "/usr/bin",
      HOME: "/Users/me",
      OPENROUTER_API_KEY: "sk-or-secret",
      XAI_API_KEY: "xai-secret",
      GEMINI_API_KEY: "g-key",
      NODE_OPTIONS: "--require evil.js",
      LC_ALL: "en_GB.UTF-8",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/me",
      GEMINI_API_KEY: "g-key",
      LC_ALL: "en_GB.UTF-8",
      CLAUDE_CONFIG: "x",
    });
  });
});
