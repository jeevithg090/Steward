import { describe, expect, it } from "vitest";
import { REDACTED, redactForApproval, redactForRules } from "../src/redact.ts";

describe("redactForRules", () => {
  it("keeps every string, item and key whole", () => {
    const body = `${"x".repeat(50_000)} CONFIDENTIAL`;
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]));
    const list = Array.from({ length: 300 }, (_, i) => i);
    const out = redactForRules({ body, list, ...many });
    expect(out.body).toBe(body);
    expect(out.list).toEqual(list);
    expect(Object.keys(out)).toHaveLength(302);
  });

  it("still hides secrets by name and by path, and keeps what the call says is not secret", () => {
    const out = redactForRules(
      { password: "hunter2", text: "typed", key: "Enter", nested: { apiToken: "abc" } },
      { hide: new Set(["text"]), keep: new Set(["key"]) },
    );
    expect(out).toEqual({ password: REDACTED, text: REDACTED, key: "Enter", nested: { apiToken: REDACTED } });
  });

  it("does not mask values: a rule on card numbers reads the findings, not the text", () => {
    expect(redactForRules({ body: "4242 4242 4242 4242" }).body).toBe("4242 4242 4242 4242");
  });

  it("throws on arguments nested too deeply to read, rather than cutting them", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 25; i++) deep = { inner: deep };
    expect(() => redactForRules(deep)).toThrow(/nested too deeply/);
    let fine: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 15; i++) fine = { inner: fine };
    expect(() => redactForRules(fine)).not.toThrow();
  });
});

describe("redactForApproval", () => {
  it("says how much of a long text the card does not show", () => {
    const body = "a".repeat(20_000) + "b".repeat(5_000);
    const shown = redactForApproval({ body }).body as string;
    expect(shown.startsWith("a".repeat(20_000))).toBe(true);
    expect(shown).not.toContain("b");
    expect(shown.endsWith("… [5,000 more characters not shown]")).toBe(true);
    expect(redactForApproval({ body: "short" }).body).toBe("short");
  });
});
