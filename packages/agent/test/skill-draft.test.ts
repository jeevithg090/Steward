import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_TOOLS } from "../src/tools/catalogue.ts";
import type { ToolArgs, ToolContext } from "../src/tools/types.ts";
import { type Fakes, makeFakes, servicesFrom } from "./fakes.ts";

let fakes: Fakes;
let ctx: ToolContext;

beforeEach(() => {
  fakes = makeFakes();
  ctx = {
    agentId: "steward",
    threadId: "thr_1",
    runId: "run_1",
    toolCallId: "call_1",
    signal: new AbortController().signal,
    services: servicesFrom(fakes),
  };
});

const showSkill = (args: ToolArgs) => {
  const found = BUILTIN_TOOLS.find((t) => t.name === "show_skill");
  if (!found) throw new Error("no show_skill");
  return found.execute(args, ctx);
};

const DRAFT = {
  name: "weekly-review",
  description: "A short review of my week",
  instructions: "Look at what I did this week and what is coming next week.",
};

describe("show_skill", () => {
  it("shows a draft and saves nothing", async () => {
    const result = (await showSkill(DRAFT)) as { shown: boolean; next: string };
    expect(result.shown).toBe(true);
    expect(result.next).toMatch(/Nothing is saved until the person presses it/);
    expect(fakes.skills.list()).toEqual([]);
  });

  it("refuses a name the Skills page would refuse, and one already taken", async () => {
    await expect(showSkill({ ...DRAFT, name: "Weekly Review" })).rejects.toThrow(/can't be a skill's name/);
    await expect(showSkill({ ...DRAFT, name: "-review" })).rejects.toThrow(/can't be a skill's name/);
    await expect(showSkill({ ...DRAFT, description: "" })).rejects.toThrow(/description/);
    await expect(showSkill({ ...DRAFT, instructions: "x".repeat(8001) })).rejects.toThrow(/too long/);
    fakes.skills.create({ ...DRAFT, tools: [] });
    await expect(showSkill(DRAFT)).rejects.toThrow(/already a skill called \/weekly-review/);
  });
});
