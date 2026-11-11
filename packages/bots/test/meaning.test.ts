import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { type BotPack, TOOLS } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { checkRuleMeaning } from "../src/meaning.ts";
import { type PackProblem, validatePack } from "../src/validate.ts";

const ENGINE = new CelEngine(CONTEXT_SCHEMA, neutralContext);
const CTX = { tools: Object.keys(TOOLS), validateRule: (when: string) => ENGINE.validate(when) };

type Rule = BotPack["rules"][number];

function pack(tools: string[], rules: Omit<Rule, "description">[]): BotPack {
  return {
    id: "dinner-planner",
    name: "Dinner planner",
    pitch: "Plans a dinner with friends.",
    category: "food",
    version: 1,
    author: { kind: "person", handle: "sam" },
    licence: "MIT",
    needs: { tools, connectors: [], model: "any" },
    instructions: "Plan the dinner. Say what you could not check.",
    starters: [],
    examples: [],
    skills: [],
    rules: rules.map((r) => ({ description: "", ...r })),
    routines: [],
    shortcuts: [],
    readme: "",
  };
}

function check(tools: string[], ...rules: Omit<Rule, "description">[]): PackProblem[] {
  return checkRuleMeaning(pack(tools, rules), CTX);
}

describe("what a bot's rules mean", () => {
  it("passes rules that do what they say", () => {
    expect(
      check(
        ["mail_send", "calendar_create", "web_search"],
        { name: "Ask before sending", effect: "ask", when: 'tool.kind == "send"' },
        { name: "Ask before adding to the calendar", effect: "ask", when: "tool.name == 'calendar_create'" },
        { name: "Never pay", effect: "deny", when: 'tool.kind == "pay"' },
      ),
    ).toEqual([]);
  });

  it("refuses a kind, a place or a tool that does not exist, since the rule could never fire", () => {
    const problems = check(
      ["calendar_create", "mail_send"],
      { name: "check availability", effect: "ask", when: 'tool.kind == "calendar_create"' },
      { name: "Ask before paying", effect: "ask", when: 'tool.kind == "Pay"' },
      { name: "No browsing", effect: "deny", when: 'tool.surface in ["browser", "internet"]' },
      { name: "nope", effect: "deny", when: '"nope" == tool.name' },
    );
    expect(problems.map((p) => [p.path, p.severity])).toEqual([
      ["rules[0].when", "error"],
      ["rules[1].when", "error"],
      ["rules[2].when", "error"],
      ["rules[3].when", "error"],
    ]);
    expect(problems[0]?.message).toContain('for that tool, write tool.name == "calendar_create"');
    expect(problems[2]?.message).toContain('"internet" is not a place a tool acts');
    expect(problems[3]?.message).toContain('"nope" is not a tool this Steward has');
    // A tool that may be connected later is only a warning.
    expect(
      check([], { name: "Ask on issues", effect: "ask", when: 'tool.name == "mcp__github__create_issue"' }),
    ).toMatchObject([{ severity: "warn" }]);
  });

  it("refuses a condition that does not look at the call", () => {
    for (const when of ["true", "1 == 1", 'contains("abc", "a")']) {
      expect(check(["mail_send"], { name: "Ask before sending", effect: "ask", when })).toMatchObject([
        { path: "rules[0].when", severity: "error" },
      ]);
    }
  });

  it("warns about an ask rule none of the bot's tools can trigger", () => {
    const problems = check(["make_page", "web_search"], {
      name: "ask before sending",
      effect: "ask",
      when: 'tool.kind == "send"',
    });
    expect(problems).toMatchObject([{ path: "rules[0].when", severity: "warn" }]);
    expect(problems[0]?.message).toContain("never applies");
  });

  it("knows a click can send or pay, as the gateway raises it", () => {
    expect(
      check(
        ["browser_navigate", "browser_click"],
        { name: "Ask before paying", effect: "ask", when: 'tool.kind == "pay"' },
        { name: "Ask before sending", effect: "ask", when: 'tool.kind == "send"' },
      ),
    ).toEqual([]);
    // Reading a page cannot pay.
    expect(
      check(["browser_navigate", "browser_snapshot"], {
        name: "Ask before paying",
        effect: "ask",
        when: 'tool.kind == "pay"',
      }),
    ).toMatchObject([{ severity: "warn" }]);
  });

  it("warns about asking before something that only reads or shows", () => {
    const problems = check(["web_search", "make_page"], {
      name: "no medical advice",
      effect: "ask",
      when: 'tool.name == "web_search"',
    });
    expect(problems).toMatchObject([{ path: "rules[0].when", severity: "warn" }]);
    expect(problems[0]?.message).toContain("reading or showing things (web_search)");
  });

  it("warns about a deny rule that refuses the bot's own tools, not one that is only a promise", () => {
    const problems = check(
      ["web_search", "make_page", "calendar_create"],
      { name: "do not invent snack details", effect: "deny", when: 'tool.kind == "write"' },
      // The bot cannot send at all: refusing it is a promise, not a contradiction.
      { name: "Never send", effect: "deny", when: 'tool.kind == "send"' },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toBe(
      "refuses make_page and calendar_create, which this bot needs; drop the rule or the tool",
    );
    // A click raised to pay is not the click itself: refusing pay leaves clicking alone.
    expect(
      check(["browser_click"], { name: "Never pay", effect: "deny", when: 'tool.kind == "pay"' }),
    ).toEqual([]);
  });

  it("warns about a deny rule no tool at all can trigger, however its literal is written", () => {
    // The literal check reads `tool.kind == "Pay"`; these spell the same dead rule another way.
    for (const when of ['tool.kind == ("Pay")', 'tool["kind"] == "Pay"', '"Pay" in [tool.kind]']) {
      const problems = check(["web_search"], { name: "Never pay", effect: "deny", when });
      expect(problems, when).toEqual([
        {
          path: "rules[0].when",
          severity: "warn",
          message: "can never apply: no tool Steward has is one it covers, so it refuses nothing",
        },
      ]);
    }
    // A promise about tools the bot lacks, or about an MCP tool connected later, still counts.
    for (const when of [
      'tool.kind == "send"',
      'tool.surface == "mcp"',
      'tool.source == "mcp:github"',
      'tool.surface == "mcp" && tool.kind == "delete"',
    ]) {
      expect(check(["web_search"], { name: "Never", effect: "deny", when }), when).toEqual([]);
    }
  });

  it("says an unknown kind matches no tool, which holds for != as well as ==", () => {
    const [problem] = check(["mail_send"], { name: "x", effect: "ask", when: 'tool.kind != "Send"' });
    expect(problem?.severity).toBe("error");
    expect(problem?.message).toMatch(/^"Send" is not a kind of tool, so no tool ever matches it\./);
  });

  it("leaves rules about the target to the reader, and warns about the same rule twice", () => {
    expect(
      check(["mail_send"], {
        name: "Ask before mailing many people",
        effect: "ask",
        when: 'tool.name == "mail_send" && size(target.recipients) > 3',
      }),
    ).toEqual([]);
    expect(
      check(
        ["memory_remember"],
        { name: "remember-plan", effect: "ask", when: 'tool.name == "memory_remember"' },
        { name: "remember-log", effect: "ask", when: "tool.name  ==  'memory_remember'" },
      ),
    ).toMatchObject([{ path: "rules[1]", severity: "warn", message: "is the same rule as rules[0]" }]);
  });

  it("is part of validatePack: a rule that can never fire fails the pack", () => {
    const result = validatePack(
      pack(["calendar_create"], [{ name: "x", effect: "ask", when: 'tool.kind == "calendar_create"' }]),
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.path === "rules[0].when" && p.severity === "error")).toBe(true);
  });
});
