import type { Message } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { isTainted, sanitizeHistory } from "../src/history.ts";

const call = (id: string, name = "web_fetch") => ({
  id,
  type: "function" as const,
  function: { name, arguments: "{}" },
});
const u = (id: string): Message => ({ id, role: "user", content: id });
const a = (id: string, calls: string[], content?: string): Message => ({
  id,
  role: "assistant",
  ...(content ? { content } : {}),
  toolCalls: calls.map((c) => call(c)),
});
const t = (id: string, toolCallId: string, content = '{"ok":true,"data":{}}'): Message => ({
  id,
  role: "tool",
  toolCallId,
  content,
});

describe("sanitizeHistory", () => {
  it("returns a healthy history untouched, message for message", () => {
    const history = [u("u1"), a("a1", ["c1"]), t("t1", "c1"), u("u2")];
    const out = sanitizeHistory(history);
    expect(out).toEqual(history);
    for (const [i, m] of out.entries()) expect(m).toBe(history[i]);
  });

  it("drops a call nobody answered, and the empty assistant message it leaves", () => {
    expect(sanitizeHistory([u("u1"), a("a1", ["c1"]), u("u2")]).map((m) => m.id)).toEqual(["u1", "u2"]);
  });

  it("keeps what the assistant said when it drops the call", () => {
    const out = sanitizeHistory([u("u1"), a("a1", ["c1"], "Looking."), u("u2")]);
    expect(out[1]).toEqual({ id: "a1", role: "assistant", content: "Looking." });
  });

  it("keeps the answered calls of a message and drops the rest", () => {
    const out = sanitizeHistory([u("u1"), a("a1", ["c1", "c2"]), t("t1", "c1"), u("u2")]);
    expect((out[1] as { toolCalls?: unknown[] }).toolCalls).toHaveLength(1);
  });

  it("drops results with no call, results after the next user message, and second answers", () => {
    const history = [
      u("u1"),
      t("t0", "ghost"),
      a("a1", ["c1"]),
      u("u2"),
      t("t1", "c1"),
      a("a2", ["c2"]),
      t("t2", "c2"),
      t("t3", "c2"),
    ];
    expect(sanitizeHistory(history).map((m) => m.id)).toEqual(["u1", "u2", "a2", "t2"]);
  });

  it("keeps calls another part of the run will answer", () => {
    expect(sanitizeHistory([u("u1"), a("a1", ["c1"])], new Set(["c1"])).map((m) => m.id)).toEqual([
      "u1",
      "a1",
    ]);
  });
});

describe("isTainted", () => {
  const taints = (name: string) => name === "web_fetch";

  it("is false with no outside results", () => {
    expect(isTainted([u("u1")], taints)).toBe(false);
    const listed: Message = { id: "a1", role: "assistant", toolCalls: [call("c1", "file_list")] };
    expect(isTainted([u("u1"), listed, t("t1", "c1")], taints)).toBe(false);
  });

  it("is true once a tainting tool returned, including an error", () => {
    expect(isTainted([u("u1"), a("a1", ["c1"]), t("t1", "c1")], taints)).toBe(true);
    expect(isTainted([u("u1"), a("a1", ["c1"]), t("t1", "c1", "Error: timeout")], taints)).toBe(true);
  });

  it("ignores a call that was refused, because it read nothing", () => {
    expect(
      isTainted(
        [u("u1"), a("a1", ["c1"]), t("t1", "c1", '{"ok":false,"refused":true,"message":"no"}')],
        taints,
      ),
    ).toBe(false);
  });
});
