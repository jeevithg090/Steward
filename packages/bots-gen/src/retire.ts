import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildIndex, parseBotFolder, type ValidateContext } from "@steward/bots";
import { BOT_CATEGORIES, type BotCategory, type BotPack, type TextModel } from "@steward/shared";
import { z } from "zod";
import { generateBatch, type LogRow } from "./batch.ts";
import type { ConfirmSame, EmbeddingCache } from "./embed.ts";
import type { Job } from "./jobs.ts";

/**
 * Retirement (plan §4.6): an AI-made bot that nobody has installed or said they use within 90
 * days of being made leaves the shelf. It goes on `retired.json` in the directory folder, so its
 * job and its look-alikes are not generated again, and a category that falls under its floor is
 * topped up with new bots. Bots made or claimed by people are never retired, and neither is a bot
 * whose made-on date cannot be read.
 */

export const RETIRE_AFTER_DAYS = 90;

/** Fewer live bots than this and a category reads as empty to someone browsing it. */
export const CATEGORY_FLOOR = 20;

export const RetiredEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pitch: z.string().min(1),
  category: z.string().min(1),
  /** The job it was generated from, when the generate log knew it. */
  job: z.string().optional(),
  /** `author.generated`. */
  generated: z.string().optional(),
  model: z.string().optional(),
  retiredAt: z.string().min(1),
  reason: z.string().min(1),
});
export type RetiredEntry = z.infer<typeof RetiredEntrySchema>;

const RetiredFileSchema = z.object({ retired: z.array(RetiredEntrySchema) });

export const RETIRED_FILE = "retired.json";

export type Counts = Record<string, { installs?: number; usedBy?: number }>;

export async function readRetired(dir: string): Promise<RetiredEntry[]> {
  const path = join(dir, RETIRED_FILE);
  if (!existsSync(path)) return [];
  const checked = RetiredFileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!checked.success) throw new Error(`${RETIRED_FILE} is not a { retired: [...] } list`);
  return checked.data.retired;
}

export async function writeRetired(dir: string, entries: readonly RetiredEntry[]): Promise<void> {
  const sorted = [...entries].sort(
    (a, b) => a.retiredAt.localeCompare(b.retiredAt) || a.id.localeCompare(b.id),
  );
  await writeFile(join(dir, RETIRED_FILE), `${JSON.stringify({ retired: sorted }, null, 2)}\n`, "utf8");
}

export async function readCounts(dir: string): Promise<Counts> {
  const path = join(dir, "counts.json");
  if (!existsSync(path)) return {};
  return JSON.parse(await readFile(path, "utf8")) as Counts;
}

/** Midnight UTC of a `YYYY-MM-DD` (or any ISO) date, or undefined when it cannot be read. */
function dateOf(value: string): number | undefined {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(t) ? t : undefined;
}

export interface RetirementPlan {
  retire: RetiredEntry[];
  /** AI-made bots still inside their 90 days, by id, with the days left. */
  young: { id: string; daysLeft: number }[];
  /** Categories under the floor once the retired bots have gone, and how many to add. */
  thinned: { category: BotCategory; live: number; floor: number; need: number }[];
}

export interface PlanOptions {
  packs: readonly BotPack[];
  counts: Counts;
  now: Date;
  days?: number;
  floor?: number;
  /** id → job, from the generate log. */
  jobOf?: (id: string) => string | undefined;
}

/** What retirement would do. Nothing is changed; `applyRetirement` does that. */
export function planRetirement(opts: PlanOptions): RetirementPlan {
  const days = opts.days ?? RETIRE_AFTER_DAYS;
  const floor = opts.floor ?? CATEGORY_FLOOR;
  const now = opts.now.getTime();
  const retire: RetiredEntry[] = [];
  const young: RetirementPlan["young"] = [];
  for (const pack of opts.packs) {
    if (pack.author.kind !== "ai") continue;
    const count = opts.counts[pack.id];
    if ((count?.installs ?? 0) > 0 || (count?.usedBy ?? 0) > 0) continue;
    const made = dateOf(pack.author.generated);
    if (made === undefined) continue;
    const age = (now - made) / 86_400_000;
    if (age < days) {
      young.push({ id: pack.id, daysLeft: Math.ceil(days - age) });
      continue;
    }
    const job = opts.jobOf?.(pack.id);
    retire.push({
      id: pack.id,
      name: pack.name,
      pitch: pack.pitch,
      category: pack.category,
      ...(job ? { job } : {}),
      generated: pack.author.generated,
      model: pack.author.model,
      retiredAt: opts.now.toISOString(),
      reason: `AI-made on ${pack.author.generated} and not installed or used by anyone in ${days} days`,
    });
  }
  const gone = new Set(retire.map((r) => r.id));
  const live = new Map<string, number>();
  for (const pack of opts.packs)
    if (!gone.has(pack.id)) live.set(pack.category, (live.get(pack.category) ?? 0) + 1);
  // Only categories that lost bots now count as thinned: one that was always small is the
  // generator's job, not retirement's.
  const touched = new Set(retire.map((r) => r.category));
  const thinned = (Object.keys(BOT_CATEGORIES) as BotCategory[])
    .filter((c) => touched.has(c))
    .map((category) => ({
      category,
      live: live.get(category) ?? 0,
      floor,
      need: Math.max(0, floor - (live.get(category) ?? 0)),
    }))
    .filter((t) => t.need > 0);
  return { retire, young, thinned };
}

