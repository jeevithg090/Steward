import { existsSync, readFileSync } from "node:fs";
import { BOT_CATEGORIES, type BotCategory } from "@steward/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * The taxonomy: `jobs.yaml`, one list of jobs per category, each written as a person would ask.
 * It is the one file in this package where human time is spent; the generator turns each line into
 * a pack.
 */

export const JobSchema = z.object({
  job: z.string().min(8).max(300),
  /** Tools the job probably needs; a hint to the generator, never a grant. */
  tools: z.array(z.string().min(1)).default([]),
  connectors: z.array(z.enum(["mail", "calendar"])).default([]),
});

export interface Job extends z.infer<typeof JobSchema> {
  category: BotCategory;
  /** `ai` for a job from `jobs-ai.yaml`, proposed by a model and not yet read by a person. */
  source?: "ai";
}

const CATEGORY_KEYS = Object.keys(BOT_CATEGORIES) as BotCategory[];

export const JOBS_FILE = new URL("./jobs.yaml", import.meta.url);
/** Jobs a model proposed (`seed jobs`); see taxonomy.ts. */
export const AI_JOBS_PATH = new URL("./jobs-ai.yaml", import.meta.url);

/** Reads and checks the taxonomy. Throws naming the category and the line when it is wrong. */
export function parseJobs(text: string): Job[] {
  const raw = parseYaml(text) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("jobs.yaml must be a map of category to a list of jobs");
  }
  const out: Job[] = [];
  for (const [category, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!CATEGORY_KEYS.includes(category as BotCategory)) {
      throw new Error(`jobs.yaml: "${category}" is not a category in BOT_CATEGORIES`);
    }
    if (!Array.isArray(list)) throw new Error(`jobs.yaml: ${category}: must be a list`);
    list.forEach((item, i) => {
      const checked = JobSchema.safeParse(item);
      if (!checked.success) {
        const first = checked.error.issues[0];
        throw new Error(
          `jobs.yaml: ${category}[${i}]: ${first?.path.join(".") ?? ""} ${first?.message ?? "is wrong"}`,
        );
      }
      out.push({ category: category as BotCategory, ...checked.data });
    });
  }
  return out;
}

/**
 * The taxonomy. With the default file, the model-proposed jobs in `jobs-ai.yaml` come after the
 * ones people wrote, marked `source: "ai"`, unless `{ ai: false }`.
 */
export function loadJobs(file: URL | string = JOBS_FILE, opts: { ai?: boolean } = {}): Job[] {
  const jobs = parseJobs(readFileSync(file, "utf8"));
  if (file !== JOBS_FILE || opts.ai === false || !existsSync(AI_JOBS_PATH)) return jobs;
  const seen = new Set(jobs.map((j) => j.job.toLowerCase()));
  const more = parseJobs(readFileSync(AI_JOBS_PATH, "utf8"))
    .filter((j) => !seen.has(j.job.toLowerCase()))
    .map((j) => ({ ...j, source: "ai" as const }));
  return [...jobs, ...more];
}

/** Round-robin across categories, so taking the first N covers every category evenly. */
export function interleaveByCategory(jobs: readonly Job[]): Job[] {
  const byCategory = new Map<BotCategory, Job[]>();
  for (const job of jobs) {
    const list = byCategory.get(job.category) ?? [];
    list.push(job);
    byCategory.set(job.category, list);
  }
  const out: Job[] = [];
  let added = true;
  for (let round = 0; added; round++) {
    added = false;
    for (const category of CATEGORY_KEYS) {
      const job = byCategory.get(category)?.[round];
      if (job) {
        out.push(job);
        added = true;
      }
    }
  }
  return out;
}
