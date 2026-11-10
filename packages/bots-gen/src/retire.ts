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
 * job and its look-alikes are not generated again. Bots made or claimed by people are never
 * retired, and neither is a bot whose made-on date cannot be read.
 *
 * Most of the shelf was made on the same two days, so retirement is paced: one run takes at most
 * `RETIRE_SHARE` of a category, the lowest judge scores first, and never takes a category under
 * its floor. A bot held back by the floor can go only when the same run wrote a new bot for that
 * category (with a model, `regenerate`); otherwise the category is reported as thinned.
 */

export const RETIRE_AFTER_DAYS = 90;

/** Fewer live bots than this and a category reads as empty to someone browsing it. */
export const CATEGORY_FLOOR = 20;

/** At most this share of a category's bots leaves in one run (always at least one). */
export const RETIRE_SHARE = 0.1;

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

export const GENERATE_LOG_FILE = "generate-log.jsonl";

/**
 * Each written bot's job and judge score, from `<dir>/generate-log.jsonl`. A bot written twice
 * takes its last row. Empty when there is no log; a line that is not JSON is skipped.
 */
export async function readGenerateLog(dir: string): Promise<{
  jobOf: (id: string) => string | undefined;
  scoreOf: (id: string) => number | undefined;
}> {
  const jobs = new Map<string, string>();
  const scores = new Map<string, number>();
  const path = join(dir, GENERATE_LOG_FILE);
  if (existsSync(path)) {
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      let row: Partial<LogRow>;
      try {
        row = JSON.parse(line) as Partial<LogRow>;
      } catch {
        continue;
      }
      if (row.status !== "written" || typeof row.id !== "string") continue;
      if (typeof row.job === "string") jobs.set(row.id, row.job);
      if (typeof row.score === "number") scores.set(row.id, row.score);
      else scores.delete(row.id);
    }
  }
  return { jobOf: (id) => jobs.get(id), scoreOf: (id) => scores.get(id) };
}

/** Midnight UTC of a `YYYY-MM-DD` (or any ISO) date, or undefined when it cannot be read. */
function dateOf(value: string): number | undefined {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(t) ? t : undefined;
}

export interface HeldBot {
  id: string;
  category: BotCategory;
  /** `cap`: the run already took its share of the category. `floor`: it would go under its floor. */
  reason: "cap" | "floor";
}

export interface RetirementPlan {
  retire: RetiredEntry[];
  /** Due to retire but kept this run, in the order they would go next. */
  held: HeldBot[];
  /** AI-made bots still inside their 90 days, by id, with the days left. */
  young: { id: string; daysLeft: number }[];
  /**
   * Categories whose floor held bots back this run: `live` once this run's bots have gone, and
   * `need`, how many new bots would let that many more go now.
   */
  thinned: { category: BotCategory; live: number; floor: number; need: number }[];
}

export interface PlanOptions {
  packs: readonly BotPack[];
  counts: Counts;
  now: Date;
  days?: number;
  floor?: number;
  /** At most this share of a category goes in one run; `RETIRE_SHARE` by default. */
  share?: number;
  /** id → job, from the generate log. */
  jobOf?: (id: string) => string | undefined;
  /** id → the judge's score, from the generate log. The lowest go first; no score goes before any. */
  scoreOf?: (id: string) => number | undefined;
}

function retiredEntry(pack: BotPack, opts: PlanOptions, days: number): RetiredEntry {
  const job = opts.jobOf?.(pack.id);
  const generated = pack.author.kind === "ai" ? pack.author.generated : undefined;
  return {
    id: pack.id,
    name: pack.name,
    pitch: pack.pitch,
    category: pack.category,
    ...(job ? { job } : {}),
    ...(generated ? { generated } : {}),
    ...(pack.author.kind === "ai" ? { model: pack.author.model } : {}),
    retiredAt: opts.now.toISOString(),
    reason: `AI-made on ${generated} and not installed or used by anyone in ${days} days`,
  };
}

