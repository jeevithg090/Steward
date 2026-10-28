import { join } from "node:path";
import {
  confirmWithModel,
  createEmbedder,
  createSeedModel,
  EmbeddingCache,
  embedderConfig,
  interleaveByCategory,
  loadJobs,
  type RegenerateOptions,
  runRetirement,
  seedModelConfig,
} from "@steward/bots-gen";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { TOOLS } from "@steward/shared";
import type { Catalogue } from "./catalogue.ts";
import type { DirectoryStore, RetirementRunRecord } from "./store.ts";

/**
 * The directory's nightly retirement (plan §4.6), on this server's own counts: once a day, after
 * `hour` UTC, AI-made bots nobody installed or used within `days` of being made leave the shelf
 * and go on `retired.json`, and the index is rebuilt. With `regenerate` on and a model key in the
 * environment, categories that fell under `floor` are topped up with new bots from the taxonomy;
 * otherwise the review page says which categories need more.
 */
export interface RetirementSettings {
  /** 0 turns retirement off. */
  days: number;
  /** The UTC hour after which the day's run happens. */
  hour: number;
  floor: number;
  regenerate: boolean;
}

export interface RetirementDeps {
  settings: RetirementSettings;
  catalogue: Catalogue;
  store: DirectoryStore;
  /** For regeneration only: where the embedding cache lives. */
  dataDir: string;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

const dayOf = (at: Date) => at.toISOString().slice(0, 10);

export class RetirementTask {
  private running?: Promise<RetirementRunRecord>;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: RetirementDeps) {}

  get enabled(): boolean {
    return this.deps.settings.days > 0;
  }

  /** True when today's run has not happened and its hour has come. */
  due(now: Date): boolean {
    if (!this.enabled) return false;
    if (now.getUTCHours() < this.deps.settings.hour) return false;
    return this.deps.store.lastRetirement()?.day !== dayOf(now);
  }

  /** Runs when due. Returns the record when it ran. */
  async tick(now: Date = new Date()): Promise<RetirementRunRecord | undefined> {
    if (this.running || !this.due(now)) return undefined;
    return this.run(now);
  }

  /** Runs now, whatever the hour, and records the result for the day. One run at a time. */
  run(now: Date = new Date()): Promise<RetirementRunRecord> {
    this.running ??= this.runOnce(now).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private regenerateOptions(): RegenerateOptions | undefined {
    if (!this.deps.settings.regenerate) return undefined;
    const env = this.deps.env ?? process.env;
    const cfg = seedModelConfig(env);
    if (!cfg) return undefined;
    const model = createSeedModel(cfg, { temperature: 0.6 });
    const judge = createSeedModel(cfg, { temperature: 0 });
    const embed = embedderConfig(env);
    const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);
    return {
      model,
      judge,
      jobs: interleaveByCategory(loadJobs()),
      ctx: { tools: Object.keys(TOOLS), validateRule: (when) => engine.validate(when) },
      ...(embed
        ? {
            cache: new EmbeddingCache(
              EmbeddingCache.fileFor(join(this.deps.dataDir, "embeddings"), embed.model),
              createEmbedder(embed),
            ),
          }
        : {}),
      confirm: confirmWithModel(judge),
    };
  }

  private async runOnce(now: Date): Promise<RetirementRunRecord> {
    const { catalogue, store, settings } = this.deps;
    const log = this.deps.log ?? ((line: string) => console.log(`[directory] ${line}`));
    const record: RetirementRunRecord = {
      day: dayOf(now),
      at: now.toISOString(),
      retired: [],
      thinned: [],
      regenerated: [],
      young: 0,
    };
    try {
      const regenerate = this.regenerateOptions();
      const run = await runRetirement({
        dir: catalogue.dir,
        counts: store.counts(),
        now,
        days: settings.days,
        floor: settings.floor,
        apply: true,
        rebuild: async () => {
          await catalogue.rebuild();
        },
        ...(regenerate ? { regenerate } : {}),
        log,
      });
      record.retired = run.retire.map((r) => ({ id: r.id, category: r.category, name: r.name }));
      record.thinned = run.thinned;
      record.regenerated = run.regenerated.flatMap((r) => (r.id ? [{ id: r.id, category: r.category }] : []));
      record.young = run.young.length;
      if (settings.regenerate && !regenerate && run.thinned.length > 0) {
        record.problem = "Regeneration is on, but no model key is set (NVIDIA_API_KEY or STEWARD_SEED_*).";
      } else if (run.outOfJobs.length > 0) {
        record.problem = `No unused jobs left in ${run.outOfJobs.join(", ")}: run \`seed jobs\` to grow the taxonomy.`;
      }
      if (record.retired.length > 0) log(`retired ${record.retired.length} unused AI-made bots`);
    } catch (error) {
      record.problem = error instanceof Error ? error.message : String(error);
      log(`retirement failed: ${record.problem}`);
    }
    store.recordRetirement(record);
    return record;
  }

  /** Checks every ten minutes; the timer never keeps the process alive. */
  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => void this.tick(), 10 * 60_000);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
