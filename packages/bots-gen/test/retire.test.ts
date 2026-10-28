import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, writeBotFolder } from "@steward/bots";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { type BotPack, type TextModel, TOOLS } from "@steward/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateBatch } from "../src/batch.ts";
import type { Job } from "../src/jobs.ts";
import { planRetirement, readRetired, runRetirement } from "../src/retire.ts";

const ENGINE = new CelEngine(CONTEXT_SCHEMA, neutralContext);
const CTX = { tools: Object.keys(TOOLS), validateRule: (w: string) => ENGINE.validate(w) };

/** The fixed clock every test reads: 28 Jan 2027, 92 days after 28 Oct 2026. */
const NOW = new Date("2027-01-28T03:00:00Z");

function pack(id: string, extra: Partial<BotPack> = {}): BotPack {
  return {
    id,
    name: id.replace(/-/g, " "),
    pitch: `Does the ${id} job.`,
    category: "food",
    version: 1,
    author: { kind: "ai", model: "test/model", generated: "2026-10-28" },
    licence: "MIT",
    needs: { tools: ["web_search"], connectors: [], model: "any" },
    instructions: "Help one person with one job. Say what you could not check.",
    starters: [],
    examples: [],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme: "",
    ...extra,
  };
}

const SHELF: BotPack[] = [
  pack("old-unused"),
  pack("old-installed"),
  pack("old-voted"),
  pack("young-unused", { author: { kind: "ai", model: "test/model", generated: "2026-12-01" } }),
  pack("person-made", { author: { kind: "person", handle: "ana" } }),
  pack("claimed-draft", { author: { kind: "person", handle: "ben", basedOnAi: true } }),
  pack("undated", { author: { kind: "ai", model: "test/model", generated: "soon" } }),
  pack("old-money", { category: "money" }),
];

const COUNTS = { "old-installed": { installs: 1, usedBy: 0 }, "old-voted": { installs: 0, usedBy: 2 } };

describe("planRetirement", () => {
  it("retires only AI-made bots nobody installed or used, once they are 90 days old", () => {
    const plan = planRetirement({ packs: SHELF, counts: COUNTS, now: NOW, floor: 0 });
    expect(plan.retire.map((r) => r.id)).toEqual(["old-unused", "old-money"]);
    expect(plan.retire[0]).toMatchObject({
      category: "food",
      generated: "2026-10-28",
      model: "test/model",
      retiredAt: NOW.toISOString(),
      reason: "AI-made on 2026-10-28 and not installed or used by anyone in 90 days",
    });
    expect(plan.young).toEqual([{ id: "young-unused", daysLeft: 32 }]);
  });

  it("keeps everything a day earlier", () => {
    const plan = planRetirement({
      packs: SHELF,
      counts: COUNTS,
      now: new Date("2027-01-25T00:00:00Z"),
      floor: 0,
    });
    expect(plan.retire).toEqual([]);
  });

  it("names the categories that lost bots and fell under the floor, with how many to add", () => {
    const plan = planRetirement({ packs: SHELF, counts: COUNTS, now: NOW, floor: 6 });
    // food keeps 6 of 7 (at the floor); money loses its only bot.
    expect(plan.thinned).toEqual([{ category: "money", live: 0, floor: 6, need: 6 }]);
  });

  it("records the job each bot came from, when the log knows it", () => {
    const plan = planRetirement({
      packs: SHELF,
      counts: COUNTS,
      now: NOW,
      jobOf: (id) => (id === "old-unused" ? "cook the old thing" : undefined),
    });
    expect(plan.retire.find((r) => r.id === "old-unused")?.job).toBe("cook the old thing");
    expect(plan.retire.find((r) => r.id === "old-money")?.job).toBeUndefined();
  });
});

