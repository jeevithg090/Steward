import { memoryDb } from "@steward/db";
import type { GateCall } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway.ts";
import { summarize } from "../src/summary.ts";
import { toolInfo } from "../src/target.ts";

/** A permission an external coding agent asked for, as packages/harnesses builds it. */
function harnessCall(
  kind: GateCall["tool"]["kind"],
  surface: GateCall["tool"]["surface"],
  target: GateCall["target"],
): GateCall {
  return {
    toolCallId: "tc_1",
    runId: "run_1",
    threadId: "thr_1",
    agentId: "claude-code",
    actorId: "local",
    initiator: { kind: "person", id: "local" },
    tool: { name: "Bash", kind, surface, source: "harness:claude-code" },
    args: {},
    target,
    tainted: true,
  };
}

describe("permissions from external coding agents", () => {
  it("keeps the kind the harness mapping chose, as it does for MCP tools", () => {
    expect(toolInfo("Read", { kind: "read", surface: "file", source: "harness:claude-code" })).toEqual({
      name: "Read",
      kind: "read",
      surface: "file",
      source: "harness:claude-code",
    });
    // An unknown tool from anywhere else is still at least a write.
    expect(toolInfo("Read", { kind: "read", surface: "file", source: "connector:x" }).kind).toBe("write");
  });

  it("runs reads, asks before every command whatever a rule says, and asks outside the workspace", () => {
    const { governance, rules } = createGateway({ db: memoryDb() });
    rules.create({
      name: "Let it run ls",
      effect: "allow",
      when: 'tool.source == "harness:claude-code" && target.command == "ls"',
      description: "",
      source: "person",
      enabled: true,
    });
    expect(governance.dryRun(harnessCall("read", "file", { path: "a.txt" })).effect).toBe("allow");
    expect(governance.dryRun(harnessCall("write", "file", { path: "a.txt" })).effect).toBe("allow");
    expect(governance.dryRun(harnessCall("write", "system", { path: "/etc/hosts" })).effect).toBe("ask");
    const ls = governance.dryRun(harnessCall("shell", "shell", { command: "ls" }));
    expect(ls.effect).toBe("ask");
    expect(ls.rule?.id).toBe("default:taint");
  });

  it("says what the harness wants from the structured target only", () => {
    const tool = (kind: string, surface: string) => ({
      name: "harness_x",
      kind,
      surface,
      source: "harness:gemini-cli",
    });
    expect(summarize({ tool: tool("shell", "shell"), args: {}, target: { command: "npm test" } })).toBe(
      "Run a command: npm test",
    );
    expect(summarize({ tool: tool("write", "file"), args: {}, target: { path: "src/a.ts" } })).toBe(
      "Change src/a.ts",
    );
    expect(summarize({ tool: tool("delete", "file"), args: {}, target: { path: "old.txt" } })).toBe(
      "Delete old.txt",
    );
    expect(summarize({ tool: tool("read", "web"), args: {}, target: { url: "https://example.com" } })).toBe(
      "Fetch https://example.com",
    );
    expect(summarize({ tool: tool("write", "system"), args: { title: "rm -rf /" }, target: {} })).toBe(
      "Use harness_x",
    );
  });
});
