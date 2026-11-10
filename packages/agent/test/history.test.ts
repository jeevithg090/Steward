import type { Message } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { budgetHistory, isTainted, LEFT_OUT, sanitizeHistory } from "../src/history.ts";

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

describe("budgetHistory", () => {
  const big = (n: number, tag = "x") =>
    JSON.stringify({ ok: true, data: { untrusted: true, data: tag.repeat(n) } });
  const named = (id: string, name: string, args = "{}"): Message => ({
    id,
    role: "assistant",
    toolCalls: [{ id: `c_${id}`, type: "function", function: { name, arguments: args } }],
  });
  const result = (id: string, content: string): Message => ({
    id: `t_${id}`,
    role: "tool",
    toolCallId: `c_${id}`,
    content,
  });
  const omitted = (m: Message | undefined) => {
    const content = (m as { content?: unknown } | undefined)?.content;
    return typeof content === "string" && content.includes(LEFT_OUT);
  };
  /** One turn: the person asks, the model calls a tool, the tool answers, the model replies. */
  const turn = (n: number, tool = "web_fetch", content = big(3_000)): Message[] => [
    u(`u${n}`),
    named(`a${n}`, tool),
    result(`a${n}`, content),
    { id: `r${n}`, role: "assistant", content: `Reply ${n}.` },
  ];

  it("leaves a history that fits as it was, message for message", () => {
    const history = [...turn(1), ...turn(2)];
    const out = budgetHistory(history, 1_000_000);
    expect(out.droppedTurns).toBe(false);
    for (const [i, m] of out.messages.entries()) expect(m).toBe(history[i]);
  });

  it("leaves out big results older than the last three turns, but keeps failures and small ones", () => {
    const failure = JSON.stringify({ ok: false, error: "e".repeat(5_000) });
    const history = [
      ...turn(1),
      ...turn(2, "file_list", '{"ok":true,"data":[]}'),
      ...turn(3, "web_fetch", failure),
      ...turn(4),
      ...turn(5),
      ...turn(6),
    ];
    const out = budgetHistory(history, 1_000_000).messages;
    const byId = new Map(out.map((m) => [m.id, m]));
    expect(omitted(byId.get("t_a1"))).toBe(true);
    expect(byId.get("t_a2")).toBe(history[6]);
    expect(byId.get("t_a3")).toBe(history[10]);
    for (const id of ["t_a4", "t_a5", "t_a6"]) expect(omitted(byId.get(id))).toBe(false);
    expect(JSON.parse(String((byId.get("t_a1") as { content: string }).content))).toEqual({
      ok: true,
      data: { omitted: true, note: LEFT_OUT },
    });
  });

  it("keeps only the newest three browser snapshots whole, even within one turn", () => {
    const steps = [1, 2, 3, 4, 5].flatMap((n) => [
      named(`b${n}`, "browser_snapshot"),
      result(`b${n}`, big(1_500)),
    ]);
    const out = budgetHistory([u("u1"), ...steps], 1_000_000).messages;
    const tools = out.filter((m) => m.role === "tool");
    expect(tools.map(omitted)).toEqual([true, true, false, false, false]);
  });

  it("cuts long text in old calls' arguments to its start, as valid JSON", () => {
    const page = JSON.stringify({ title: "Plan", format: "markdown", content: "p".repeat(10_000) });
    const history = [
      u("u1"),
      named("a1", "make_page", page),
      result("a1", '{"ok":true,"data":{"path":"made/plan.md"}}'),
      ...turn(2),
      ...turn(3),
      ...turn(4),
    ];
    const out = budgetHistory(history, 1_000_000).messages;
    const call = (out[1] as { toolCalls: { function: { arguments: string } }[] }).toolCalls[0];
    const args = JSON.parse(call?.function.arguments ?? "{}") as Record<string, string>;
    expect(args.title).toBe("Plan");
    expect(args.content).toMatch(/^p{200}… \[9800 more characters left out to save room\]$/);
  });

  it("leaves out the oldest whole turns when it is still too long, never the latest", () => {
    const history = Array.from({ length: 10 }, (_, i) => turn(i + 1, "file_list", big(1_000))).flat();
    const out = budgetHistory(history, 5_000);
    expect(out.droppedTurns).toBe(true);
    expect(out.messages[0]?.role).toBe("user");
    expect(out.messages.at(-1)).toBe(history.at(-1));
    const size = out.messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
    expect(size).toBeLessThan(10_000);
    // Calls and their results stay in pairs.
    expect(sanitizeHistory(out.messages)).toEqual(out.messages);

    const huge = turn(1, "file_list", big(50_000));
    expect(budgetHistory(huge, 5_000).messages).toHaveLength(huge.length);
  });

  it("leaves out big results of the latest turn when that alone is too long, except the latest step's", () => {
    const steps = [1, 2, 3].flatMap((n) => [named(`f${n}`, "file_read"), result(`f${n}`, big(20_000))]);
    const out = budgetHistory([u("u1"), ...steps], 30_000).messages;
    expect(out.filter((m) => m.role === "tool").map(omitted)).toEqual([true, true, false]);
  });
});
