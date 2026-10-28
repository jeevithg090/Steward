import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildIndex, parseBotFolder, validatePack, writeBotFolder } from "@steward/bots";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { BOT_CATEGORIES, type BotCategory, type BotPack, type TextModel, TOOLS } from "@steward/shared";
import { convertLobeAgent, isEnglishLobeFile, LOBE_CONTENTS_API, LOBE_RAW_BASE } from "./convert/lobe.ts";
import { convertOpenBotCoworker } from "./convert/openbot.ts";
import { generateBot, type Problem } from "./generate.ts";
import { interleaveByCategory, loadJobs } from "./jobs.ts";
import { dedupe, JUDGE_BAR, type Judgement, judgeBot } from "./judge.ts";
import { createSeedModel, seedModelConfig } from "./model.ts";

/**
 * `pnpm --filter @steward/bots-gen seed <command>`: converts the seeds, generates bots with a model,
 * builds the index and reports. Every pack goes through `validatePack` before it is written to
 * `directory/bots/<id>/`, and `build` runs the gateway's own rule check again.
 *
 *   convert-openbot [--dir <folder>]
 *   convert-lobe [--cache <folder>] [--limit N] [--refresh]
 *   generate --limit N [--category <key>] [--concurrency 4] [--template] [--no-judge]
 *   build [--site <url>] [--name <text>]
 *   report [--write]
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const DIRECTORY = join(ROOT, "directory");
const BOTS_DIR = join(DIRECTORY, "bots");
const SEEDS = join(ROOT, ".steward-data", "seeds");
const OPENBOT_SEEDS = resolve(import.meta.dirname, "../seeds/openbot");
const GENERATE_LOG = join(SEEDS, "generate-log.jsonl");

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

// ── generate ───────────────────────────────────────────────────────────────────────────────────

interface LogRow {
  job: string;
  category: string;
  id?: string;
  status: "written" | "dropped";
  reason?: string;
  score?: number;
  madeBy?: string;
  model?: string;
  at: string;
}

async function readLog(): Promise<LogRow[]> {
  if (!existsSync(GENERATE_LOG)) return [];
  const text = await readFile(GENERATE_LOG, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogRow);
}

async function pool<T>(
  items: readonly T[],
  size: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index] as T, index);
    }
  });
  await Promise.all(workers);
}

/** A pack id that is free in the directory: `rent-scout`, then `rent-scout-2`, … */
function freeId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) {
    const candidate = `${id.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function probeModel(model: TextModel): Promise<string | undefined> {
  try {
    await model.complete({ system: "Answer with one word.", prompt: "Say ok.", maxTokens: 20 });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function generate(opts: {
  limit: number;
  category?: string;
  concurrency: number;
  template: boolean;
  judge: boolean;
}): Promise<void> {
  const done = new Set((await readLog()).filter((r) => r.status === "written").map((r) => r.job));
  let jobs = interleaveByCategory(loadJobs());
  if (opts.category) {
    if (!(opts.category in BOT_CATEGORIES)) throw new Error(`"${opts.category}" is not a category`);
    jobs = jobs.filter((j) => j.category === opts.category);
  }
  jobs = jobs.filter((j) => !done.has(j.job)).slice(0, opts.limit);
  if (jobs.length === 0) {
    log("Nothing to generate: every job in range already has a bot (see the generate log).");
    return;
  }

  let model: TextModel | undefined;
  let judge: TextModel | undefined;
  let via = "template";
  if (!opts.template) {
    const cfg = seedModelConfig(process.env);
    if (!cfg) {
      log(
        "No model key found (NVIDIA_API_KEY or STEWARD_SEED_BASE_URL + STEWARD_SEED_MODEL); using the template generator.",
      );
    } else {
      const candidate = createSeedModel(cfg, { temperature: 0.6 });
      const failure = await probeModel(candidate);
      if (failure) {
        log(
          `The model (${cfg.model} via ${cfg.via}) could not be used: ${failure}. Falling back to the template generator.`,
        );
      } else {
        model = candidate;
        judge = createSeedModel(cfg, { temperature: 0 });
        via = `${cfg.model} via ${cfg.via}`;
      }
    }
  }
  log(`Generating ${jobs.length} bots with ${via}, concurrency ${opts.concurrency}.`);

  const shelf = await existingPacks();
  const taken = new Set(shelf.map((p) => p.id));
  const rows: LogRow[] = [];
  await mkdir(SEEDS, { recursive: true });
  const record = async (row: LogRow): Promise<void> => {
    rows.push(row);
    await appendFile(GENERATE_LOG, `${JSON.stringify(row)}\n`, "utf8");
  };
  // Packs are written and logged as they pass, so a run that is cut short keeps what it made.
  // One at a time through dedupe and write, so ids and the shelf stay consistent.
  let gate: Promise<void> = Promise.resolve();

  await pool(jobs, opts.concurrency, async (job) => {
    const drop = (reason: string) => {
      log(`  ✗ ${job.category}: "${job.job}": ${reason.slice(0, 200)}`);
      return record({
        job: job.job,
        category: job.category,
        status: "dropped",
        reason,
        at: new Date().toISOString(),
      });
    };
    const result = await generateBot(
      { job: job.job, category: job.category },
      { ...CTX, model, now: () => new Date(), hints: { tools: job.tools, connectors: job.connectors } },
    );
    if (model && result.madeBy === "template") {
      return drop(`model failed: ${describe(result.problems) || "see problems"}`);
    }
    let judgement: Judgement | undefined;
    if (judge && opts.judge) {
      let error = "";
      for (let attempt = 0; attempt < 2 && !judgement; attempt++) {
        try {
          judgement = await judgeBot(result.pack, judge, { tools: CTX.tools });
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }
      if (!judgement) return drop(`judge failed: ${error}`);
      if (judgement.score < JUDGE_BAR) {
        return drop(`below the bar (${judgement.score}): ${judgement.notes.join(" ")}`);
      }
    }
    // Duplicates: against the shelf and what this batch wrote before; the first to finish wins.
    gate = gate.then(async () => {
      try {
        const twin = dedupe([result.pack], shelf).dropped[0];
        if (twin) return drop(`duplicate of ${twin.duplicateOf}`);
        const id = freeId(result.pack.id, taken);
        const pack = { ...result.pack, id };
        const written = await writePack(pack);
        if (!written.written) return drop(`failed validation: ${describe(written.problems)}`);
        taken.add(id);
        shelf.push(pack);
        log(`  ✓ ${job.category}: ${pack.name}${judgement ? ` (${judgement.score})` : ""} → bots/${id}`);
        await record({
          job: job.job,
          category: job.category,
          id,
          status: "written",
          score: judgement?.score,
          madeBy: result.madeBy,
          model: model?.label ?? "template",
          at: new Date().toISOString(),
        });
      } catch (err) {
        await drop(`could not write: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    await gate;
  });

  const written = rows.filter((r) => r.status === "written");
  const dropped = rows.filter((r) => r.status === "dropped");
  log(`Generated: ${written.length} written, ${dropped.length} dropped.`);
  log(`  by category: ${formatTally(tally(written, (r) => r.category))}`);
  log(`  dropped: ${formatTally(tally(dropped, (r) => (r.reason ?? "").split(":")[0] ?? ""))}`);
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
    ...Object.entries(tally(dropped, (r) => (r.reason ?? "").split(":")[0] ?? "")).map(
      ([reason, n]) => `- ${n} × ${reason}`,
    ),
    "",
  ];
  const text = lines.join("\n");
  process.stdout.write(text);
  if (write) {
    await writeFile(join(DIRECTORY, "REPORT.md"), text, "utf8");
    log("Written to directory/REPORT.md.");
  }
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
    },
    strict: true,
  });
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
      });
      return;
    case "build":
      await build({ site: values.site, name: values.name });
      return;
    case "report":
      await report(values.write);
      return;
    default:
      log("Usage: seed <convert-openbot|convert-lobe|generate|build|report> [options]");
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((err) => {
  log(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
