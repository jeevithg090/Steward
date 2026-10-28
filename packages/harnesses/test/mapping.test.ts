import type { PermissionOption, ToolKind } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { lineFilter, updateFrom } from "../src/acp/backend.ts";
import {
  commandOf,
  filterStdoutLine,
  insideWorkspace,
  outcomeFor,
  outputOf,
  permissionFrom,
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
      expect(permission(acp, {}), acp).toMatchObject({ kind, surface });
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
    expect(permission("execute", { command: "ls" }).offersAlways).toBe(true);
  });
});

describe("answering a permission (plan §3)", () => {
  it("chooses the option by its kind", () => {
    expect(outcomeFor("allow_once", OPTIONS)).toEqual({ outcome: "selected", optionId: "a" });
    expect(outcomeFor("allow_always", OPTIONS)).toEqual({ outcome: "selected", optionId: "b" });
    expect(outcomeFor("reject", OPTIONS)).toEqual({ outcome: "selected", optionId: "c" });
    expect(outcomeFor("cancelled", OPTIONS)).toEqual({ outcome: "cancelled" });
  });

  it("falls back to allow once when always is not offered, and never widens a grant", () => {
    const noAlways = OPTIONS.filter((o) => o.kind !== "allow_always");
    expect(outcomeFor("allow_always", noAlways)).toEqual({ outcome: "selected", optionId: "a" });
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
