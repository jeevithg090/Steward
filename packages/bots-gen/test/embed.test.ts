import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotPack } from "@steward/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bandFrom,
  confirmWithModel,
  cosine,
  createEmbedder,
  type Embedder,
  EmbeddingCache,
  embedderConfig,
  MAYBE_DUPLICATE,
  nearDuplicates,
  normalise,
  packCard,
  packText,
  SURE_DUPLICATE,
  semanticDedupe,
  similarPairs,
} from "../src/embed.ts";

function pack(id: string, name: string, pitch: string, starters: string[] = []): BotPack {
  return {
    id,
    name,
    pitch,
    category: "misc",
    version: 1,
    author: { kind: "ai", model: "test", generated: "2026-10-28" },
    licence: "MIT",
    needs: { tools: [], connectors: [], model: "any" },
    instructions: "Help one person with one job.",
    starters,
    examples: [],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme: "",
  };
}

/**
 * A pretend embedder: each text maps to a hand-placed direction, so similarities are known. Texts
 * it was not told about get a direction of their own, unlike everything else.
 */
class FakeEmbedder implements Embedder {
  label = "fake/embed-1";
  calls: string[][] = [];
  fail = false;
  private readonly known = new Map<string, number[]>();
  private spare = 10;

  place(text: string, vector: number[]): void {
    this.known.set(text, vector);
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (this.fail) throw new Error("The embedding endpoint answered 503.");
    this.calls.push([...texts]);
    return texts.map((t) => {
      const v = this.known.get(t);
      if (v) return normalise(v);
      const own = Array(16).fill(0);
      own[this.spare++ % 16] = 1;
      return own;
    });
  }
}

/** A unit vector at `similarity` to [1, 0, …] in the plane of the first two axes. */
const at = (similarity: number, axis = 1): number[] => {
  const v = Array(16).fill(0);
  v[0] = similarity;
  v[axis] = Math.sqrt(1 - similarity ** 2);
  return v;
};

let dir: string;
let embedder: FakeEmbedder;
let cache: EmbeddingCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "steward-embed-"));
  embedder = new FakeEmbedder();
  cache = new EmbeddingCache(EmbeddingCache.fileFor(dir, embedder.label), embedder);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const MEALS = pack("meal-planner", "Meal Planner", "Plans a week of dinners.", ["Plan dinners for four."]);
const MENUS = pack("menu-maker", "Menu Maker", "Writes a weekly menu for the family.");
const TWIN = pack("dinner-planner", "Dinner Planner", "Plans dinners for the week ahead.");
const INVOICES = pack("invoice-chaser", "Invoice Chaser", "Chases an invoice that is late.");

describe("the cache", () => {
  it("embeds each text once, keeps it on disk, and reads it back in a new process", async () => {
    embedder.place(packText(MEALS), at(1));
    const [first] = await cache.get([packText(MEALS), packText(MEALS)]);
    expect(embedder.calls).toEqual([[packText(MEALS)]]);
    expect(cosine(first!, normalise(at(1)))).toBeCloseTo(1, 5);
    await cache.get([packText(MEALS)]);
    expect(embedder.calls).toHaveLength(1);

    const again = new EmbeddingCache(cache.path, embedder);
    const [read] = await again.get([packText(MEALS)]);
    expect(embedder.calls).toHaveLength(1);
    expect(read!.length).toBe(16);
    expect(cosine(read!, first!)).toBeCloseTo(1, 5);
    expect(cache.path).toMatch(/fake--embed-1\.jsonl$/);
    expect(readFileSync(cache.path, "utf8")).not.toContain("Meal Planner");
  });

  it("skips a line cut short by a stopped run", async () => {
    embedder.place("a", at(1));
    await cache.get(["a"]);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(cache.path, '{"h":"abc","v":"AAA');
    const again = new EmbeddingCache(cache.path, embedder);
    await again.get(["a"]);
    expect(again.size).toBe(1);
  });
});

