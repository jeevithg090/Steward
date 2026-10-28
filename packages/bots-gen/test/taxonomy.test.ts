import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextModel } from "@steward/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Embedder, EmbeddingCache, normalise } from "../src/embed.ts";
import { type Job, parseJobs } from "../src/jobs.ts";
import { createPace, fetchWithRetry } from "../src/model.ts";
import {
  AI_JOBS_HEADER,
  buildJobsPrompt,
  parseProposedJobs,
  proposeJobs,
  readAiJobs,
  writeAiJobs,
} from "../src/taxonomy.ts";

const LISTED: Job[] = [
  { category: "food", job: "plan a week of dinners for four", tools: ["make_page"], connectors: [] },
  {
    category: "money",
    job: "chase an invoice that is thirty days late",
    tools: ["mail_read"],
    connectors: ["mail"],
  },
];

function answer(jobs: unknown[]): TextModel {
  return { label: "fake", complete: async () => `\`\`\`json\n${JSON.stringify({ jobs })}\n\`\`\`` };
}

describe("parseProposedJobs", () => {
  it("keeps catalogue tools, mail and calendar, and skips lines that are not jobs", () => {
    const { jobs, skipped } = parseProposedJobs(
      JSON.stringify({
        jobs: [
          {
            job: "Find a recipe that uses up spinach.",
            tools: ["web_search", "teleport", "request_secret"],
            connectors: ["mail", "fax"],
          },
          { job: "short", tools: [] },
          "not an object",
        ],
      }),
      "food",
    );
    expect(jobs).toEqual([
      {
        category: "food",
        job: "find a recipe that uses up spinach",
        tools: ["web_search"],
        connectors: ["mail"],
      },
    ]);
    expect(skipped).toEqual(["short"]);
  });

  it("tells the model the category, the listed jobs and the tool catalogue", () => {
    const prompt = buildJobsPrompt("food", "Food & cooking", ["plan a week of dinners for four"], 5);
    expect(prompt).toContain("Write 5 new jobs");
    expect(prompt).toContain("- plan a week of dinners for four");
    expect(prompt).toContain("- web_search:");
    expect(prompt).not.toContain("request_secret");
  });
});

class FakeEmbedder implements Embedder {
  label = "fake/embed";
  constructor(private readonly vectors: Record<string, number[]>) {}
  async embed(texts: readonly string[]) {
    return texts.map((t, i) => normalise(this.vectors[t] ?? [0, 0, 0, i + 1]));
  }
}

describe("proposeJobs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "steward-taxonomy-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("drops exact repeats and near-duplicates by meaning, and keeps the rest", async () => {
    const cache = new EmbeddingCache(
      join(dir, "e.jsonl"),
      new FakeEmbedder({
        "plan a week of dinners for four": [1, 0, 0, 0],
        "work out seven evening meals for a family": [0.95, 0.31, 0, 0],
        "find a recipe for a glut of courgettes": [0, 1, 0, 0],
        "plan a fortnight of dinners for four": [0.85, 0.53, 0, 0],
      }),
    );
    const model = answer([
      { job: "plan a week of dinners for four", tools: [] },
      { job: "work out seven evening meals for a family", tools: [] },
      { job: "find a recipe for a glut of courgettes", tools: ["web_search"] },
      { job: "plan a fortnight of dinners for four", tools: [] },
    ]);
    const proposal = await proposeJobs("food", 4, LISTED, [], {
      model,
      cache,
      confirm: async () => false,
    });
    expect(proposal.added.map((j) => j.job)).toEqual([
      "find a recipe for a glut of courgettes",
      "plan a fortnight of dinners for four",
    ]);
    expect(proposal.dropped.map((d) => d.reason)).toEqual([
      "already listed",
      'like "plan a week of dinners for four" (0.951, sure)',
    ]);
  });

  it("drops a job like a retired bot's", async () => {
    const cache = new EmbeddingCache(
      join(dir, "e.jsonl"),
      new FakeEmbedder({
        "track my gym lifts and when to add weight": [1, 0, 0, 0],
        "log my lifts and say when to go heavier": [0.97, 0.24, 0, 0],
      }),
    );
    const proposal = await proposeJobs(
      "sports",
      1,
      LISTED,
      [{ id: "retired:lift-log", text: "track my gym lifts and when to add weight" }],
      {
        model: answer([{ job: "log my lifts and say when to go heavier", tools: [] }]),
        cache,
      },
    );
    expect(proposal.added).toEqual([]);
    expect(proposal.dropped[0]?.reason).toContain("retired:lift-log");
  });

  it("falls back to word overlap without an embedder", async () => {
    const proposal = await proposeJobs("food", 2, LISTED, [], {
      model: answer([
        { job: "plan a week of dinners for four people", tools: [] },
        { job: "bake bread with no yeast in the house", tools: [] },
      ]),
    });
    expect(proposal.added.map((j) => j.job)).toEqual(["bake bread with no yeast in the house"]);
  });
});

