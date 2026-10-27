import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVAL_NOW,
  EVAL_OWNER,
  pairResults,
  parseDataset,
  renderResults,
  score,
  summaryTable,
  toTriageEmail,
} from "../src/eval/dataset.ts";
import {
  createOpenAICompatibleModel,
  DEFAULT_OPENROUTER_EVAL_MODEL,
  evalModelConfig,
} from "../src/eval/model.ts";
import { triageEmails } from "../src/triage.ts";
import { fakeModel } from "./helpers.ts";

const DATASET = fileURLToPath(new URL("../../../evals/triage/dataset.jsonl", import.meta.url));
const set = parseDataset(readFileSync(DATASET, "utf8"));

describe("the triage eval set", () => {
  it("has 62 labelled messages, 27 that need the person and 35 that can wait", () => {
    expect(set).toHaveLength(62);
    expect(set.filter((row) => row.label === "needs_you")).toHaveLength(27);
    expect(set.filter((row) => row.label === "can_wait")).toHaveLength(35);
  });

  it("never names the inbox owner, and its reasons speak to the person as you", () => {
    const text = readFileSync(DATASET, "utf8");
    expect(text.toLowerCase()).not.toContain("maya");
    for (const row of set) expect(row.why).not.toMatch(/\b(she|her|hers)\b/i);
    expect(
      set.every((row) => [...row.to, ...row.cc].some((a) => a.email === EVAL_OWNER) || row.id === "n26"),
    ).toBe(true);
  });

  it("refuses a malformed row with its line number", () => {
    expect(() => parseDataset('{"id":"n01","label":"maybe"}\n')).toThrow(/line 1/);
  });

  it("rules alone settle 12 messages and get none wrong; the rest show as needs you", async () => {
    const run = await triageEmails(set.map(toTriageEmail), { now: EVAL_NOW, ownerEmail: EVAL_OWNER });
    const metrics = score(pairResults(set, run));
    expect(metrics.byRules).toBe(12);
    expect(metrics.ruleWrong).toBe(0);
    expect(metrics.unsorted).toBe(50);
    expect(metrics.recall).toBe(1);
    // The two cases that list headers used to hide must reach the model.
    const n26 = run.items[set.findIndex((row) => row.id === "n26")];
    const n27 = run.items[set.findIndex((row) => row.id === "n27")];
    expect([n26?.confidence, n27?.confidence]).toEqual([0, 0]);
  });

  it("scores a model that agrees with every label as perfect, and writes the results", async () => {
    const labels = new Map(set.map((row) => [row.subject, row.label]));
    const model = fakeModel(({ prompt }) => {
      const subject = /Subject: (.*)/.exec(prompt)?.[1] ?? "";
      return JSON.stringify({ verdict: labels.get(subject), reason: "As labelled." });
    });
    const run = await triageEmails(set.map(toTriageEmail), { now: EVAL_NOW, ownerEmail: EVAL_OWNER, model });
    const rows = pairResults(set, run);
    const metrics = score(rows);
    expect(metrics).toMatchObject({ precision: 1, recall: 1, f2: 1, accuracy: 1, byModel: 50, byRules: 12 });
    // The prompt never carries a person's name.
    expect(model.calls.every((call) => !/maya/i.test(call.system + call.prompt))).toBe(true);

    const sections = [{ title: "Rules, then the model", model: "fake-model", rows, metrics }];
    const markdown = renderResults(sections, {
      ranAt: new Date("2026-10-27T00:00:00Z"),
      datasetSize: set.length,
    });
    expect(markdown).toMatch(
      /\| Rules, then the model \| fake-model \| 100\.0% \(27 of 27\) +\| 100\.0% \(27 of 27\) +\|/,
    );
    // Columns are padded like the repo's formatter pads them, so the file passes `biome check`.
    const lines = markdown.split("\n");
    const start = lines.findIndex((line) => line.startsWith("| id "));
    const table = lines.slice(start, start + 2 + set.length);
    expect(table[0]?.startsWith("| id  | label     | verdict   | by    | reason ")).toBe(true);
    expect(new Set(table.map((line) => line.length)).size).toBe(1);
    expect(markdown).toContain("### Disagreements\n\nNone.");
    expect(summaryTable(sections)).toContain("Rules, then the model");
  });

  it("weights recall over precision in F2", () => {
    const item = set[0]!;
    const result = {
      emailId: item.id,
      subject: item.subject,
      from: item.from,
      reason: "x",
      confidence: 0.75,
      by: "model" as const,
    };
    const can = set.find((row) => row.label === "can_wait")!;
    // One right, one false alarm: precision 50%, recall 100%.
    const m = score([
      { item, result: { ...result, verdict: "needs_you" } },
      { item: can, result: { ...result, emailId: can.id, verdict: "needs_you" } },
    ]);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(1);
    expect(m.f2).toBeCloseTo(5 / 6, 5);
  });
});

describe("the eval's model client", () => {
  it("posts a chat completion with the key as a bearer token and temperature 0", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const model = createOpenAICompatibleModel({
      baseUrl: "https://llm.example/v1/",
      apiKey: "test-key",
      model: "small-model",
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"can_wait","reason":"x"}' } }] }),
        );
      }) as typeof fetch,
    });
    expect(model.label).toBe("small-model");
    expect(await model.complete({ system: "S", prompt: "P", maxTokens: 50 })).toBe(
      '{"verdict":"can_wait","reason":"x"}',
    );
    if (!seen) throw new Error("no request was made");
    expect(seen.url).toBe("https://llm.example/v1/chat/completions");
    expect((seen.init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(seen.init.body))).toEqual({
      model: "small-model",
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "P" },
      ],
      max_tokens: 50,
      temperature: 0,
    });
  });

  it("reports a failed request by status only, never echoing the body", async () => {
    const model = createOpenAICompatibleModel({
      baseUrl: "https://llm.example/v1",
      model: "m",
      fetch: (async () =>
        new Response("Incorrect API key provided: sk-****abcd", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(model.complete({ system: "", prompt: "" })).rejects.toThrow(
      "The model endpoint answered 401.",
    );
  });

  it("takes its settings from STEWARD_EVAL_* first, then OpenRouter, ignoring blanks", () => {
    expect(evalModelConfig({})).toBeUndefined();
    expect(evalModelConfig({ STEWARD_EVAL_BASE_URL: " ", OPENROUTER_API_KEY: "" })).toBeUndefined();
    expect(evalModelConfig({ OPENROUTER_API_KEY: "or-key" })).toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      model: DEFAULT_OPENROUTER_EVAL_MODEL,
      apiKey: "or-key",
    });
    expect(
      evalModelConfig({
        STEWARD_EVAL_BASE_URL: "http://localhost:11434/v1",
        STEWARD_EVAL_MODEL: "llama",
        OPENROUTER_API_KEY: "or",
      }),
    ).toEqual({ baseUrl: "http://localhost:11434/v1", model: "llama", via: "STEWARD_EVAL_BASE_URL" });
  });
});