describe("semanticDedupe", () => {
  it("drops a pack above the sure line, by meaning, even with no words in common", async () => {
    embedder.place(packText(MEALS), at(1));
    embedder.place(packText(MENUS), at(0.95));
    embedder.place(packText(INVOICES), at(0.3, 2));
    const result = await semanticDedupe([MENUS, INVOICES], [MEALS], { cache });
    expect(result.method).toBe("embeddings");
    expect(result.kept.map((p) => p.id)).toEqual(["invoice-chaser"]);
    expect(result.dropped).toEqual([
      { id: "menu-maker", duplicateOf: "meal-planner", similarity: 0.95, how: "sure" },
    ]);
  });

  it("asks the model in the band, keeps the pair when it says different, and never asks below it", async () => {
    embedder.place(packText(MEALS), at(1));
    embedder.place(packText(TWIN), at(0.85));
    embedder.place(packText(MENUS), at(0.82, 2));
    embedder.place(packText(INVOICES), at(0.5, 3));
    const asked: string[] = [];
    const confirm = async (a: string, b: string) => {
      asked.push(`${a.split("\n")[0]} ~ ${b.split("\n")[0]}`);
      return a.includes("Dinner Planner");
    };
    const result = await semanticDedupe([TWIN, MENUS, INVOICES], [MEALS], { cache, confirm });
    expect(result.dropped).toEqual([
      { id: "dinner-planner", duplicateOf: "meal-planner", similarity: 0.85, how: "confirmed" },
    ]);
    expect(result.kept.map((p) => p.id)).toEqual(["menu-maker", "invoice-chaser"]);
    expect(asked).toEqual([
      "Name: Dinner Planner ~ Name: Meal Planner",
      "Name: Menu Maker ~ Name: Meal Planner",
    ]);
  });

  it("compares a new pack with a shelf pack that has the same id, instead of skipping it", async () => {
    const again = pack("meal-planner", "Meal Planner", "Plans a week of dinners for you.");
    embedder.place(packText(MEALS), at(1));
    embedder.place(packText(again), at(0.96));
    const result = await semanticDedupe([again], [MEALS], { cache });
    expect(result.dropped).toEqual([
      { id: "meal-planner", duplicateOf: "meal-planner", similarity: 0.96, how: "sure" },
    ]);
    expect(result.kept).toEqual([]);
    const fallback = await semanticDedupe([{ ...MEALS }], [MEALS]);
    expect(fallback.method).toBe("words");
    expect(fallback.dropped).toEqual([{ id: "meal-planner", duplicateOf: "meal-planner" }]);
  });

  it("keeps a pair in the band when there is no model to ask", async () => {
    embedder.place(packText(MEALS), at(1));
    embedder.place(packText(TWIN), at(0.85));
    const result = await semanticDedupe([TWIN], [MEALS], { cache });
    expect(result.dropped).toEqual([]);
  });

  it("compares packs in one batch with each other, the earlier one winning", async () => {
    embedder.place(packText(MEALS), at(1));
    embedder.place(packText(MENUS), at(0.97));
    const result = await semanticDedupe([MEALS, MENUS], [], { cache });
    expect(result.dropped.map((d) => [d.id, d.duplicateOf])).toEqual([["menu-maker", "meal-planner"]]);
  });

  it("falls back to word overlap with no embedder, or when the embedder fails, and says why", async () => {
    const copy = pack("meal-planner-2", "Meal Planner", "Plans a week of dinners.");
    const none = await semanticDedupe([copy], [MEALS]);
    expect(none.method).toBe("words");
    expect(none.fallback).toBe("no embedder is configured");
    embedder.fail = true;
    const failed = await semanticDedupe([copy, INVOICES], [MEALS], { cache });
    expect(failed.method).toBe("words");
    expect(failed.fallback).toContain("503");
    expect(failed.dropped.map((d) => d.id)).toEqual(["meal-planner-2"]);
    expect(failed.kept.map((p) => p.id)).toEqual(["invoice-chaser"]);
  });
});