describe("jobs-ai.yaml", () => {
  it("is written under its not-yet-read header, grouped by category, and reads back as jobs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "steward-ai-jobs-"));
    try {
      const file = join(dir, "jobs-ai.yaml");
      await writeAiJobs(
        [
          {
            category: "money",
            job: "split a bill: three ways, with a tip",
            tools: ["show_table"],
            connectors: [],
          },
          { category: "food", job: "bake bread with no yeast", tools: [], connectors: [] },
        ],
        file,
      );
      const text = readFileSync(file, "utf8");
      expect(text.startsWith(AI_JOBS_HEADER)).toBe(true);
      expect(text).toContain("NOT YET READ BY A PERSON");
      expect(text.indexOf("food:")).toBeLessThan(text.indexOf("money:"));
      expect(text).toContain("tools: [show_table]");
      const back = await readAiJobs(file);
      expect(back.map((j) => [j.category, j.job])).toEqual([
        ["food", "bake bread with no yeast"],
        ["money", "split a bill: three ways, with a tip"],
      ]);
      expect(parseJobs(text)).toHaveLength(2);
      // A list past 110 columns is wrapped the way Biome wraps it, so the file stays formatted.
      const many = [
        "web_search",
        "web_fetch",
        "browser_navigate",
        "browser_click",
        "browser_type",
        "request_help",
        "task_create",
        "make_page",
      ];
      await writeAiJobs(
        [{ category: "travel", job: "book the cheapest sensible train", tools: many, connectors: [] }],
        file,
      );
      const wrapped = readFileSync(file, "utf8");
      expect(wrapped).toContain("    tools:\n      [\n        web_search,\n");
      expect((await readAiJobs(file))[0]?.tools).toEqual(many);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("retries and pace", () => {
  it("retries a 429 as the provider asks, then returns the answer", async () => {
    const waits: number[] = [];
    const answers = [
      new Response("busy", { status: 429, headers: { "retry-after": "2" } }),
      new Response("busy", { status: 503 }),
      new Response("ok", { status: 200 }),
    ];
    const response = await fetchWithRetry(async () => answers.shift()!, {
      baseDelayMs: 1000,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(response.status).toBe(200);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
    expect(waits[0]).toBeLessThan(2300);
    expect(waits[1]).toBeGreaterThanOrEqual(2000);
  });

  it("gives up after its retries, and never retries a 400 or a 401", async () => {
    let calls = 0;
    const sleep = async () => {};
    const busy = await fetchWithRetry(
      async () => {
        calls++;
        return new Response("", { status: 429 });
      },
      { retries: 2, sleep },
    );
    expect(busy.status).toBe(429);
    expect(calls).toBe(3);
    calls = 0;
    const denied = await fetchWithRetry(
      async () => {
        calls++;
        return new Response("", { status: 401 });
      },
      { sleep },
    );
    expect(denied.status).toBe(401);
    expect(calls).toBe(1);
  });

  it("spaces calls evenly at the requests per minute it is given", async () => {
    let clock = 0;
    const pace = createPace(60, () => clock);
    const started: number[] = [];
    const original = globalThis.setTimeout;
    // Time moves only when the pace sleeps, so the test runs instantly.
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      clock += ms;
      fn();
      return 0;
    }) as unknown as typeof setTimeout;
    try {
      for (let i = 0; i < 3; i++) {
        await pace.wait();
        started.push(clock);
      }
    } finally {
      globalThis.setTimeout = original;
    }
    expect(started).toEqual([0, 1000, 2000]);
  });
});

describe("seed model configuration", () => {
  it("judges with STEWARD_SEED_JUDGE_MODEL when set, and with the writer otherwise", async () => {
    const { judgeConfig, seedModelConfig } = await import("../src/model.ts");
    const both = seedModelConfig({
      NVIDIA_API_KEY: "k",
      STEWARD_SEED_MODEL: "nvidia/small-writer",
      STEWARD_SEED_JUDGE_MODEL: "nvidia/large-judge",
    })!;
    expect(both.model).toBe("nvidia/small-writer");
    expect(judgeConfig(both)).toMatchObject({ model: "nvidia/large-judge", apiKey: "k" });
    const one = seedModelConfig({ NVIDIA_API_KEY: "k" })!;
    expect(judgeConfig(one).model).toBe(one.model);
    expect(judgeConfig(one)).toBe(one);
  });
});
