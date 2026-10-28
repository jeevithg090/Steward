import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  findProgram,
  harnessEnvironment,
  harnessInfo,
  loadHarnesses,
  parseHarnesses,
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

  it("refuses a profile that would switch the tool's own permission checks off", () => {
    for (const args of [
      ["--dangerously-skip-permissions"],
      ["--permission-mode", "bypassPermissions"],
      ["--sandbox", "danger-full-access"],
      ["--dangerously-bypass-approvals-and-sandbox"],
      ["--yolo"],
    ]) {
      expect(() => parseHarnesses({ harnesses: [{ ...CLAUDE, args }] }), args.join(" ")).toThrow(
        /permission checks off/,
      );
    }
  });

  it("refuses a key written into the file, unknown fields and a repeated id", () => {
    expect(() =>
      parseHarnesses({ harnesses: [{ ...CLAUDE, env: { ANTHROPIC_API_KEY: "sk-ant-abcdefghijk" } }] }),
    ).toThrow(/passEnv/);
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
    expect(harnessInfo(parseHarnesses({ harnesses: [CLAUDE] })[0]!, { PATH: bin })).toMatchObject({
      available: false,
      reason:
        'Claude Code is not installed on this computer (Steward looked for "claude-agent-acp"). Install it, sign in to it, then restart Steward.',
    });
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
