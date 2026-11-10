import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionOption, ToolKind } from "@agentclientprotocol/sdk";
import { memoryDb } from "@steward/db";
import { createGateway } from "@steward/gateway";
import { describe, expect, it } from "vitest";
import { lineFilter, updateFrom } from "../src/acp/backend.ts";
import {
  commandOf,
  filterStdoutLine,
  insideWorkspace,
  isVendorSettings,
  outcomeFor,
  outputOf,
  permissionFrom,
  targetPath,
  toolNameOf,
} from "../src/acp/mapping.ts";

const CWD = "/data/computers/claude-code/workspace";
const OPTIONS: PermissionOption[] = [
  { optionId: "a", name: "Allow", kind: "allow_once" },
  { optionId: "b", name: "Always", kind: "allow_always" },
  { optionId: "c", name: "Reject", kind: "reject_once" },
];

function permission(kind: ToolKind | undefined, rawInput: unknown, extra: Record<string, unknown> = {}) {
  return permissionFrom({ toolCall: { toolCallId: "t1", kind, rawInput, ...extra }, options: OPTIONS }, CWD);
}

describe("the ACP tool kind map (plan §3)", () => {
  it("maps every ACP tool kind to a Steward kind and surface", () => {
    const cases: [ToolKind, string, string][] = [
      ["read", "read", "file"],
      ["search", "read", "file"],
      ["fetch", "read", "web"],
      ["edit", "write", "file"],
      ["move", "write", "file"],
      ["other", "write", "system"],
      ["delete", "delete", "file"],
      ["execute", "shell", "shell"],
      ["think", "ui", "ui"],
      ["switch_mode", "write", "system"],
    ];
    for (const [acp, kind, surface] of cases) {
      expect(permission(acp, { path: "a.md" }), acp).toMatchObject({ kind, surface });
    }
    expect(permission(undefined, {})).toMatchObject({ kind: "write", surface: "system" });
  });

  it("treats any call that carries a command as a shell command, whatever kind it claims", () => {
    expect(permission("read", { command: "rm -rf build" })).toMatchObject({
      kind: "shell",
      surface: "shell",
      target: { command: "rm -rf build" },
    });
    expect(permission("think", { cmd: ["git", "push", "--force"] }).target.command).toBe("git push --force");
    expect(commandOf({ command: "  " })).toBeUndefined();
    expect(commandOf("ls")).toBeUndefined();
  });

  it("takes the path from locations, relative to the workspace, and asks for changes outside it", () => {
    expect(permission("edit", {}, { locations: [{ path: `${CWD}/notes/a.md` }] })).toMatchObject({
      kind: "write",
      surface: "file",
      target: { path: "notes/a.md" },
    });
    expect(permission("edit", { file_path: "/etc/hosts" })).toMatchObject({
      surface: "system",
      target: { path: "/etc/hosts" },
    });
    expect(permission("edit", {}, { locations: [{ path: `${CWD}/../../escape.txt` }] }).surface).toBe(
      "system",
    );
    expect(insideWorkspace(`${CWD}/a/../b.txt`, CWD)).toBe("b.txt");
    expect(insideWorkspace("/elsewhere", CWD)).toBeUndefined();
    expect(permission("fetch", { url: "https://example.com/a" }).target).toEqual({
      url: "https://example.com/a",
    });
  });

  it("reads both ends of a move and every path in a list, so a change outside asks", () => {
    // Judged by the folder that holds both ends: here the whole disk, so no folder rule allows it.
    expect(
      permission("move", { source: "/Users/me/important", destination: "trash/important" }),
    ).toMatchObject({ kind: "write", surface: "system", target: { path: "/" } });
    expect(permission("move", { from: "a.md", to: "/tmp/a.md" }).surface).toBe("system");
    expect(permission("edit", { old_path: "/etc/hosts", new_path: "hosts" }).surface).toBe("system");
    expect(permission("edit", { paths: ["a.md", "/etc/hosts"] }).surface).toBe("system");
    expect(permission("edit", { files: [{ path: "a.md" }, { path: "/etc/hosts" }] }).surface).toBe("system");
    expect(permission("edit", { paths: ["a.md", "b/c.md"] })).toMatchObject({
      surface: "file",
      target: { path: "./" },
    });
  });

  it("judges a change to several paths by the folder that holds them all, never by the first", () => {
    expect(targetPath(["src/a.ts"], CWD)).toBe("src/a.ts");
    expect(targetPath(["src/a.ts", `${CWD}/src/a.ts`], CWD)).toBe("src/a.ts");
    expect(targetPath(["src/a.ts", "src/lib/b.ts"], CWD)).toBe("src/");
    expect(targetPath(["/srv/project/a.ts", "/srv/project/lib/b.ts"], CWD)).toBe("/srv/project/");
    expect(targetPath(["/srv/project/a.ts", "/srv/projects-old/b.ts"], CWD)).toBe("/srv/");
    expect(targetPath(["/srv/project/a.ts", "/etc/hosts"], CWD)).toBe("/");
    expect(targetPath([], CWD)).toBeUndefined();

    // A rule that lets the agent work on /srv/project/ does not reach /etc/hosts by listing it second.
    const { governance, rules } = createGateway({ db: memoryDb() });
    rules.create({
      name: "Work on the project",
      effect: "allow",
      when: 'tool.source == "harness:claude-code" && startsWith(target.path, "/srv/project/")',
      description: "",
      source: "person",
      enabled: true,
    });
    const decide = (rawInput: unknown) => {
      const p = permission("edit", rawInput);
      return governance.dryRun({
        toolCallId: "t1",
        runId: "r1",
        threadId: "th1",
        agentId: "claude-code",
        actorId: "local",
        initiator: { kind: "person", id: "local" },
        tool: { name: p.toolName, kind: p.kind, surface: p.surface, source: "harness:claude-code" },
        args: p.args,
        target: p.target,
        tainted: true,
      }).effect;
    };
    expect(decide({ paths: ["/srv/project/a.ts", "/srv/project/lib/b.ts"] })).toBe("allow");
    expect(decide({ paths: ["/srv/project/a.ts", "/etc/hosts"] })).toBe("ask");
  });

  it("asks when a change names no path at all (fail closed)", () => {
    for (const kind of ["edit", "move", "delete"] as const) {
      expect(permission(kind, { content: "x" }).surface, kind).toBe("system");
    }
    // Reading names no path either, but reading runs: it changes nothing.
    expect(permission("read", {})).toMatchObject({ kind: "read", surface: "file" });
  });

  it("asks before a change to a vendor tool's own settings, even inside the workspace", () => {
    for (const path of [
      ".claude/settings.json",
      ".gemini/settings.json",
      ".codex/config.toml",
      ".mcp.json",
    ]) {
      expect(permission("edit", { file_path: path }).surface, path).toBe("system");
      expect(isVendorSettings(`${CWD}/${path}`)).toBe(true);
    }
    expect(permission("read", { file_path: ".claude/settings.json" }).surface).toBe("file");
    expect(isVendorSettings("notes/claude.md")).toBe(false);
  });

  it("counts a link inside the workspace that leads out of it as outside", () => {
    const root = mkdtempSync(join(tmpdir(), "steward-ws-"));
    try {
      const ws = join(root, "workspace");
      const outside = join(root, "outside");
      mkdirSync(ws);
      mkdirSync(outside);
      symlinkSync(outside, join(ws, "link"));
      expect(insideWorkspace("link/secret.txt", ws)).toBeUndefined();
      expect(insideWorkspace(join(ws, "link"), ws)).toBeUndefined();
      // A file not written yet is judged by the folder it would be in.
      expect(insideWorkspace("new/notes.md", ws)).toBe(join("new", "notes.md"));
      const p = permissionFrom(
        {
          toolCall: { toolCallId: "t", kind: "edit", rawInput: { file_path: "link/secret.txt" } },
          options: [],
        },
        ws,
      );
      expect(p.surface).toBe("system");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never reads the title: neither the name, the arguments nor the target come from it", () => {
    const p = permissionFrom(
      {
        toolCall: {
          toolCallId: "t1",
          kind: "read",
          title: "Run rm -rf / now",
          rawInput: { path: "a.txt" },
        } as never,
        options: OPTIONS,
      },
      CWD,
    );
    expect(JSON.stringify(p)).not.toContain("rm -rf");
    expect(p).toMatchObject({ toolName: "harness_read", kind: "read", target: { path: "a.txt" } });
  });

  it("names a tool by the harness's own name, then its _meta, then its kind", () => {
    expect(toolNameOf({ name: "Bash", kind: "execute" })).toBe("Bash");
    expect(toolNameOf({ kind: "edit", _meta: { claudeCode: { toolName: "Edit" } } })).toBe("Edit");
    expect(toolNameOf({ kind: "execute" })).toBe("harness_execute");
    expect(toolNameOf({})).toBe("harness_other");
  });

  it("keeps the structured input as the arguments", () => {
    expect(permission("execute", { command: "ls", timeout: 5 }).args).toEqual({ command: "ls", timeout: 5 });
    expect(permission("execute", "ls").args).toEqual({ input: "ls" });
  });
});

describe("answering a permission (plan §3)", () => {
  it("chooses the option by its kind, and never the harness's own Always", () => {
    expect(outcomeFor("allow_once", OPTIONS)).toEqual({ outcome: "selected", optionId: "a" });
    expect(outcomeFor("reject", OPTIONS)).toEqual({ outcome: "selected", optionId: "c" });
    expect(outcomeFor("cancelled", OPTIONS)).toEqual({ outcome: "cancelled" });
  });

  it("never widens a grant", () => {
    const onlyAlways: PermissionOption[] = [{ optionId: "b", name: "Always", kind: "allow_always" }];
    expect(outcomeFor("allow_once", onlyAlways)).toEqual({ outcome: "cancelled" });
    expect(outcomeFor("reject", [{ optionId: "r", name: "Never", kind: "reject_always" }])).toEqual({
      outcome: "selected",
      optionId: "r",
    });
    expect(outcomeFor("reject", [])).toEqual({ outcome: "cancelled" });
  });
});

describe("session updates", () => {
  it("turns text, thoughts and tool calls into Steward's updates, and ignores the rest", () => {
    expect(
      updateFrom({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi" },
        messageId: "m1",
      }),
    ).toEqual([{ type: "text", delta: "Hi", messageId: "m1" }]);
    expect(
      updateFrom({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Hmm" } }),
    ).toEqual([{ type: "thought", delta: "Hmm" }]);
    expect(
      updateFrom({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Do a thing",
        kind: "execute",
        rawInput: { command: "ls" },
      }),
    ).toEqual([{ type: "tool_start", callId: "t1", name: "harness_execute", input: { command: "ls" } }]);
    expect(
      updateFrom({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "a.txt" } }],
      }),
    ).toEqual([{ type: "tool_end", callId: "t1", ok: true, output: "a.txt" }]);
    expect(
      updateFrom({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" }),
    ).toEqual([]);
    expect(updateFrom({ sessionUpdate: "plan", entries: [] } as never)).toEqual([]);
    expect(outputOf([{ type: "diff", path: "a.md", newText: "x" }], undefined)).toBe("Changed a.md");
    expect(outputOf(undefined, { code: 0 })).toBe('{"code":0}');
  });
});

describe("the stdout line filter (from Happy)", () => {
  it("keeps JSON objects and arrays and drops banners and noise", () => {
    expect(filterStdoutLine('{"jsonrpc":"2.0"}')).toBe('{"jsonrpc":"2.0"}');
    expect(filterStdoutLine("[1,2]")).toBe("[1,2]");
    expect(filterStdoutLine("Loaded cached credentials.")).toBeNull();
    expect(filterStdoutLine("{not json")).toBeNull();
    expect(filterStdoutLine("")).toBeNull();
  });

  it("filters a byte stream line by line, across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('banner line\n{"a":'));
        controller.enqueue(encoder.encode('1}\nmore noise\n{"b":2}'));
        controller.close();
      },
    });
    const text = await new Response(source.pipeThrough(lineFilter(filterStdoutLine))).text();
    expect(text).toBe('{"a":1}\n{"b":2}\n');
  });
});
