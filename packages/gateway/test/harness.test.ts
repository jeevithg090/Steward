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
      "Use a tool it did not name",
    );
  });

  it("says when a change is outside its folder, lists the files, and names a wider sandbox", () => {
    const codex = (kind: string, surface: string) => ({
      name: "apply_patch",
      kind,
      surface,
      source: "harness:codex",
    });
    expect(
      summarize({
        tool: codex("write", "system"),
        args: { files: ["/Users/me/.ssh/config"] },
        target: { path: "/Users/me/.ssh/config" },
      }),
    ).toBe("Change /Users/me/.ssh/config, outside its own folder");
    expect(
      summarize({
        tool: codex("write", "file"),
        args: { files: ["src/a.ts", "src/b.ts", "README.md"] },
        target: { path: "src/a.ts" },
      }),
    ).toBe("Change 3 files: src/a.ts, src/b.ts and 1 other");
    expect(
      summarize({
        tool: codex("delete", "file"),
        args: { files: ["src/a.ts", "README.md"] },
        target: { path: "src/a.ts" },
      }),
    ).toBe("Change 2 files: src/a.ts and README.md, deleting or moving some");
    expect(
      summarize({
        tool: codex("write", "system"),
        args: { files: ["src/a.ts"], grantRoot: "/Users/me" },
        target: { path: "src/a.ts" },
      }),
    ).toBe("Change src/a.ts. It also asks to change anything in /Users/me for the rest of this session");
    // A tool on one of Codex's own MCP servers, and edits the agent did not describe.
    expect(
      summarize({
        tool: { name: "mcp__github__create_issue", kind: "write", surface: "mcp", source: "harness:codex" },
        args: {},
        target: { mcp: { server: "github", tool: "create_issue" } },
      }),
    ).toBe("Use create_issue on github");
    expect(
      summarize({
        tool: { name: "harness_edit", kind: "write", surface: "system", source: "harness:gemini-cli" },
        args: {},
        target: {},
      }),
    ).toBe("Change files it did not name");
    // Several paths without a list: the folder that holds them all.
    expect(
      summarize({
        tool: { name: "Edit", kind: "write", surface: "system", source: "harness:claude-code" },
        args: { paths: ["/srv/project/a.ts", "/etc/hosts"] },
        target: { path: "/" },
      }),
    ).toBe("Change files in /, outside its own folder");
    expect(
      summarize({
        tool: { name: "Delete", kind: "delete", surface: "file", source: "harness:claude-code" },
        args: {},
        target: { path: "src/" },
      }),
    ).toBe("Delete files in src/");
    // The workspace itself is its own folder, never "./".
    expect(
      summarize({
        tool: { name: "Edit", kind: "write", surface: "file", source: "harness:claude-code" },
        args: { paths: ["a.md", "b.md"] },
        target: { path: "./" },
      }),
    ).toBe("Change files in its own folder");
    expect(
      summarize({
        tool: { name: "harness_switch_mode", kind: "write", surface: "system", source: "harness:gemini-cli" },
        args: {},
        target: {},
      }),
    ).toBe("Change how it works");
  });
});
