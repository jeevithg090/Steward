import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildIndex, parseBotFolder, validatePack, writeBotFolder } from "@steward/bots";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { BOT_CATEGORIES, type BotCategory, type BotPack, type TextModel, TOOLS } from "@steward/shared";
import { generateBatch, type LogRow } from "./batch.ts";
import { convertLobeAgent, isEnglishLobeFile, LOBE_CONTENTS_API, LOBE_RAW_BASE } from "./convert/lobe.ts";
import { convertOpenBotCoworker } from "./convert/openbot.ts";
import {
  bandFrom,
  type ConfirmSame,
  confirmWithModel,
  createEmbedder,
  EmbeddingCache,
  embedderConfig,
  packCard,
  similarPairs,
} from "./embed.ts";
import type { Problem } from "./generate.ts";
import { interleaveByCategory, JOBS_FILE, loadJobs } from "./jobs.ts";
import { createSeedModel, judgeConfig, seedModelConfig } from "./model.ts";
import { type RegenerateOptions, readCounts, readRetired, runRetirement } from "./retire.ts";
import { proposeJobs, readAiJobs, writeAiJobs } from "./taxonomy.ts";

/**
 * `pnpm --filter @steward/bots-gen seed <command>`: converts the seeds, generates bots with a model,
 * builds the index and reports. Every pack goes through `validatePack` before it is written to
 * `directory/bots/<id>/`, and `build` runs the gateway's own rule check again.
 *
 *   convert-openbot [--dir <folder>]
 *   convert-lobe [--cache <folder>] [--limit N] [--refresh]
 *   jobs [--target 106] [--category <key>] [--per-call 25] [--rounds 8]
 *   generate --limit N [--category <key>] [--concurrency 4] [--template] [--no-judge] [--retry-dropped]
 *   dedupe [--confirm] [--min 0.8]
 *   retire [--days 90] [--floor 20] [--now <date>] [--apply] [--regenerate]
 *   build [--site <url>] [--name <text>]
 *   report [--write]
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const DIRECTORY = join(ROOT, "directory");
const BOTS_DIR = join(DIRECTORY, "bots");
const SEEDS = join(ROOT, ".steward-data", "seeds");
const OPENBOT_SEEDS = resolve(import.meta.dirname, "../seeds/openbot");
/**
 * One line per job tried: what was written, what was dropped and why, how long it took. Kept in
 * the directory and committed with the packs, so a run can be resumed from any checkout.
 */
const GENERATE_LOG = join(DIRECTORY, "generate-log.jsonl");
/** Where the log lived before 28 Oct 2026; copied over once. */
const OLD_GENERATE_LOG = join(SEEDS, "generate-log.jsonl");
/** Vectors by text hash, one file per embedding model; never committed (`.steward-data`). */
const EMBEDDINGS = join(SEEDS, "embeddings");

// The same rule check the gateway runs, so a pack that passes here passes at install time.
const ENGINE = new CelEngine(CONTEXT_SCHEMA, neutralContext);
const CTX = { tools: Object.keys(TOOLS), validateRule: (when: string) => ENGINE.validate(when) };

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

function describe(problems: readonly Problem[]): string {
  return problems
    .filter((p) => p.severity === "error")
    .map((p) => `${p.path}: ${p.message}`)
    .join("; ");
}

/** Validates, then writes the folder. Returns the errors when the pack cannot be written. */
async function writePack(pack: BotPack): Promise<{ written: boolean; problems: Problem[] }> {
  const result = validatePack(pack, CTX);
  if (!result.ok || !result.pack) return { written: false, problems: result.problems };
  await writeBotFolder(join(BOTS_DIR, pack.id), result.pack);
  return { written: true, problems: result.problems };
}

