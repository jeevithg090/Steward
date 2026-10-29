import { join } from "node:path";
import { type ValidateContext, validatePack, writeBotFolder } from "@steward/bots";
import type { BotPack, TextModel } from "@steward/shared";
import { type ConfirmSame, type EmbeddingCache, semanticDedupe } from "./embed.ts";
import { generateBot, type Problem } from "./generate.ts";
import type { Job } from "./jobs.ts";
import { JUDGE_BAR, type Judgement, judgeBot } from "./judge.ts";
import type { RetiredEntry } from "./retire.ts";
import { distinctName } from "./text.ts";

/**
 * One generation run: each job becomes a pack through the model, the judge, the validators and
 * the near-duplicate check, and is written to `<botsDir>/<id>/` the moment it passes, so a run
 * that stops keeps what it made. The seed CLI and the directory's retirement task both use it.
 */

export interface LogRow {
  job: string;
  category: string;
  id?: string;
  status: "written" | "dropped";
  reason?: string;
  score?: number;
  madeBy?: string;
  model?: string;
  /** How the duplicate check ran: `embeddings` or `words`. */
  dedupe?: string;
  /** Seconds from the start of this job to its pack being written or dropped. */
  seconds?: number;
  at: string;
}

export interface BatchOptions {
  jobs: readonly Job[];
  botsDir: string;
  ctx: ValidateContext;
  /** Without one, packs come from the template generator. */
  model?: TextModel;
  /** The judge; with `useJudge` false, packs are not scored. */
  judge?: TextModel;
  useJudge?: boolean;
  /** What is on the shelf already. Grows as the run writes. */
  shelf: BotPack[];
  /** Retired bots count as taken: their look-alikes are not written again. */
  retired?: readonly RetiredEntry[];
  cache?: EmbeddingCache;
  confirm?: ConfirmSame;
  sure?: number;
  maybe?: number;
  concurrency?: number;
  record?: (row: LogRow) => Promise<void>;
  log?: (line: string) => void;
  now?: () => Date;
}

function describe(problems: readonly Problem[]): string {
  return problems
    .filter((p) => p.severity === "error")
    .map((p) => `${p.path}: ${p.message}`)
    .join("; ");
}

/** A pack id that is free: `rent-scout`, then `rent-scout-2`, … */
export function freeId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) {
    const candidate = `${id.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) await work(items[next++] as T);
  });
  await Promise.all(workers);
}

export async function generateBatch(opts: BatchOptions): Promise<{ written: LogRow[]; dropped: LogRow[] }> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const rows: LogRow[] = [];
  const record = async (row: LogRow) => {
    rows.push(row);
    await opts.record?.(row);
  };
  const retiredJobs = new Set((opts.retired ?? []).flatMap((r) => (r.job ? [r.job.toLowerCase()] : [])));
  const retiredLike = (opts.retired ?? []).map((r) => ({
    id: `retired:${r.id}`,
    name: r.name,
    pitch: r.pitch,
  }));
  const taken = new Set([...opts.shelf.map((p) => p.id), ...(opts.retired ?? []).map((r) => r.id)]);
  let warnedFallback = false;
  // One pack at a time through the duplicate check and the write, so ids and the shelf stay
  // consistent while the model calls run side by side.
  let gate: Promise<void> = Promise.resolve();

  await pool(opts.jobs, opts.concurrency ?? 4, async (job) => {
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 100) / 10;
    const drop = (reason: string, extra: Partial<LogRow> = {}) => {
      log(`  ✗ ${job.category}: "${job.job}": ${reason.slice(0, 200)}`);
      return record({
        job: job.job,
        category: job.category,
        status: "dropped",
        reason,
        seconds: seconds(),
        at: now().toISOString(),
        ...extra,
      });
    };
    if (retiredJobs.has(job.job.toLowerCase())) return drop("retired: a bot for this job was retired");
    let result: Awaited<ReturnType<typeof generateBot>>;
    try {
      result = await generateBot(
        { job: job.job, category: job.category },
        { ...opts.ctx, model: opts.model, now, hints: { tools: job.tools, connectors: job.connectors } },
      );
    } catch (error) {
      return drop(`model failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (opts.model && result.madeBy === "template") {
      return drop(`model failed: ${describe(result.problems) || "see problems"}`);
    }
    let judgement: Judgement | undefined;
    if (opts.judge && opts.useJudge !== false) {
      let error = "";
      for (let attempt = 0; attempt < 2 && !judgement; attempt++) {
        try {
          judgement = await judgeBot(result.pack, opts.judge, { tools: opts.ctx.tools });
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }
      if (!judgement) return drop(`judge failed: ${error}`);
      if (judgement.score < JUDGE_BAR) {
        return drop(`below the bar (${judgement.score}): ${judgement.notes.join(" ")}`, {
          score: judgement.score,
        });
      }
    }
    gate = gate.then(async () => {
      try {
        const checked = await semanticDedupe([result.pack], [...opts.shelf, ...retiredLike], {
          ...(opts.cache ? { cache: opts.cache } : {}),
          ...(opts.confirm ? { confirm: opts.confirm } : {}),
          ...(opts.sure !== undefined ? { sure: opts.sure } : {}),
          ...(opts.maybe !== undefined ? { maybe: opts.maybe } : {}),
        });
        if (checked.method === "words" && checked.fallback && opts.cache && !warnedFallback) {
          warnedFallback = true;
          log(`  (the meaning check could not run: ${checked.fallback}; using word overlap)`);
        }
        const twin = checked.dropped[0];
        if (twin) {
          const like = twin.duplicateOf.replace(/^retired:/, "retired ");
          return drop(
            `duplicate of ${like}${twin.similarity ? ` (${twin.similarity}${twin.how ? `, ${twin.how}` : ""})` : ""}`,
            {
              dedupe: checked.method,
              ...(judgement ? { score: judgement.score } : {}),
            },
          );
        }
        const id = freeId(result.pack.id, taken);
        const name = distinctName(
          result.pack.name,
          job.job,
          new Set(opts.shelf.map((p) => p.name.toLowerCase())),
        );
        const readme =
          name === result.pack.name
            ? result.pack.readme
            : result.pack.readme.replace(`# ${result.pack.name}`, `# ${name}`);
        const pack = { ...result.pack, id, name, readme };
        const valid = validatePack(pack, opts.ctx);
        if (!valid.ok || !valid.pack) return drop(`failed validation: ${describe(valid.problems)}`);
        await writeBotFolder(join(opts.botsDir, id), valid.pack);
        taken.add(id);
        opts.shelf.push(valid.pack);
        log(`  ✓ ${job.category}: ${pack.name}${judgement ? ` (${judgement.score})` : ""} → bots/${id}`);
        await record({
          job: job.job,
          category: job.category,
          id,
          status: "written",
          ...(judgement ? { score: judgement.score } : {}),
          madeBy: result.madeBy,
          model: opts.model?.label ?? "template",
          dedupe: checked.method,
          seconds: seconds(),
          at: now().toISOString(),
        });
      } catch (err) {
        await drop(`could not write: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    await gate;
  });

  return {
    written: rows.filter((r) => r.status === "written"),
    dropped: rows.filter((r) => r.status === "dropped"),
  };
}
