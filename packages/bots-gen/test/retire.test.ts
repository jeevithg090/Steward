import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, writeBotFolder } from "@steward/bots";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { type BotPack, type TextModel, TOOLS } from "@steward/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateBatch } from "../src/batch.ts";
import type { Job } from "../src/jobs.ts";
import {
  CATEGORY_FLOOR,
  planRetirement,
  readGenerateLog,
  readRetired,
  runRetirement,
} from "../src/retire.ts";

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

  it("never takes a category under its floor, and names it with how many new bots would free", () => {
    const plan = planRetirement({ packs: SHELF, counts: COUNTS, now: NOW, floor: 6 });
    // food keeps 6 of 7 (at the floor); money keeps its only bot, held by the floor.
    expect(plan.retire.map((r) => r.id)).toEqual(["old-unused"]);
    expect(plan.held).toEqual([{ id: "old-money", category: "money", reason: "floor" }]);
    expect(plan.thinned).toEqual([{ category: "money", live: 1, floor: 6, need: 1 }]);
  });

  it("records the job each bot came from, when the log knows it", () => {
    const plan = planRetirement({
      packs: SHELF,
      counts: COUNTS,
      now: NOW,
      floor: 0,
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
    const run = await runRetirement({ dir, counts: COUNTS, now: NOW, floor: 0 });
    expect(run.applied).toBe(false);
    expect(run.retire).toHaveLength(2);
    expect(existsSync(join(dir, "bots", "old-unused"))).toBe(true);
  });

  it("removes the folders and packs, keeps a retired list, and rebuilds the index", async () => {
    const run = await runRetirement({
      dir,
      counts: COUNTS,
      now: NOW,
      floor: 0,
      apply: true,
      jobOf: () => "a job",
    });
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
    const again = await runRetirement({ dir, counts: COUNTS, now: NOW, floor: 0, apply: true });
    expect(again.retire).toEqual([]);
    expect(await readRetired(dir)).toHaveLength(2);
  });

  it("keeps a bot the floor holds when no new bot could be written for it", async () => {
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
    expect(run.thinned).toEqual([{ category: "money", live: 1, floor: 2, need: 1 }]);
    // The model answers nothing usable, so nothing replaces old-money and it stays.
    expect(run.regenerated).toEqual([]);
    expect(run.outOfJobs).toEqual([]);
    expect(run.held.map((h) => h.id)).toEqual(["old-money"]);
    expect(existsSync(join(dir, "bots", "old-money"))).toBe(true);
  });

  it("lets a bot the floor holds go once a new bot for its category is written", async () => {
    const jobs: Job[] = [
      { category: "money", job: "a job", tools: [], connectors: [] },
      { category: "money", job: "split a restaurant bill between friends fairly", tools: [], connectors: [] },
    ];
    const run = await runRetirement({
      dir,
      counts: COUNTS,
      now: NOW,
      floor: 2,
      apply: true,
      jobOf: () => "a job",
      scoreOf: () => 4,
      regenerate: { model: packWritingModel(), jobs, ctx: CTX },
    });
    expect(run.regenerated.map((r) => r.category)).toEqual(["money"]);
    // old-unused goes as usual (food has room); old-money only because a new money bot was written.
    expect(run.retire.map((r) => r.id)).toEqual(["old-unused", "old-money"]);
    expect(run.held).toEqual([]);
    expect(existsSync(join(dir, "bots", "old-money"))).toBe(false);
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
      bots: { id: string; category: string }[];
    };
    // money still has one bot: the new one.
    expect(index.bots.filter((b) => b.category === "money").map((b) => b.id)).toEqual([
      run.regenerated[0]?.id,
    ]);
  });

  it("reads each bot's job and score from the generate log when none are given", async () => {
    const rows = [
      {
        job: "cook the old thing",
        category: "food",
        id: "old-unused",
        status: "written",
        score: 4.2,
        at: "t",
      },
      { job: "count the money", category: "money", id: "old-money", status: "written", score: 3.8, at: "t" },
    ];
    writeFileSync(
      join(dir, "generate-log.jsonl"),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\nnot json\n`,
    );
    const log = await readGenerateLog(dir);
    expect(log.scoreOf("old-money")).toBe(3.8);
    expect(log.jobOf("missing")).toBeUndefined();
    const run = await runRetirement({ dir, counts: COUNTS, now: NOW, floor: 0 });
    expect(run.retire.find((r) => r.id === "old-unused")?.job).toBe("cook the old thing");
  });
});

describe("retirement pacing", () => {
  /** One category of `n` AI-made bots, all past their 90 days, all unused. */
  const category = (n: number, made = "2026-10-28") =>
    Array.from({ length: n }, (_, i) =>
      pack(`bot-${String(i).padStart(3, "0")}`, {
        author: { kind: "ai", model: "test/model", generated: made },
      }),
    );

  it("takes at most a tenth of a category in one run, lowest judge score first", () => {
    const shelf = category(100);
    const score = (id: string) => Number(id.slice(4)) / 10;
    const plan = planRetirement({ packs: shelf, counts: {}, now: NOW, scoreOf: score });
    expect(plan.retire.map((r) => r.id)).toEqual(shelf.slice(0, 10).map((p) => p.id));
    expect(plan.held.filter((h) => h.reason === "cap")).toHaveLength(70);
    expect(plan.held.filter((h) => h.reason === "floor")).toHaveLength(20);
    expect(plan.held[0]?.id).toBe("bot-010");
    expect(plan.thinned).toEqual([]);
  });

  it("puts a bot with no score before any scored one", () => {
    const shelf = category(30);
    const plan = planRetirement({
      packs: shelf,
      counts: {},
      now: NOW,
      scoreOf: (id) => (id === "bot-029" ? undefined : 5),
    });
    expect(plan.retire.map((r) => r.id)).toEqual(["bot-000", "bot-001", "bot-029"]);
  });

  it("thins a category night by night and never takes it under its floor", () => {
    let shelf = category(100);
    const nights: number[] = [];
    for (let night = 0; night < 60; night++) {
      const now = new Date(NOW.getTime() + night * 86_400_000);
      const plan = planRetirement({ packs: shelf, counts: {}, now });
      const live = shelf.length;
      expect(plan.retire.length).toBeLessThanOrEqual(Math.max(1, Math.floor(live / 10)));
      const gone = new Set(plan.retire.map((r) => r.id));
      shelf = shelf.filter((p) => !gone.has(p.id));
      expect(shelf.length).toBeGreaterThanOrEqual(CATEGORY_FLOOR);
      nights.push(shelf.length);
    }
    expect(nights.slice(0, 3)).toEqual([90, 81, 73]);
    expect(nights.at(-1)).toBe(CATEGORY_FLOOR);
  });

  it("keeps the whole shipped mix: no category is emptied on the night most bots come due", () => {
    // 1,064 AI-made bots from two days, in a mix like the shipped shelf's, and a few people's bots.
    const sizes: Record<string, number> = { food: 97, money: 95, investing: 74, travel: 46, sports: 35 };
    const shelf: BotPack[] = [];
    for (const [cat, n] of Object.entries(sizes)) {
      for (let i = 0; i < n; i++) {
        shelf.push(
          pack(`${cat}-${i}`, {
            category: cat as BotPack["category"],
            author: { kind: "ai", model: "test/model", generated: i % 2 ? "2026-10-29" : "2026-10-28" },
          }),
        );
      }
    }
    const plan = planRetirement({ packs: shelf, counts: {}, now: new Date("2027-01-28T03:00:00Z") });
    const left = (cat: string) => sizes[cat]! - plan.retire.filter((r) => r.category === cat).length;
    for (const cat of Object.keys(sizes)) {
      expect(left(cat)).toBeGreaterThanOrEqual(CATEGORY_FLOOR);
      expect(left(cat)).toBeGreaterThanOrEqual(Math.ceil(sizes[cat]! * 0.9));
    }
  });
});

/** A model whose answers never parse, so the batch reports drops instead of writing. */
function templateFailingModel(): TextModel {
  return { label: "fake/model", complete: async () => "no json here" };
}

/** A model that writes a plain, valid pack for whatever job it is given. */
function packWritingModel(): TextModel {
  return {
    label: "fake/model",
    complete: async ({ prompt }) => {
      const job = /The job, in the person's words: "([^"]+)"/.exec(prompt)?.[1] ?? "a job";
      return JSON.stringify({
        name: "Bill splitter",
        pitch: `Helps with this: ${job}.`,
        category: "money",
        needs: { tools: ["show_table"], connectors: [], model: "any" },
        instructions: "Ask for the amounts. Add them up. Show a table. Say what you could not check.",
        starters: ["Split this bill."],
        examples: [{ ask: "Split 60 between three (a made-up example).", does: "Shows 20 each." }],
        skills: [],
        rules: [],
        readme: "# Bill splitter\n\nSplits a bill.",
      });
    },
  };
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

  it("drops a health bot the judge finds unsafe, even when its mean clears the bar", async () => {
    // Full marks for everything else would carry a safety score of 1 to a mean of 4.
    const judge: TextModel = {
      label: "fake/judge",
      complete: async () =>
        '{"usefulness": 5, "honesty": 5, "clarity": 5, "safety": {"score": 1, "note": "Picks doses from search results."}}',
    };
    const result = await generateBatch({
      jobs: [job("plan a week of low-salt meals", "health"), job("find a recipe for leftover rice")],
      botsDir: dir,
      ctx: CTX,
      judge,
      shelf: [],
      now: () => NOW,
    });
    expect(result.dropped.map((d) => [d.category, d.reason])).toEqual([
      [
        "health",
        "not safe enough (safety 1): Usefulness 5/5 Honesty 5/5 Clarity 5/5 Safety 1/5: Picks doses from search results.",
      ],
    ]);
    // A food bot is not scored for safety, so the same answer passes it.
    expect(result.written.map((r) => r.category)).toEqual(["food"]);
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
