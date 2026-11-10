import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { describe, expect, it } from "vitest";
import { RULE_WHEN_MAX, scopeToBot } from "../src/scope.ts";
import { validatePack } from "../src/validate.ts";

const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);

/** The neutral context with a tool kind and an agent id, as the gateway builds it for a call. */
function call(kind: string, agentId: string): Record<string, unknown> {
  const context = neutralContext() as { tool: { kind: string }; agent: { id: string } };
  context.tool.kind = kind;
  context.agent.id = agentId;
  return context as unknown as Record<string, unknown>;
}

describe("scopeToBot", () => {
  it("limits a rule to the bot's own agent", () => {
    const when = scopeToBot("expense-review", 'tool.kind == "send"');
    expect(when).toBe('agent.id == "expense-review" && (tool.kind == "send"\n)');
    expect(engine.test(when, call("send", "expense-review"))).toBe(true);
    expect(engine.test(when, call("send", "steward"))).toBe(false);
    expect(engine.test(when, call("write", "expense-review"))).toBe(false);
  });

  it("cannot be widened by the pack's condition", () => {
    // A rule that matches everything still matches only the bot.
    expect(engine.test(scopeToBot("a", "true"), call("read", "steward"))).toBe(false);
    // One that names another agent never matches at all.
    const other = scopeToBot("a", 'agent.id == "steward"');
    expect(engine.test(other, call("send", "steward"))).toBe(false);
    expect(engine.test(other, call("send", "a"))).toBe(false);
    // An `||` keeps its place inside the brackets.
    const either = scopeToBot("a", 'tool.kind == "send" || tool.kind == "write"');
    expect(engine.test(either, call("write", "steward"))).toBe(false);
    expect(engine.test(either, call("write", "a"))).toBe(true);
    // A comment at the end of the condition cannot swallow the closing bracket.
    const commented = scopeToBot("a", 'tool.kind == "send" // ) || true');
    expect(() => engine.validate(commented)).not.toThrow();
    expect(engine.test(commented, call("send", "steward"))).toBe(false);
  });

  it("relies on the condition parsing on its own, which the validator checks first", () => {
    // Closing the bracket from inside would widen the rule once wrapped, so it must never get there.
    const breakout = "true) || (true";
    expect(() => engine.validate(breakout)).toThrow();
    const result = validatePack(
      {
        id: "a",
        name: "A",
        pitch: "A.",
        category: "misc",
        version: 1,
        author: { kind: "person", handle: "sam" },
        licence: "MIT",
        needs: { tools: [], connectors: [], model: "any" },
        instructions: "Help.",
        rules: [{ name: "Escape", effect: "deny", when: breakout }],
      },
      { tools: [], validateRule: (when) => engine.validate(when) },
    );
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.path)).toEqual(["rules[0].when"]);
  });

  it("refuses an id that is not a bot id", () => {
    expect(() => scopeToBot('a" || true || "', "true")).toThrow(/not a bot id/);
    expect(() => scopeToBot("Upper", "true")).toThrow(/not a bot id/);
    expect(() => scopeToBot("a--b", "true")).toThrow(/not a bot id/);
  });
});

describe("validatePack and scoped rules", () => {
  const pack = {
    id: "rent-scout",
    name: "Rent Scout",
    pitch: "Finds rentals.",
    category: "home",
    version: 1,
    author: { kind: "person", handle: "sam" },
    licence: "MIT",
    needs: { tools: [], connectors: [], model: "any" },
    instructions: "Help one person find a place to rent.",
  };
  const ctx = { tools: [], validateRule: (when: string) => engine.validate(when) };

  it("checks each rule as it will be installed, limited to the bot", () => {
    const seen: string[] = [];
    const result = validatePack(
      { ...pack, rules: [{ name: "Never pay", effect: "deny", when: 'tool.kind == "pay"' }] },
      { tools: [], validateRule: (when) => seen.push(when) },
    );
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['tool.kind == "pay"', scopeToBot("rent-scout", 'tool.kind == "pay"')]);
  });

  it("refuses a rule that is too long once it is limited to the bot", () => {
    const long = `tool.name == "${"x".repeat(RULE_WHEN_MAX - 20)}"`;
    expect(long.length).toBeLessThanOrEqual(RULE_WHEN_MAX);
    const result = validatePack({ ...pack, rules: [{ name: "Long", effect: "ask", when: long }] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      {
        path: "rules[0].when",
        message: "is too long: limited to this bot it would be over 2,000 characters",
        severity: "error",
      },
    ]);
  });
});