/**
 * Removes each retired bot's folder and built pack and adds it to `retired.json`. The caller
 * rebuilds the index afterwards (`buildIndex`), which drops the listing.
 */
export async function applyRetirement(dir: string, entries: readonly RetiredEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const existing = await readRetired(dir);
  const ids = new Set(existing.map((e) => e.id));
  for (const entry of entries) {
    await rm(join(dir, "bots", entry.id), { recursive: true, force: true });
    await rm(join(dir, "packs", `${entry.id}.json`), { force: true });
  }
  await writeRetired(dir, [...existing, ...entries.filter((e) => !ids.has(e.id))]);
}

// ── One run: plan, apply, rebuild, top up ───────────────────────────────────────────────────────

export interface RegenerateOptions {
  model: TextModel;
  judge?: TextModel;
  /** The taxonomy to draw from: `loadJobs()`. */
  jobs: readonly Job[];
  /** Jobs that already have a bot or were dropped for good (from the generate log). */
  done?: ReadonlySet<string>;
  ctx: ValidateContext;
  cache?: EmbeddingCache;
  confirm?: ConfirmSame;
  record?: (row: LogRow) => Promise<void>;
  concurrency?: number;
}

export interface RunRetirementOptions {
  dir: string;
  counts: Counts;
  now: Date;
  days?: number;
  floor?: number;
  /** False plans only: nothing is removed. */
  apply?: boolean;
  jobOf?: (id: string) => string | undefined;
  /** How to rebuild once bots are gone; `buildIndex(dir)` by default. */
  rebuild?: (dir: string) => Promise<void>;
  /** Tops up thinned categories with new bots when given a model. */
  regenerate?: RegenerateOptions;
  log?: (line: string) => void;
}

export interface RetirementRun extends RetirementPlan {
  applied: boolean;
  regenerated: LogRow[];
  /** Thinned categories that had no unused job left to draw from. */
  outOfJobs: string[];
}

export async function runRetirement(opts: RunRetirementOptions): Promise<RetirementRun> {
  const log = opts.log ?? (() => {});
  const packs: BotPack[] = [];
  const botsDir = join(opts.dir, "bots");
  if (existsSync(botsDir)) {
    for (const entry of await readdir(botsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        packs.push(await parseBotFolder(join(botsDir, entry.name)));
      } catch {
        // A broken folder is the build's to report; retirement leaves it alone.
      }
    }
  }
  const plan = planRetirement({
    packs,
    counts: opts.counts,
    now: opts.now,
    days: opts.days,
    floor: opts.floor,
    jobOf: opts.jobOf,
  });
  const run: RetirementRun = { ...plan, applied: false, regenerated: [], outOfJobs: [] };
  if (!opts.apply) return run;
  if (plan.retire.length > 0) {
    await applyRetirement(opts.dir, plan.retire);
    log(`Retired ${plan.retire.length}: ${plan.retire.map((r) => r.id).join(", ")}`);
  }
  run.applied = true;
  const regen = opts.regenerate;
  if (regen && plan.thinned.length > 0) {
    const retired = await readRetired(opts.dir);
    const retiredJobs = new Set(retired.flatMap((r) => (r.job ? [r.job.toLowerCase()] : [])));
    const gone = new Set(plan.retire.map((r) => r.id));
    const shelf = packs.filter((p) => !gone.has(p.id));
    for (const thin of plan.thinned) {
      const pick = regen.jobs
        .filter(
          (j) =>
            j.category === thin.category && !regen.done?.has(j.job) && !retiredJobs.has(j.job.toLowerCase()),
        )
        .slice(0, thin.need);
      if (pick.length < thin.need) run.outOfJobs.push(thin.category);
      if (pick.length === 0) continue;
      log(
        `Topping up ${thin.category}: ${pick.length} new bot${pick.length === 1 ? "" : "s"} for ${thin.need} missing.`,
      );
      const result = await generateBatch({
        jobs: pick,
        botsDir,
        ctx: regen.ctx,
        model: regen.model,
        ...(regen.judge ? { judge: regen.judge } : {}),
        shelf,
        retired,
        ...(regen.cache ? { cache: regen.cache } : {}),
        ...(regen.confirm ? { confirm: regen.confirm } : {}),
        concurrency: regen.concurrency ?? 2,
        ...(regen.record ? { record: regen.record } : {}),
        log,
        now: () => opts.now,
      });
      run.regenerated.push(...result.written);
    }
  }
  if (plan.retire.length > 0 || run.regenerated.length > 0) {
    await (opts.rebuild ? opts.rebuild(opts.dir) : buildIndex(opts.dir).then(() => undefined));
  }
  return run;
}
