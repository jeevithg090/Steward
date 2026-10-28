import { BOT_CATEGORIES, type BotCategory, isBuiltinTool } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { interleaveByCategory, loadJobs, parseJobs } from "../src/jobs.ts";
import { isPackTool } from "../src/prompt.ts";

describe("jobs.yaml", () => {
  const jobs = loadJobs();

  it("has ten or more jobs in every category, about 220 in all", () => {
    const counts = new Map<BotCategory, number>();
    for (const job of jobs) counts.set(job.category, (counts.get(job.category) ?? 0) + 1);
    for (const category of Object.keys(BOT_CATEGORIES) as BotCategory[]) {
      expect(counts.get(category) ?? 0, category).toBeGreaterThanOrEqual(10);
    }
    expect(jobs.length).toBeGreaterThanOrEqual(200);
    expect(jobs.length).toBeLessThanOrEqual(260);
  });

  it("names only tools in the catalogue that a pack may use, and only mail or calendar connectors", () => {
    for (const job of jobs) {
      for (const tool of job.tools) {
        expect(isBuiltinTool(tool), `${job.job}: ${tool}`).toBe(true);
        expect(isPackTool(tool), `${job.job}: ${tool}`).toBe(true);
      }
      for (const connector of job.connectors) expect(["mail", "calendar"]).toContain(connector);
      expect(job.tools.length, job.job).toBeGreaterThan(0);
    }
  });

  it("has no two jobs with the same text", () => {
    expect(new Set(jobs.map((j) => j.job.toLowerCase())).size).toBe(jobs.length);
  });

  it("interleaves so the first nineteen cover every category", () => {
    const first = interleaveByCategory(jobs).slice(0, Object.keys(BOT_CATEGORIES).length);
    expect(new Set(first.map((j) => j.category)).size).toBe(Object.keys(BOT_CATEGORIES).length);
  });

  it("names the category and line when the file is wrong", () => {
    expect(() => parseJobs("nope:\n  - job: do a thing for me\n")).toThrow(/"nope" is not a category/);
    expect(() => parseJobs("food:\n  - job: x\n")).toThrow(/food\[0\]/);
  });
});