describe("runRetirement", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "steward-retire-"));
    for (const p of SHELF) await writeBotFolder(join(dir, "bots", p.id), p);
    await buildIndex(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("plans without changing anything unless asked to apply", async () => {
    const run = await runRetirement({ dir, counts: COUNTS, now: NOW });
    expect(run.applied).toBe(false);
    expect(run.retire).toHaveLength(2);
    expect(existsSync(join(dir, "bots", "old-unused"))).toBe(true);
  });

  it("removes the folders and packs, keeps a retired list, and rebuilds the index", async () => {
    const run = await runRetirement({ dir, counts: COUNTS, now: NOW, apply: true, jobOf: () => "a job" });
    expect(run.applied).toBe(true);
    expect(existsSync(join(dir, "bots", "old-unused"))).toBe(false);
    expect(existsSync(join(dir, "packs", "old-unused.json"))).toBe(false);
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { bots: { id: string }[] };
    // "undated" was never listed: the build refuses an AI-made pack whose date cannot be read.
    expect(index.bots.map((b) => b.id).sort()).toEqual(
      ["claimed-draft", "old-installed", "old-voted", "person-made", "young-unused"].sort(),
    );
    expect(existsSync(join(dir, "bots", "undated"))).toBe(true);
    const retired = await readRetired(dir);
    expect(retired.map((r) => [r.id, r.job])).toEqual([
      ["old-money", "a job"],
      ["old-unused", "a job"],
    ]);
    // A second run on the same day finds nothing more to do.
    const again = await runRetirement({ dir, counts: COUNTS, now: NOW, apply: true });
    expect(again.retire).toEqual([]);
    expect(await readRetired(dir)).toHaveLength(2);
  });

  it("tops up a thinned category from unused jobs, and never regenerates a retired job", async () => {
    const jobs: Job[] = [
      { category: "money", job: "a job", tools: [], connectors: [] },
      { category: "money", job: "split a restaurant bill between friends fairly", tools: [], connectors: [] },
      {
        category: "money",
        job: "work out what a weekly budget for groceries should be",
        tools: [],
        connectors: [],
      },
    ];
    const run = await runRetirement({
      dir,
      counts: COUNTS,
      now: NOW,
      floor: 2,
      apply: true,
      jobOf: () => "a job",
      regenerate: { model: templateFailingModel(), jobs, ctx: CTX },
    });
    expect(run.thinned).toEqual([{ category: "money", live: 0, floor: 2, need: 2 }]);
    // The model answers nothing usable, so the run reports what it could not write and moves on.
    expect(run.regenerated).toEqual([]);
    expect(run.outOfJobs).toEqual([]);
  });
});

/** A model whose answers never parse, so the batch reports drops instead of writing. */
function templateFailingModel(): TextModel {
  return { label: "fake/model", complete: async () => "no json here" };
}

describe("generateBatch", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "steward-batch-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const job = (text: string, category: Job["category"] = "food"): Job => ({
    category,
    job: text,
    tools: ["web_search"],
    connectors: [],
  });

  it("writes template packs, records each with its time, and gives clashing ids a number", async () => {
    const rows: { status: string; id?: string; seconds?: number; dedupe?: string }[] = [];
    // Same id as the template gives "plan a week of dinners", but a different bot.
    const shelf: BotPack[] = [
      pack("week-dinners-planner", { name: "Tide tables", pitch: "Reads the tide times for a harbour." }),
    ];
    const result = await generateBatch({
      jobs: [job("plan a week of dinners"), job("find a recipe for leftover rice")],
      botsDir: dir,
      ctx: CTX,
      shelf,
      record: async (row) => {
        rows.push(row);
      },
      now: () => NOW,
    });
    expect(result.written.map((r) => r.id).sort()).toEqual([
      "recipe-leftover-finder",
      "week-dinners-planner-2",
    ]);
    expect(rows.every((r) => typeof r.seconds === "number" && r.dedupe === "words")).toBe(true);
    expect(existsSync(join(dir, "week-dinners-planner-2", "bot.yaml"))).toBe(true);
    expect(shelf).toHaveLength(3);
  });

  it("skips a retired job, and drops a look-alike of a retired bot", async () => {
    const result = await generateBatch({
      jobs: [job("plan a week of dinners"), job("find a recipe for leftover rice")],
      botsDir: dir,
      ctx: CTX,
      shelf: [],
      retired: [
        {
          id: "x",
          name: "Plan a week of dinners",
          pitch: "Plan a week of dinners.",
          category: "food",
          job: "plan a week of dinners",
          retiredAt: "t",
          reason: "r",
        },
        {
          id: "y",
          name: "Find a recipe for leftover rice",
          pitch: "Find a recipe for leftover rice.",
          category: "food",
          retiredAt: "t",
          reason: "r",
        },
      ],
      now: () => NOW,
    });
    expect(result.written).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual([
      "retired: a bot for this job was retired",
      "duplicate of retired y",
    ]);
  });
});
