import type { BotPack, TextModel } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { dedupe, JUDGE_BAR, judgeBot, parseJudgement } from "../src/judge.ts";

function pack(id: string, name: string, pitch: string): BotPack {
  return {
    id,
    name,
    pitch,
    category: "misc",
    version: 1,
    author: { kind: "ai", model: "template", generated: "2026-10-28" },
    licence: "MIT",
    needs: { tools: [], connectors: [], model: "any" },
    instructions: "Help one person with a job. Say what you could not check.",
    starters: [],
    examples: [],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme: "",
  };
}

describe("parseJudgement", () => {
  it("reads fenced scores and averages them", () => {
    const judgement = parseJudgement(`\`\`\`json
{"usefulness": {"score": 4, "note": "Does the job."}, "honesty": {"score": 5, "note": "Says what it could not check."}, "clarity": {"score": 3, "note": "Long steps.",},}
\`\`\``);
    expect(judgement.score).toBe(4);
    expect(judgement.scores).toEqual({ usefulness: 4, honesty: 5, clarity: 3 });
    expect(judgement.notes).toEqual([
      "Usefulness 4/5: Does the job.",
      "Honesty 5/5: Says what it could not check.",
      "Clarity 3/5: Long steps.",
    ]);
  });

  it("accepts bare numbers and refuses missing or out-of-range scores", () => {
    expect(parseJudgement('{"usefulness": 3, "honesty": "4", "clarity": 2}').score).toBe(3);
    expect(() => parseJudgement('{"usefulness": {"score": 4}, "honesty": {"score": 4}}')).toThrow(/clarity/);
    expect(() => parseJudgement('{"usefulness": 9, "honesty": 4, "clarity": 4}')).toThrow(/usefulness/);
  });

  it("judgeBot sends the pack and parses the answer", async () => {
    const prompts: string[] = [];
    const model: TextModel = {
      label: "judge",
      complete: async ({ prompt }) => {
        prompts.push(prompt);
        return '{"usefulness": {"score": 2, "note": "Thin."}, "honesty": {"score": 3, "note": "Fine."}, "clarity": {"score": 3, "note": "Fine."}}';
      },
    };
    const judgement = await judgeBot(pack("a", "Rent scout", "Finds flats."), model);
    expect(judgement.score).toBeLessThan(JUDGE_BAR);
    expect(prompts[0]).toContain("Rent scout");
  });
});

describe("dedupe", () => {
  it("keeps the earlier of two near-identical packs and leaves different ones", () => {
    const a = pack(
      "rent-scout",
      "Rent scout",
      "Finds rentals in your budget and flags scams before you pay a deposit.",
    );
    const b = pack(
      "rent-finder",
      "Rent finder",
      "Finds rentals in your budget and flags scams before you pay any deposit.",
    );
    const c = pack(
      "invoice-chaser",
      "Invoice chaser",
      "Chases the invoice that is late with a polite reminder.",
    );
    const result = dedupe([a, b, c]);
    expect(result.kept.map((p) => p.id)).toEqual(["rent-scout", "invoice-chaser"]);
    expect(result.dropped).toEqual([{ id: "rent-finder", duplicateOf: "rent-scout" }]);
  });

  it("drops a pack that duplicates one already on the shelf", () => {
    const existing = pack(
      "rent-scout",
      "Rent scout",
      "Finds rentals in your budget and flags scams before you pay a deposit.",
    );
    const fresh = pack(
      "rent-scout-2",
      "Rent scout",
      "Finds rentals in your budget and flags scams before you pay a deposit.",
    );
    const result = dedupe([fresh], [existing]);
    expect(result.kept).toEqual([]);
    expect(result.dropped[0]?.duplicateOf).toBe("rent-scout");
  });
});