/** What retirement would do. Nothing is changed; `applyRetirement` does that. */
export function planRetirement(opts: PlanOptions): RetirementPlan {
  const days = opts.days ?? RETIRE_AFTER_DAYS;
  const floor = opts.floor ?? CATEGORY_FLOOR;
  const share = opts.share ?? RETIRE_SHARE;
  const now = opts.now.getTime();
  const due: { pack: BotPack; made: number }[] = [];
  const young: RetirementPlan["young"] = [];
  const live = new Map<BotCategory, number>();
  for (const pack of opts.packs) {
    live.set(pack.category, (live.get(pack.category) ?? 0) + 1);
    if (pack.author.kind !== "ai") continue;
    const count = opts.counts[pack.id];
    if ((count?.installs ?? 0) > 0 || (count?.usedBy ?? 0) > 0) continue;
    const made = dateOf(pack.author.generated);
    if (made === undefined) continue;
    const age = (now - made) / 86_400_000;
    if (age < days) young.push({ id: pack.id, daysLeft: Math.ceil(days - age) });
    else due.push({ pack, made });
  }

  // Worst first: no score, then the lowest score, then the oldest, then by id.
  const score = (id: string) => opts.scoreOf?.(id) ?? Number.NEGATIVE_INFINITY;
  const order = (a: (typeof due)[number], b: (typeof due)[number]) =>
    score(a.pack.id) - score(b.pack.id) || a.made - b.made || a.pack.id.localeCompare(b.pack.id);
  const going = new Set<string>();
  const held: HeldBot[] = [];
  const thinned: RetirementPlan["thinned"] = [];
  const categories = [...new Set([...(Object.keys(BOT_CATEGORIES) as BotCategory[]), ...live.keys()])];
  for (const category of categories) {
    const list = due.filter((d) => d.pack.category === category).sort(order);
    if (list.length === 0) continue;
    const total = live.get(category) ?? 0;
    const cap = Math.max(1, Math.floor(total * share));
    const room = Math.max(0, total - floor);
    const take = Math.min(list.length, cap, room);
    const withinRoom = Math.min(list.length, room);
    list.forEach((d, i) => {
      if (i < take) going.add(d.pack.id);
      else held.push({ id: d.pack.id, category, reason: i < withinRoom ? "cap" : "floor" });
    });
    const need = Math.min(list.length - withinRoom, cap - take);
    if (need > 0) thinned.push({ category, live: total - take, floor, need });
  }
  const retire = opts.packs.filter((p) => going.has(p.id)).map((p) => retiredEntry(p, opts, days));
  return { retire, held, young, thinned };
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
  /** At most this share of a category goes in one run; `RETIRE_SHARE` by default. */
  share?: number;
  /** False plans only: nothing is removed. */
  apply?: boolean;
  /** id → job. Read from `<dir>/generate-log.jsonl` when not given. */
  jobOf?: (id: string) => string | undefined;
  /** id → judge score. Read from `<dir>/generate-log.jsonl` when not given. */
  scoreOf?: (id: string) => number | undefined;
  /** How to rebuild once bots are gone; `buildIndex(dir)` by default. */
  rebuild?: (dir: string) => Promise<void>;
  /** Writes new bots for thinned categories when given a model, so bots the floor held can go. */
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
  const fromLog = opts.jobOf && opts.scoreOf ? undefined : await readGenerateLog(opts.dir);
  const planOptions: PlanOptions = {
    packs,
    counts: opts.counts,
    now: opts.now,
    days: opts.days,
    floor: opts.floor,
    share: opts.share,
    jobOf: opts.jobOf ?? fromLog?.jobOf,
    scoreOf: opts.scoreOf ?? fromLog?.scoreOf,
  };
  const plan = planRetirement(planOptions);
  const run: RetirementRun = {
    ...plan,
    retire: [...plan.retire],
    held: [...plan.held],
    applied: false,
    regenerated: [],
    outOfJobs: [],
  };
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
    const byId = new Map(packs.map((p) => [p.id, p]));
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
        `Topping up ${thin.category}: ${pick.length} new bot${pick.length === 1 ? "" : "s"}, so as many unused ones can go.`,
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
      // Each new bot lets one bot the floor held go, worst first.
      const written = result.written.filter((r) => r.category === thin.category).length;
      const freed = run.held
        .filter((h) => h.category === thin.category && h.reason === "floor")
        .slice(0, written);
      if (freed.length === 0) continue;
      const entries = freed.map((h) =>
        retiredEntry(byId.get(h.id)!, planOptions, opts.days ?? RETIRE_AFTER_DAYS),
      );
      await applyRetirement(opts.dir, entries);
      log(
        `Retired ${entries.length} more in ${thin.category}, now replaced: ${entries.map((e) => e.id).join(", ")}`,
      );
      run.retire.push(...entries);
      const ids = new Set(freed.map((h) => h.id));
      run.held = run.held.filter((h) => !ids.has(h.id));
    }
  }
  if (run.held.length > 0) {
    const byFloor = run.held.filter((h) => h.reason === "floor").length;
    log(
      `Held back ${run.held.length}: ${run.held.length - byFloor} by the share a run may take, ${byFloor} by the category floor.`,
    );
  }
  if (run.retire.length > 0 || run.regenerated.length > 0) {
    await (opts.rebuild ? opts.rebuild(opts.dir) : buildIndex(opts.dir).then(() => undefined));
  }
  return run;
}
