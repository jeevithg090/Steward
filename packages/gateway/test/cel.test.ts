import { describe, expect, it } from "vitest";
import { CelEngine, celString, RuleSyntaxError, unescapeCelString } from "../src/cel.ts";
import { buildContext, CONTEXT_SCHEMA, neutralContext } from "../src/context.ts";
import { gateCall } from "./helpers.ts";

const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);

function ctx(name: string, args: Record<string, unknown> = {}, target = {}) {
  return buildContext({ ...gateCall(name, args), target }, []);
}

describe("validate", () => {
  it("accepts rules over every variable", () => {
    for (const rule of [
      'tool.kind == "send"',
      'target.host in ["a.com", "b.com"]',
      'contains(target.command, "rm") && !tainted',
      'matches(target.command, "\\bsudo\\b")',
      "size(target.recipients) > 2",
      'target.recipients.exists(r, endsWith(r, "@example.com"))',
      'initiator.kind == "routine" && agent.id == "steward" && actor.id == "local"',
      '"card_number" in findings',
      "target.amount.value > 10000",
      'target.element.name == "Send" && target.element.role == "button"',
      'target.mcp.server == "github"',
      'has(args.to) && args.to == "sam@example.com"',
      'args.anything.at.all == "x"',
      'intent == ""',
      "true",
    ]) {
      expect(() => engine.validate(rule), rule).not.toThrow();
    }
  });

  it("explains a syntax error in plain words", () => {
    expect(() => engine.validate("tool.kind ==")).toThrow(/not valid CEL: it ends too early/);
    expect(() => engine.validate("tool.kind == )")).toThrow(/unexpected '\)'/);
    expect(() => engine.validate('tool.kind == "send")')).toThrow(
      /something extra at the end, starting at '\)'/,
    );
  });

  it("names an unknown variable and lists the real ones", () => {
    expect(() => engine.validate('page.host == "x"')).toThrow(
      /nothing called 'page'\. Rules can read .*target, tool/,
    );
  });

  it("catches a misspelt field even behind a false left side", () => {
    // Neutral evaluation alone would short-circuit and miss this.
    expect(() => engine.validate('tool.kind == "shell" && target.comand == "ls"')).toThrow(
      /target has no field 'comand'/,
    );
    expect(() => engine.validate('tool.name.first == "x"')).toThrow(/tool.name is a single value/);
  });

  it("refuses unknown functions and string methods, pointing at the global form", () => {
    expect(() => engine.validate("foo(tool.name)")).toThrow(/no function called foo\(\)/);
    expect(() => engine.validate('tool.name.startsWith("browser_")')).toThrow(
      /\.startsWith\(\) is not supported; write startsWith\(value, …\) instead/,
    );
  });

  it("refuses a rule that does not answer true or false", () => {
    expect(() => engine.validate("tool.name")).toThrow(/must answer true or false, but it gives text/);
    expect(() => engine.validate('"Submit order"')).toThrow(RuleSyntaxError);
    expect(() => engine.validate("")).toThrow(/needs a condition/);
  });

  it("refuses an invalid regex", () => {
    expect(() => engine.validate('matches(tool.name, "(")')).toThrow(/not a valid pattern/);
  });
});

describe("test", () => {
  it("binds every target field, so absent fields never throw", () => {
    const c = ctx("shell_run", { command: "ls" }, { command: "ls" });
    expect(engine.test('target.host == "x"', c)).toBe(false);
    expect(engine.test('target.element.name == ""', c)).toBe(true);
    expect(engine.test("target.amount.value == 0", c)).toBe(true);
  });

  it("reads missing arguments as absent instead of throwing", () => {
    const c = ctx("browser_click", { ref: "e1" });
    expect(engine.test('args.to == "sam@example.com"', c)).toBe(false);
    expect(engine.test("has(args.to)", c)).toBe(false);
    expect(engine.test("has(args.ref)", c)).toBe(true);
    expect(engine.test('args.deeply.nested.field == "x"', c)).toBe(false);
    expect(engine.test('contains(args.to, "sam")', c)).toBe(false);
  });

  it("never lets a rule read a secret argument", () => {
    const c = ctx("mcp__vault__store", { password: "hunter2", name: "bank" });
    expect(engine.test('args.password == "hunter2"', c)).toBe(false);
    expect(engine.test('args.password == "[redacted]"', c)).toBe(true);
  });

  it("matches and contains ignore case and work on lists", () => {
    const c = ctx("mail_send", {}, { recipients: ["Sam@Example.com", "kim@example.org"] });
    expect(engine.test('contains(target.recipients, "sam@example.com")', c)).toBe(true);
    expect(engine.test('matches(target.recipients, "@example\\.org$")', c)).toBe(true);
    expect(engine.test('target.recipients.all(r, endsWith(r, "example.com"))', c)).toBe(false);
    expect(engine.test('startsWith(tool.name, "MAIL_")', c)).toBe(true);
  });

  it("throws a readable error for a type mix, without quoting the context", () => {
    const c = ctx("shell_run", { command: "cat secret.txt" }, { command: "cat secret.txt" });
    let message = "";
    try {
      engine.test("target.command > 3", c);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/different kinds/);
    expect(message).not.toContain("secret.txt");
  });

  it("keeps macro variables from leaking between evaluations", () => {
    const c = ctx("mail_send", {}, { recipients: ["a@x.com"] });
    expect(engine.test('target.recipients.exists(tool, tool == "a@x.com")', c)).toBe(true);
    expect(engine.test('tool.name == "mail_send"', c)).toBe(true);
  });
});

describe("string escapes", () => {
  it("treats \\b in a regex the same whether written once or twice", () => {
    const c = ctx("shell_run", {}, { command: "sudo rm x" });
    expect(engine.test('matches(target.command, "\\bsudo\\b")', c)).toBe(true);
    expect(engine.test('matches(target.command, "\\\\bsudo\\\\b")', c)).toBe(true);
    expect(engine.test('matches(target.command, "\\bpseudo\\b")', c)).toBe(false);
  });

  it("round-trips any text through celString", () => {
    for (const text of ['say "hi"', "back\\slash", "line\nbreak", "tab\there", "\\bword", "it's"]) {
      const literal = celString(text);
      expect(unescapeCelString(literal.slice(1, -1))).toBe(text);
      const c = ctx("shell_run", {}, { command: text });
      expect(engine.test(`target.command == ${literal}`, c), text).toBe(true);
    }
  });
});