async function existingPacks(): Promise<BotPack[]> {
  if (!existsSync(BOTS_DIR)) return [];
  const folders = (await readdir(BOTS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const packs: BotPack[] = [];
  for (const folder of folders) {
    try {
      packs.push(await parseBotFolder(join(BOTS_DIR, folder)));
    } catch (err) {
      log(`bots/${folder}: cannot read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return packs;
}

function tally<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function formatTally(counts: Record<string, number>): string {
  return (
    Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ") || "none"
  );
}

// ── convert-openbot ────────────────────────────────────────────────────────────────────────────

async function convertOpenBot(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  let written = 0;
  const failed: string[] = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    try {
      const pack = convertOpenBotCoworker(text);
      const result = await writePack(pack);
      if (result.written) {
        written++;
        log(`openbot: ${file} → bots/${pack.id}`);
      } else failed.push(`${file}: ${describe(result.problems)}`);
    } catch (err) {
      failed.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log(`OpenBot: ${written} written, ${failed.length} failed.`);
  for (const line of failed) log(`  ${line}`);
}

// ── convert-lobe ───────────────────────────────────────────────────────────────────────────────

async function lobeFileList(cache: string, refresh: boolean): Promise<string[]> {
  const listFile = join(cache, "_files.json");
  if (!refresh && existsSync(listFile)) return JSON.parse(await readFile(listFile, "utf8")) as string[];
  const token = process.env.GITHUB_TOKEN?.trim();
  const response = await fetch(LOBE_CONTENTS_API, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub's contents API answered ${response.status}.`);
  const entries = (await response.json()) as { name?: string; type?: string }[];
  const names = entries
    .filter((e) => e.type === "file" && typeof e.name === "string" && e.name.endsWith(".json"))
    .map((e) => e.name as string);
  await writeFile(listFile, `${JSON.stringify(names, null, 2)}\n`, "utf8");
  return names;
}

async function lobeFile(cache: string, name: string): Promise<string> {
  const path = join(cache, name);
  if (existsSync(path)) return readFile(path, "utf8");
  const response = await fetch(`${LOBE_RAW_BASE}${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`download answered ${response.status}`);
  const text = await response.text();
  await writeFile(path, text, "utf8");
  return text;
}

async function convertLobe(cache: string, limit: number | undefined, refresh: boolean): Promise<void> {
  await mkdir(cache, { recursive: true });
  const all = await lobeFileList(cache, refresh);
  const english = all.filter(isEnglishLobeFile).slice(0, limit ?? all.length);
  log(`LobeChat: ${all.length} files listed, ${english.length} English-named.`);
  let written = 0;
  const skipped: string[] = [];
  const failed: string[] = [];
  const categories: string[] = [];
  for (const name of english) {
    let json: unknown;
    try {
      json = JSON.parse(await lobeFile(cache, name));
    } catch (err) {
      failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const converted = convertLobeAgent(json, { file: name });
    if (!converted.ok) {
      skipped.push(converted.reason);
      continue;
    }
    const result = await writePack(converted.pack);
    if (result.written) {
      written++;
      categories.push(converted.pack.category);
    } else {
      failed.push(`${name}: ${describe(result.problems)}`);
    }
  }
  log(`LobeChat: ${written} written, ${skipped.length} skipped, ${failed.length} failed validation.`);
  log(`  skipped: ${formatTally(tally(skipped, (s) => s))}`);
  log(`  by category: ${formatTally(tally(categories, (c) => c))}`);
  for (const line of failed) log(`  failed: ${line}`);
}

// ── shared setup: the model, the embedder, the log ─────────────────────────────────────────────

async function moveOldLog(): Promise<void> {
  if (!existsSync(GENERATE_LOG) && existsSync(OLD_GENERATE_LOG))
    await copyFile(OLD_GENERATE_LOG, GENERATE_LOG);
}

async function readLog(): Promise<LogRow[]> {
  await moveOldLog();
  if (!existsSync(GENERATE_LOG)) return [];
  const text = await readFile(GENERATE_LOG, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogRow);
}

async function appendLog(row: LogRow): Promise<void> {
  await moveOldLog();
  await appendFile(GENERATE_LOG, `${JSON.stringify(row)}\n`, "utf8");
}

/** Drops that would happen again on a rerun: the job is skipped next time unless --retry-dropped. */
const FINAL_DROP = /^(duplicate of|below the bar|retired|failed validation)/;

/** Jobs a rerun should skip: written, or dropped for a reason that would repeat. */
async function doneJobs(retryDropped: boolean): Promise<Set<string>> {
  const rows = await readLog();
  return new Set(
    rows
      .filter((r) => r.status === "written" || (!retryDropped && FINAL_DROP.test(r.reason ?? "")))
      .map((r) => r.job),
  );
}

async function probeModel(model: TextModel): Promise<string | undefined> {
  try {
    await model.complete({ system: "Answer with one word.", prompt: "Say ok.", maxTokens: 20 });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

interface Models {
  model?: TextModel;
  judge?: TextModel;
  via: string;
}

async function seedModels(template: boolean): Promise<Models> {
  if (template) return { via: "template" };
  const cfg = seedModelConfig(process.env);
  if (!cfg) {
    log(
      "No model key found (NVIDIA_API_KEY or STEWARD_SEED_BASE_URL + STEWARD_SEED_MODEL); using the template generator.",
    );
    return { via: "template" };
  }
  const candidate = createSeedModel(cfg, { temperature: 0.6 });
  const failure = await probeModel(candidate);
  if (failure) {
    log(
      `The model (${cfg.model} via ${cfg.via}) could not be used: ${failure}. Falling back to the template generator.`,
    );
    return { via: "template" };
  }
  return {
    model: candidate,
    judge: createSeedModel(judgeConfig(cfg), { temperature: 0 }),
    via: `${cfg.model} via ${cfg.via}${cfg.judgeModel ? `, judged by ${cfg.judgeModel}` : ""}`,
  };
}

interface Meaning {
  cache?: EmbeddingCache;
  confirm?: ConfirmSame;
  sure: number;
  maybe: number;
  via: string;
}

/** The embedder and the band, or word overlap when there is no embedder or it does not answer. */
async function meaningCheck(judge: TextModel | undefined): Promise<Meaning> {
  const band = bandFrom(process.env);
  const cfg = embedderConfig(process.env);
  if (!cfg) return { ...band, via: "word overlap (no embedder configured)" };
  const cache = new EmbeddingCache(EmbeddingCache.fileFor(EMBEDDINGS, cfg.model), createEmbedder(cfg));
  try {
    await cache.get(["A bot that plans a week of dinners."]);
  } catch (err) {
    return {
      ...band,
      via: `word overlap (${cfg.model} could not be used: ${err instanceof Error ? err.message : String(err)})`,
    };
  }
  return {
    ...band,
    cache,
    ...(judge ? { confirm: confirmWithModel(judge) } : {}),
    via: `${cfg.model}, sure at ${band.sure}, ${judge ? `asks the model from ${band.maybe}` : "no model to ask in the band"}`,
  };
}

// ── generate ───────────────────────────────────────────────────────────────────────────────────

async function generate(opts: {
  limit: number;
  category?: string;
  concurrency: number;
  template: boolean;
  judge: boolean;
  retryDropped: boolean;
}): Promise<void> {
  const done = await doneJobs(opts.retryDropped);
  const retired = await readRetired(DIRECTORY);
  const retiredJobs = new Set(retired.flatMap((r) => (r.job ? [r.job.toLowerCase()] : [])));
  let jobs = interleaveByCategory(loadJobs());
  if (opts.category) {
    if (!(opts.category in BOT_CATEGORIES)) throw new Error(`"${opts.category}" is not a category`);
    jobs = jobs.filter((j) => j.category === opts.category);
  }
  jobs = jobs.filter((j) => !done.has(j.job) && !retiredJobs.has(j.job.toLowerCase())).slice(0, opts.limit);
  if (jobs.length === 0) {
    log(
      "Nothing to generate: every job in range already has a bot or was dropped for good (see the generate log). Grow the taxonomy with `seed jobs`.",
    );
    return;
  }
  const models = await seedModels(opts.template);
  const meaning = await meaningCheck(models.judge);
  log(`Generating ${jobs.length} bots with ${models.via}, concurrency ${opts.concurrency}.`);
  log(`  duplicates: ${meaning.via}`);
  const started = Date.now();
  const shelf = await existingPacks();
  const { written, dropped } = await generateBatch({
    jobs,
    botsDir: BOTS_DIR,
    ctx: CTX,
    ...(models.model ? { model: models.model } : {}),
    ...(models.judge ? { judge: models.judge } : {}),
    useJudge: opts.judge,
    shelf,
    retired,
    ...(meaning.cache ? { cache: meaning.cache } : {}),
    ...(meaning.confirm ? { confirm: meaning.confirm } : {}),
    sure: meaning.sure,
    maybe: meaning.maybe,
    concurrency: opts.concurrency,
    record: appendLog,
    log,
  });
  const minutes = (Date.now() - started) / 60_000;
  log(`Generated: ${written.length} written, ${dropped.length} dropped in ${minutes.toFixed(1)} min.`);
  if (written.length > 0) {
    log(
      `  ${((minutes * 60) / written.length).toFixed(1)} s of wall time per bot written, at concurrency ${opts.concurrency}.`,
    );
  }
  log(`  by category: ${formatTally(tally(written, (r) => r.category))}`);
  log(`  dropped: ${formatTally(tally(dropped, (r) => (r.reason ?? "").split(/[:(]/)[0]?.trim() ?? ""))}`);
}

// ── jobs: grow the taxonomy ──────────────────────────────────────────────────────────────────────

async function growJobs(opts: {
  target: number;
  category?: string;
  perCall: number;
  rounds: number;
  concurrency: number;
}): Promise<void> {
  const models = await seedModels(false);
  if (!models.model || !models.judge)
    throw new Error("`seed jobs` needs a model: export NVIDIA_API_KEY or STEWARD_SEED_*.");
  const meaning = await meaningCheck(models.judge);
  log(
    `Growing the taxonomy to ${opts.target} jobs per category with ${models.via}; duplicates: ${meaning.via}.`,
  );
  const people = loadJobs(JOBS_FILE, { ai: false });
  const ai = await readAiJobs();
  const retired = await readRetired(DIRECTORY);
  const avoid = retired.flatMap((r, i) => (r.job ? [{ id: `retired:${r.id}:${i}`, text: r.job }] : []));
  const categories = (Object.keys(BOT_CATEGORIES) as BotCategory[]).filter(
    (c) => !opts.category || c === opts.category,
  );
  // Writes go one after another: every round rewrites the whole file.
  let writing: Promise<void> = Promise.resolve();
  const save = () => {
    writing = writing.then(() => writeAiJobs(ai));
    return writing;
  };
  const growOne = async (category: BotCategory) => {
    let stalled = 0;
    for (let round = 0; round < opts.rounds; round++) {
      const listed = [...people, ...ai];
      const have = listed.filter((j) => j.category === category).length;
      if (have >= opts.target) break;
      const ask = Math.min(opts.perCall, opts.target - have + 3);
      let proposal: Awaited<ReturnType<typeof proposeJobs>>;
      try {
        proposal = await proposeJobs(category, ask, listed, avoid, {
          model: models.model!,
          ...(meaning.cache ? { cache: meaning.cache } : {}),
          ...(meaning.confirm ? { confirm: meaning.confirm } : {}),
          sure: meaning.sure,
          maybe: meaning.maybe,
        });
      } catch (err) {
        log(`  ${category}: round ${round + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
        if (++stalled >= 2) break;
        continue;
      }
      const now = [...people, ...ai].filter((j) => j.category === category).length;
      const added = proposal.added.slice(0, Math.max(0, opts.target - now));
      ai.push(...added.map((j) => ({ ...j, source: "ai" as const })));
      await save();
      log(`  ${category}: +${added.length} (now ${now + added.length}), ${proposal.dropped.length} dropped`);
      for (const d of proposal.dropped.slice(0, 2))
        log(`      ✗ ${d.job.slice(0, 90)}: ${d.reason.slice(0, 120)}`);
      stalled = added.length === 0 ? stalled + 1 : 0;
      if (stalled >= 2) break;
    }
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, categories.length) }, async () => {
      while (next < categories.length) await growOne(categories[next++]!);
    }),
  );
  await writing;
  const all = [...people, ...ai];
  log(
    `Taxonomy: ${all.length} jobs (${people.length} by people, ${ai.length} proposed by a model) → src/jobs-ai.yaml.`,
  );
  log(`  by category: ${formatTally(tally(all, (j) => j.category))}`);
}

// ── dedupe: near-twins on the shelf ──────────────────────────────────────────────────────────────

async function shelfDuplicates(opts: { confirm: boolean; min?: number }): Promise<void> {
  const models = opts.confirm ? await seedModels(false) : { via: "none" };
  const meaning = await meaningCheck(opts.confirm ? models.judge : undefined);
  if (!meaning.cache)
    throw new Error(`No embedder: ${meaning.via}. Export NVIDIA_API_KEY or STEWARD_EMBED_*.`);
  const packs = await existingPacks();
  const pairs = await similarPairs(packs, meaning.cache, opts.min ?? meaning.maybe);
  const byId = new Map(packs.map((p) => [p.id, p]));
  let twins = 0;
  for (const pair of pairs) {
    const a = byId.get(pair.a)!;
    const b = byId.get(pair.b)!;
    let verdict = pair.similarity >= meaning.sure ? "SAME (sure)" : "maybe";
    if (verdict === "maybe" && meaning.confirm) {
      verdict = (await meaning.confirm(packCard(a), packCard(b))) ? "SAME (model)" : "different";
    }
    if (verdict.startsWith("SAME")) twins++;
    process.stdout.write(`${pair.similarity.toFixed(3)}  ${verdict.padEnd(12)}  ${a.id}  ~  ${b.id}\n`);
  }
  log(
    `${pairs.length} pairs at or above ${opts.min ?? meaning.maybe}; ${twins} look like the same job. Nothing was changed.`,
  );
}

// ── retire ───────────────────────────────────────────────────────────────────────────────────────

async function retire(opts: {
  days: number;
  floor: number;
  now?: string;
  apply: boolean;
  regenerate: boolean;
}): Promise<void> {
  const now = opts.now ? new Date(opts.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--now: "${opts.now}" is not a date`);
  const rows = await readLog();
  const jobById = new Map(
    rows.flatMap((r) => (r.status === "written" && r.id ? [[r.id, r.job] as const] : [])),
  );
  let regenerate: RegenerateOptions | undefined;
  if (opts.regenerate) {
    const models = await seedModels(false);
    if (!models.model)
      throw new Error("--regenerate needs a model: export NVIDIA_API_KEY or STEWARD_SEED_*.");
    const meaning = await meaningCheck(models.judge);
    regenerate = {
      model: models.model,
      ...(models.judge ? { judge: models.judge } : {}),
      jobs: interleaveByCategory(loadJobs()),
      done: await doneJobs(false),
      ctx: CTX,
      ...(meaning.cache ? { cache: meaning.cache } : {}),
      ...(meaning.confirm ? { confirm: meaning.confirm } : {}),
      record: appendLog,
    };
  }
  const run = await runRetirement({
    dir: DIRECTORY,
    counts: await readCounts(DIRECTORY),
    now,
    days: opts.days,
    floor: opts.floor,
    apply: opts.apply,
    jobOf: (id) => jobById.get(id),
    ...(regenerate ? { regenerate } : {}),
    log,
  });
  log(
    `Retirement as of ${now.toISOString().slice(0, 10)}: ${run.retire.length} AI-made bots unused for ${opts.days} days.`,
  );
  for (const r of run.retire.slice(0, 50)) log(`  ${r.id} (${r.category}, made ${r.generated})`);
  if (run.retire.length > 50) log(`  … and ${run.retire.length - 50} more`);
  const soonest = [...run.young].sort((a, b) => a.daysLeft - b.daysLeft)[0];
  log(
    `  ${run.young.length} AI-made bots are inside their ${opts.days} days${soonest ? `; the first reaches it in ${soonest.daysLeft} days` : ""}.`,
  );
  for (const t of run.thinned)
    log(`  thinned: ${t.category} has ${t.live}, floor ${t.floor}, needs ${t.need}`);
  if (!opts.apply)
    log("Nothing was changed. Add --apply to retire them, and --regenerate to top up thinned categories.");
  else
    log(
      `Applied. ${run.regenerated.length} new bots written.${run.outOfJobs.length ? ` Out of jobs in: ${run.outOfJobs.join(", ")} (run \`seed jobs\`).` : ""}`,
    );
}

// ── build and report ───────────────────────────────────────────────────────────────────────────

async function build(opts: { site?: string; name?: string }): Promise<void> {
  const index = await buildIndex(DIRECTORY, opts);
  log(`Index: ${index.bots.length} bots → directory/index.json and directory/packs/.`);
  log(`  by category: ${formatTally(tally(index.bots, (b) => b.category))}`);
}

async function report(write: boolean): Promise<void> {
  const packs = await existingPacks();
  const problems: { id: string; problem: Problem }[] = [];
  for (const pack of packs) {
    for (const problem of validatePack(pack, CTX).problems) problems.push({ id: pack.id, problem });
  }
  const errors = problems.filter((p) => p.problem.severity === "error");
  const warnings = problems.filter((p) => p.problem.severity === "warn");
  const logRows = await readLog();
  const dropped = logRows.filter((r) => r.status === "dropped");
  const authorKind = (p: BotPack) =>
    p.author.kind === "ai"
      ? `AI-made (${p.author.model})`
      : `person (${p.author.handle.startsWith("CopilotKit") ? "OpenBot" : "LobeChat author"})`;
  const lines = [
    "# Directory report",
    "",
    `Generated ${new Date().toISOString().slice(0, 10)}. ${packs.length} packs in \`directory/bots/\`.`,
    "",
    "## By category",
    "",
    ...Object.entries(tally(packs, (p) => p.category)).map(
      ([key, n]) => `- ${BOT_CATEGORIES[key as BotCategory] ?? key} (\`${key}\`): ${n}`,
    ),
    "",
    "## By author",
    "",
    ...Object.entries(tally(packs, authorKind)).map(([key, n]) => `- ${key}: ${n}`),
    "",
    "## Problems",
    "",
    `${errors.length} errors, ${warnings.length} warnings across ${new Set(problems.map((p) => p.id)).size} packs.`,
    "",
    ...Object.entries(
      tally(warnings, (w) => w.problem.message.replace(/\(.*?\)|".*?"/g, "…").slice(0, 80)),
    ).map(([msg, n]) => `- ${n} × ${msg}`),
    ...errors.map((e) => `- ERROR ${e.id}: ${e.problem.path}: ${e.problem.message}`),
    "",
    "## Generation log",
    "",
    `${logRows.filter((r) => r.status === "written").length} written, ${dropped.length} dropped.`,
    "",
    ...Object.entries(tally(dropped, (r) => (r.reason ?? "").split(/[:(]/)[0]?.trim() ?? "")).map(
      ([reason, n]) => `- ${n} × ${reason}`,
    ),
    "",
    ...generationSummary(packs, logRows, await readRetired(DIRECTORY)),
  ];
  const text = lines.join("\n");
  process.stdout.write(text);
  if (write) {
    await writeFile(join(DIRECTORY, "REPORT.md"), text, "utf8");
    log("Written to directory/REPORT.md.");
  }
}

/** The launch target (plan §4): AI-made bots across the 19 categories. */
const LAUNCH_TARGET = 2000;

/**
 * Pace by writer model: seconds per bot for one worker (from each row's `seconds`), and bots per
 * minute of wall time, counting only stretches of work (a gap of over ten minutes ends one).
 */
function generationSummary(
  packs: readonly BotPack[],
  rows: readonly LogRow[],
  retired: readonly { id: string }[],
): string[] {
  const ai = packs.filter((p) => p.author.kind === "ai");
  const written = rows.filter((r) => r.status === "written");
  const jobs = loadJobs();
  const doneJobs = new Set(
    rows.filter((r) => r.status === "written" || FINAL_DROP.test(r.reason ?? "")).map((r) => r.job),
  );
  const left = jobs.filter((j) => !doneJobs.has(j.job)).length;
  const lines = [
    "## Toward the launch target",
    "",
    `${ai.length} AI-made bots on the shelf, of ${LAUNCH_TARGET} planned; ${retired.length} retired.`,
    `${jobs.length} jobs in the taxonomy (${jobs.filter((j) => j.source !== "ai").length} by people, ${jobs.filter((j) => j.source === "ai").length} proposed by a model and not yet read by a person); ${left} without a bot yet.`,
    "",
    "| Writer | Bots | Seconds per bot, one worker (median) | Bots per minute of run time |",
    "| --- | --- | --- | --- |",
  ];
  for (const [model, list] of Object.entries(groupBy(written, (r) => r.model ?? "unknown"))) {
    const secs = list
      .flatMap((r) => (typeof r.seconds === "number" ? [r.seconds] : []))
      .sort((a, b) => a - b);
    const median = secs.length ? secs[Math.floor(secs.length / 2)]!.toFixed(0) : "not recorded";
    const times = list.map((r) => Date.parse(r.at)).sort((a, b) => a - b);
    let minutes = 0;
    for (let i = 1; i < times.length; i++) {
      const gap = times[i]! - times[i - 1]!;
      if (gap < 10 * 60_000) minutes += gap / 60_000;
    }
    const rate = minutes > 0 ? (list.length / minutes).toFixed(1) : "–";
    lines.push(`| ${model} | ${list.length} | ${median} | ${rate} |`);
  }
  lines.push(
    "",
    "Resume with the same command; it skips jobs that already have a bot or were dropped for good:",
    "",
    "```sh",
    "NVIDIA_API_KEY=… STEWARD_SEED_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b \\",
    "  STEWARD_SEED_JUDGE_MODEL=nvidia/nemotron-3-ultra-550b-a55b \\",
    "  pnpm --filter @steward/bots-gen seed generate --limit 2000 --concurrency 6",
    "```",
    "",
  );
  return lines;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = [...(out[k] ?? []), item];
  }
  return out;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      dir: { type: "string" },
      cache: { type: "string" },
      limit: { type: "string" },
      category: { type: "string" },
      concurrency: { type: "string", default: "4" },
      template: { type: "boolean", default: false },
      "no-judge": { type: "boolean", default: false },
      refresh: { type: "boolean", default: false },
      site: { type: "string" },
      name: { type: "string" },
      write: { type: "boolean", default: false },
      "retry-dropped": { type: "boolean", default: false },
      target: { type: "string" },
      "per-call": { type: "string" },
      rounds: { type: "string" },
      confirm: { type: "boolean", default: false },
      min: { type: "string" },
      days: { type: "string" },
      floor: { type: "string" },
      now: { type: "string" },
      apply: { type: "boolean", default: false },
      regenerate: { type: "boolean", default: false },
    },
    strict: true,
  });
  const int = (value: string | undefined, fallback: number) =>
    value ? Number.parseInt(value, 10) : fallback;
  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;
  switch (command) {
    case "convert-openbot":
      await convertOpenBot(values.dir ?? OPENBOT_SEEDS);
      return;
    case "convert-lobe":
      await convertLobe(values.cache ?? join(SEEDS, "lobe"), limit, values.refresh);
      return;
    case "generate":
      await generate({
        limit: limit ?? 20,
        category: values.category,
        concurrency: Number.parseInt(values.concurrency ?? "4", 10),
        template: values.template,
        judge: !values["no-judge"],
        retryDropped: values["retry-dropped"],
      });
      return;
    case "jobs":
      await growJobs({
        target: int(values.target, 106),
        category: values.category,
        perCall: int(values["per-call"], 25),
        rounds: int(values.rounds, 8),
        concurrency: int(values.concurrency, 3),
      });
      return;
    case "dedupe":
      await shelfDuplicates({
        confirm: values.confirm,
        ...(values.min ? { min: Number.parseFloat(values.min) } : {}),
      });
      return;
    case "retire":
      await retire({
        days: int(values.days, 90),
        floor: int(values.floor, 20),
        now: values.now,
        apply: values.apply,
        regenerate: values.regenerate,
      });
      return;
    case "build":
      await build({ site: values.site, name: values.name });
      return;
    case "report":
      await report(values.write);
      return;
    default:
      log("Usage: seed <convert-openbot|convert-lobe|jobs|generate|dedupe|retire|build|report> [options]");
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((err) => {
  log(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
