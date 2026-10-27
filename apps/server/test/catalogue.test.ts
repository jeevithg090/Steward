import { type BaseEvent, EventType } from "@ag-ui/client";
import { TOOLS } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { clip, interruptSummary, summariseRun } from "../src/runtime/run-summary.ts";
import {
  buildDryRunCall,
  builtinToolList,
  describeTool,
  outboundOf,
  resolveTarget,
} from "../src/tools/catalogue.ts";

describe("tool catalogue", () => {
  it("describes every built-in tool in words for the person", () => {
    const list = builtinToolList();
    expect(list).toHaveLength(Object.keys(TOOLS).length);
    for (const tool of list) expect(tool.description).toMatch(/^[A-Z].+\.$/);
    expect(list.find((t) => t.name === "mail_send")).toEqual({
      name: "mail_send",
      description: "Sends an email.",
      kind: "send",
      surface: "mail",
    });
  });

  it("fails closed: an unknown tool is a write, an MCP tool is a write unless marked a read", () => {
    expect(describeTool("format_disk")).toEqual({
      name: "format_disk",
      kind: "write",
      surface: "system",
      source: "unknown",
    });
    expect(describeTool("mcp__notes__search")).toMatchObject({
      kind: "write",
      surface: "mcp",
      source: "mcp:notes",
    });
    expect(describeTool("mcp__notes__search", () => "read").kind).toBe("read");
    expect(describeTool("browser_snapshot")).toEqual({
      name: "browser_snapshot",
      kind: "read",
      surface: "browser",
      source: "builtin",
    });
  });

  it("resolves the target rules look at", () => {
    expect(
      resolveTarget("mail_send", {
        to: ["sam@example.com", { email: "kim@example.com" }],
        cc: "a@b.co; c@d.co",
      }),
    ).toEqual({
      recipients: ["sam@example.com", "kim@example.com", "a@b.co", "c@d.co"],
    });
    expect(resolveTarget("browser_navigate", { url: "news.ycombinator.com/item?id=1" })).toEqual({
      url: "news.ycombinator.com/item?id=1",
      host: "news.ycombinator.com",
    });
    expect(resolveTarget("browser_click", { ref: "e12", element: "Place order" })).toEqual({
      element: { ref: "e12", name: "Place order" },
    });
    expect(resolveTarget("mcp__bank__pay", { amount: { value: 2000, currency: "GBP" } })).toEqual({
      amount: { value: 2000, currency: "GBP" },
      mcp: { server: "bank", tool: "pay" },
    });
    expect(outboundOf("mail_send", { subject: "Hi", body: "Card 4242 4242 4242 4242" })).toBe(
      "Hi\nCard 4242 4242 4242 4242",
    );
  });

  it("builds a dry-run call that is a person's unless asked otherwise", () => {
    const call = buildDryRunCall(
      { tool: "shell_run", args: { command: "ls" }, tainted: true, initiator: "routine" },
      { agentId: "steward", actorId: "local" },
    );
    expect(call).toMatchObject({
      agentId: "steward",
      actorId: "local",
      initiator: { kind: "routine" },
      tool: { name: "shell_run", kind: "shell", surface: "shell" },
      target: { command: "ls" },
      tainted: true,
      outbound: "ls",
    });
    expect(call.toolCallId).toMatch(/^dry_/);
  });
});

describe("run summaries", () => {
  const started = { type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as BaseEvent;
  it("reads text, interrupts and refusals", () => {
    const events = [
      started,
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "m0",
        toolCallId: "c",
        content: JSON.stringify(JSON.stringify({ ok: false, refused: true, message: "No sending." })),
      },
      { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "OK, I didn't " },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "send it." },
      { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
      { type: EventType.RUN_FINISHED, threadId: "t", runId: "r" },
    ] as BaseEvent[];
    expect(summariseRun(events)).toEqual({
      outcome: "success",
      interrupts: [],
      text: "OK, I didn't send it.",
      refusals: ["No sending."],
    });
    const parked = summariseRun([
      started,
      {
        type: EventType.RUN_FINISHED,
        threadId: "t",
        runId: "r",
        outcome: {
          type: "interrupt",
          interrupts: [
            { id: "c1", reason: "steward_approval", metadata: { summary: "Send an email to sam" } },
          ],
        },
      } as BaseEvent,
    ]);
    expect(parked.outcome).toBe("interrupt");
    expect(interruptSummary(parked)).toBe("Send an email to sam");
    expect(
      summariseRun([started, { type: EventType.RUN_ERROR, message: "model down" } as BaseEvent]).error,
    ).toBe("model down");
    expect(summariseRun([started], "aborted").outcome).toBe("error");
  });

  it("clips long text", () => {
    expect(clip("a  b\n c")).toBe("a b c");
    expect(clip("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