describe("nearDuplicates and similarPairs", () => {
  it("asks about at most maxChecks look-alikes per item, most alike first", async () => {
    embedder.place("x", at(1));
    embedder.place("a", at(0.88, 2));
    embedder.place("b", at(0.86, 3));
    embedder.place("c", at(0.84, 4));
    const asked: string[] = [];
    const result = await nearDuplicates(
      [{ id: "x", text: "x" }],
      ["a", "b", "c"].map((t) => ({ id: t, text: t })),
      {
        cache,
        confirm: async (_a, b) => {
          asked.push(b);
          return false;
        },
        maxChecks: 2,
      },
    );
    expect(asked).toEqual(["a", "b"]);
    expect(result.asked).toBe(2);
    expect(result.kept).toHaveLength(1);
  });

  it("lists the pairs on a shelf at or above a line, most alike first", async () => {
    embedder.place(packText(MEALS), at(1));
    embedder.place(packText(MENUS), at(0.95));
    embedder.place(packText(TWIN), at(0.83, 2));
    embedder.place(packText(INVOICES), at(0.1, 3));
    const pairs = await similarPairs([MEALS, MENUS, TWIN, INVOICES], cache, 0.8);
    expect(pairs.map((p) => `${p.a}~${p.b}`)).toEqual([
      "meal-planner~menu-maker",
      "meal-planner~dinner-planner",
    ]);
    expect(pairs[0]!.similarity).toBe(0.95);
  });
});

describe("configuration", () => {
  it("uses NVIDIA's embedder with a key, a named endpoint when given, and nothing otherwise", () => {
    expect(embedderConfig({})).toBeUndefined();
    expect(embedderConfig({ NVIDIA_API_KEY: "k" })).toEqual({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: "nvidia/nemotron-3.5-embed-1b",
      apiKey: "k",
      via: "NVIDIA_API_KEY",
    });
    expect(
      embedderConfig({ STEWARD_EMBED_BASE_URL: "http://127.0.0.1:11434/v1", STEWARD_EMBED_MODEL: "nomic" }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "nomic",
      via: "STEWARD_EMBED_BASE_URL",
    });
    expect(bandFrom({})).toEqual({ sure: SURE_DUPLICATE, maybe: MAYBE_DUPLICATE });
    expect(bandFrom({ STEWARD_EMBED_SURE: "0.95", STEWARD_EMBED_MAYBE: "0.97" })).toEqual({
      sure: 0.95,
      maybe: 0.95,
    });
  });

  it("posts batches to /embeddings with NVIDIA's input type, and never echoes the body in errors", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      bodies.push(body);
      return new Response(
        JSON.stringify({ data: body.input.map((_, i) => ({ index: i, embedding: [3, 4] })) }),
      );
    }) as unknown as typeof globalThis.fetch;
    const e = createEmbedder(
      { baseUrl: "https://integrate.api.nvidia.com/v1", model: "m", apiKey: "k", via: "x" },
      { fetch, batchSize: 2, pace: { wait: async () => {} } },
    );
    const out = await e.embed(["a", "b", "c"]);
    expect(out).toEqual([
      [0.6, 0.8],
      [0.6, 0.8],
      [0.6, 0.8],
    ]);
    expect(bodies.map((b) => b.input)).toEqual([["a", "b"], ["c"]]);
    expect(bodies[0]).toMatchObject({
      model: "m",
      input_type: "passage",
      truncate: "END",
      encoding_format: "float",
    });

    const bad = createEmbedder(
      { baseUrl: "https://example.org/v1", model: "m", apiKey: "secret-key", via: "x" },
      {
        fetch: (async () =>
          new Response("bad key secret-key", { status: 401 })) as unknown as typeof globalThis.fetch,
        pace: { wait: async () => {} },
      },
    );
    await expect(bad.embed(["a"])).rejects.toThrow("The embedding endpoint answered 401.");
    await expect(bad.embed(["a"])).rejects.not.toThrow(/secret-key/);
  });

  it("shows the model a short card, and reads SAME or DIFFERENT; a failed call keeps both", async () => {
    expect(packCard(MEALS)).toBe(
      "Name: Meal Planner\nPitch: Plans a week of dinners.\nStarters: Plan dinners for four.",
    );
    const answers = ["SAME", "DIFFERENT", "Same.", "I am not sure"];
    const model = { label: "m", complete: async () => answers.shift() ?? "" };
    const confirm = confirmWithModel(model);
    expect([
      await confirm("a", "b"),
      await confirm("a", "b"),
      await confirm("a", "b"),
      await confirm("a", "b"),
    ]).toEqual([true, false, true, false]);
    const failing = confirmWithModel({ label: "m", complete: async () => Promise.reject(new Error("429")) });
    expect(await failing("a", "b")).toBe(false);
  });
});
