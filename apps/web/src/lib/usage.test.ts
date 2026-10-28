import { describe, expect, it } from "vitest";
import { runUsage, usageLine, usageSummary } from "./usage.ts";

describe("run usage in the record", () => {
  it("reads the entries a run.finished detail carries, and nothing that is not a count", () => {
    expect(
      runUsage({
        outcome: "success",
        usage: [
          { provider: "xai", model: "grok-4.7", input: 820, output: 414, total: 1234 },
          { provider: "openrouter", model: "x", input: 10, output: 2 },
          { provider: "nothing", model: "counted" },
          // What the record shows for a key that reads like a secret: never taken as a count.
          { provider: "p", model: "m", input: "[redacted]", total: "[redacted]" },
          "not an entry",
        ],
      }),
    ).toEqual([
      { provider: "xai", model: "grok-4.7", input: 820, output: 414, total: 1234 },
      { provider: "openrouter", model: "x", input: 10, output: 2, total: 12 },
    ]);
    expect(runUsage({ outcome: "error" })).toEqual([]);
    expect(runUsage(undefined)).toEqual([]);
  });

  it("says a run's cost in words, per provider and model", () => {
    expect(usageLine({ provider: "xai", model: "grok-4.7", input: 820, output: 414, total: 1234 })).toBe(
      "1,234 tokens · xAI grok-4.7 (820 in, 414 out)",
    );
    expect(usageLine({ total: 1 })).toBe("1 token");
    expect(
      usageSummary({
        usage: [
          { provider: "scripted", model: "steward-scripted", input: 5, output: 3, total: 8 },
          { provider: "harness:codex", total: 0 },
        ],
      }),
    ).toBe("8 tokens · Scripted demo model steward-scripted (5 in, 3 out); 0 tokens · harness:codex");
    expect(usageSummary({ outcome: "cancelled" })).toBe("No token count was reported.");
  });
});
