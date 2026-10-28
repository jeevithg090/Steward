import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BotPack, TextModel } from "@steward/shared";
import { type DedupeResult, dedupe } from "./judge.ts";
import { fetchWithRetry, hashKey, type Pace, type RetryOptions, rpmFor, sharedPace } from "./model.ts";

/**
 * Near-duplicates by meaning (plan §4.4): "Plans a week of dinners" and "Writes a weekly meal plan"
 * share almost no words but do the same job. Each pack's name and pitch is embedded once, cached on
 * disk by the text's hash, and compared by cosine similarity. When no embedder is configured, or
 * one call fails, the word-overlap `dedupe` decides instead, and the result says so.
 */

export interface Embedder {
  /** `nvidia/nemotron-3.5-embed-1b`: names the cache file, so vectors from two models never mix. */
  label: string;
  /** One unit vector per text, in order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface EmbedderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Where the settings came from. Never the key. */
  via: string;
}

export const DEFAULT_NVIDIA_EMBED_MODEL = "nvidia/nemotron-3.5-embed-1b";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Cosine similarity of name + pitch, measured on the 28 Oct 2026 shelf with
 * `nemotron-3.5-embed-1b` and fourteen hand-labelled pairs. No single line separates twins from
 * look-alikes there: "Meeting Action Extractor" and "Meeting Action Writer" (twins) sit at 0.85,
 * while translators for Bahasa and for Turkish (not twins) sit at 0.87. So there is a band:
 *
 * - at or above `SURE_DUPLICATE` the pair is a duplicate;
 * - from `MAYBE_DUPLICATE` up to it, a one-word model question decides (all fourteen pairs right);
 * - below it, or in the band with no model to ask, both are kept.
 *
 * Another embedding model needs its own values (`STEWARD_EMBED_SURE`, `STEWARD_EMBED_MAYBE`).
 */
export const SURE_DUPLICATE = 0.9;
export const MAYBE_DUPLICATE = 0.8;

/**
 * `STEWARD_EMBED_BASE_URL` + `STEWARD_EMBED_MODEL` (+ `STEWARD_EMBED_API_KEY`) for any
 * OpenAI-compatible `/embeddings` endpoint; otherwise `NVIDIA_API_KEY` with `STEWARD_EMBED_MODEL`
 * or Nemotron 3.5 Embed 1B. Undefined when neither is set: the word-overlap check is used.
 */
export function embedderConfig(env: Record<string, string | undefined>): EmbedderConfig | undefined {
  const value = (name: string) => env[name]?.trim() || undefined;
  const baseUrl = value("STEWARD_EMBED_BASE_URL");
  const model = value("STEWARD_EMBED_MODEL");
  const apiKey = value("STEWARD_EMBED_API_KEY");
  if (baseUrl && model)
    return { baseUrl, model, via: "STEWARD_EMBED_BASE_URL", ...(apiKey ? { apiKey } : {}) };
  const nvidiaKey = value("NVIDIA_API_KEY");
  if (nvidiaKey) {
    return {
      baseUrl: NVIDIA_BASE_URL,
      model: model ?? DEFAULT_NVIDIA_EMBED_MODEL,
      apiKey: nvidiaKey,
      via: "NVIDIA_API_KEY",
    };
  }
  return undefined;
}

/** The band from the environment, falling back to the measured values. */
export function bandFrom(env: Record<string, string | undefined>): { sure: number; maybe: number } {
  const read = (name: string, fallback: number) => {
    const n = Number.parseFloat(env[name] ?? "");
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
  };
  const sure = read("STEWARD_EMBED_SURE", SURE_DUPLICATE);
  return { sure, maybe: Math.min(sure, read("STEWARD_EMBED_MAYBE", MAYBE_DUPLICATE)) };
}

export function normalise(vector: readonly number[]): number[] {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const length = Math.sqrt(sum) || 1;
  return vector.map((x) => x / length);
}

/** Cosine similarity of two unit vectors. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/**
 * Any OpenAI-compatible `/embeddings` endpoint. NVIDIA's retrieval embedders also want
 * `input_type`; others ignore it. Errors name the status and never echo the body, which can repeat
 * parts of the key.
 */
export function createEmbedder(
  cfg: EmbedderConfig,
  opts: {
    fetch?: typeof fetch;
    batchSize?: number;
    timeoutMs?: number;
    pace?: Pace;
    retry?: RetryOptions;
  } = {},
): Embedder {
  const pace = opts.pace ?? sharedPace(`${cfg.baseUrl}|${hashKey(cfg.apiKey)}`, rpmFor(cfg.baseUrl));
  const url = `${cfg.baseUrl.trim().replace(/\/+$/, "")}/embeddings`;
  const doFetch = opts.fetch ?? fetch;
  const batchSize = opts.batchSize ?? 64;
  const nvidia = /nvidia\.com/i.test(cfg.baseUrl);
  return {
    label: cfg.model,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const response = await fetchWithRetry(
          () =>
            doFetch(url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: cfg.model,
                input: batch,
                encoding_format: "float",
                ...(nvidia ? { input_type: "passage", truncate: "END" } : {}),
              }),
              signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
            }),
          { ...opts.retry, pace },
        );
        if (!response.ok) throw new Error(`The embedding endpoint answered ${response.status}.`);
        const data = (await response.json()) as { data?: { index?: number; embedding?: number[] }[] };
        const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (rows.length !== batch.length || rows.some((r) => !Array.isArray(r.embedding))) {
          throw new Error("The embedding endpoint returned the wrong number of vectors.");
        }
        for (const row of rows) out.push(normalise(row.embedding as number[]));
      }
      return out;
    },
  };
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

/** `${name}. ${pitch}`: what a person reads first, and what the word-overlap check compares. */
export function packText(pack: Pick<BotPack, "name" | "pitch">): string {
  return `${pack.name.trim()}. ${pack.pitch.trim()}`;
}

/**
 * Vectors on disk, one JSON line per text: `{ "h": <sha256 of the text>, "v": <base64 float32> }`.
 * The file is named after the model, appended to and never rewritten, so a run that stops halfway
 * keeps what it paid for.
 */
export class EmbeddingCache {
  private readonly vectors = new Map<string, number[]>();
  private loaded = false;

  constructor(
    readonly path: string,
    private readonly embedder: Embedder,
  ) {}

  /** `<dir>/<model, with each run of other characters as a double hyphen>.jsonl`. */
  static fileFor(dir: string, label: string): string {
    return `${dir.replace(/\/+$/, "")}/${label.replace(/[^a-z0-9.-]+/gi, "--")}.jsonl`;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    for (const line of (await readFile(this.path, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { h: string; v: string };
        const bytes = Buffer.from(row.v, "base64");
        const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        this.vectors.set(row.h, Array.from(floats));
      } catch {
        // A line cut short by a stopped run; it is embedded again when needed.
      }
    }
  }

  get size(): number {
    return this.vectors.size;
  }

  /** Vectors for the texts, from the cache where it has them and from the embedder otherwise. */
  async get(texts: readonly string[]): Promise<number[][]> {
    await this.load();
    const missing = [...new Set(texts.filter((t) => !this.vectors.has(hashOf(t))))];
    if (missing.length > 0) {
      const fresh = await this.embedder.embed(missing);
      const lines: string[] = [];
      missing.forEach((text, i) => {
        const vector = fresh[i] as number[];
        const h = hashOf(text);
        this.vectors.set(h, vector);
        lines.push(JSON.stringify({ h, v: Buffer.from(new Float32Array(vector).buffer).toString("base64") }));
      });
      mkdirSync(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${lines.join("\n")}\n`, "utf8");
    }
    return texts.map((t) => this.vectors.get(hashOf(t)) as number[]);
  }
}

/** What the model is shown for one side of a pair in the band. */
export function packCard(pack: Pick<BotPack, "name" | "pitch"> & { starters?: readonly string[] }): string {
  const starters = (pack.starters ?? []).slice(0, 2);
  return `Name: ${pack.name}\nPitch: ${pack.pitch}${starters.length ? `\nStarters: ${starters.join(" | ")}` : ""}`;
}

/** Decides a pair in the band: true when the two do the same job. */
export type ConfirmSame = (a: string, b: string) => Promise<boolean>;

const CONFIRM_SYSTEM =
  "You compare two entries in a directory of bots. Answer with one word: SAME or DIFFERENT.";

/**
 * The one-word question for pairs in the band. A failed call or an unclear answer keeps both: a
 * twin left on the shelf can be found later with `seed dedupe`, a bot dropped by mistake cannot.
 */
export function confirmWithModel(model: TextModel): ConfirmSame {
  return async (a, b) => {
    try {
      const answer = await model.complete({
        system: CONFIRM_SYSTEM,
        prompt: `Entry A\n${a}\n\nEntry B\n${b}\n\nSAME means a person looking for one would be fully served by the other: the same job for the same subject. DIFFERENT means they serve a different subject, language, program, sport, level or audience, even if they are worded alike.`,
        maxTokens: 5,
      });
      return /\bSAME\b/i.test(answer) && !/\bDIFFERENT\b/i.test(answer);
    } catch {
      return false;
    }
  };
}

export interface NearItem {
  id: string;
  /** What is embedded. */
  text: string;
  /** What the model is shown when the pair is in the band. Defaults to `text`. */
  card?: string;
}

export interface NearDuplicate {
  id: string;
  duplicateOf: string;
  similarity: number;
  /** `sure` above the band; `confirmed` when the model said SAME. */
  how: "sure" | "confirmed";
}

export interface NearOptions {
  cache: EmbeddingCache;
  sure?: number;
  maybe?: number;
  confirm?: ConfirmSame;
  /** Band candidates asked about per item, most alike first. */
  maxChecks?: number;
}

/**
 * The general check, for packs and for jobs: each item against `existing` and the items before it.
 * Throws when embedding fails, so the caller can fall back.
 */
export async function nearDuplicates(
  items: readonly NearItem[],
  existing: readonly NearItem[],
  opts: NearOptions,
): Promise<{ kept: NearItem[]; dropped: NearDuplicate[]; asked: number }> {
  const sure = opts.sure ?? SURE_DUPLICATE;
  const maybe = Math.min(sure, opts.maybe ?? MAYBE_DUPLICATE);
  const maxChecks = opts.maxChecks ?? 3;
  const vectors = await opts.cache.get([...existing.map((e) => e.text), ...items.map((i) => i.text)]);
  const seen = existing.map((item, i) => ({ item, vector: vectors[i] as number[] }));
  const kept: NearItem[] = [];
  const dropped: NearDuplicate[] = [];
  let asked = 0;
  for (const [i, item] of items.entries()) {
    const mine = vectors[existing.length + i] as number[];
    const close = seen
      .filter((s) => s.item.id !== item.id)
      .map((s) => ({ s, similarity: cosine(mine, s.vector) }))
      .filter((c) => c.similarity >= maybe)
      .sort((a, b) => b.similarity - a.similarity);
    let twin: NearDuplicate | undefined;
    const top = close[0];
    if (top && top.similarity >= sure) {
      twin = { id: item.id, duplicateOf: top.s.item.id, similarity: round(top.similarity), how: "sure" };
    } else if (opts.confirm) {
      for (const c of close.slice(0, maxChecks)) {
        asked++;
        if (await opts.confirm(item.card ?? item.text, c.s.item.card ?? c.s.item.text)) {
          twin = { id: item.id, duplicateOf: c.s.item.id, similarity: round(c.similarity), how: "confirmed" };
          break;
        }
      }
    }
    if (twin) {
      dropped.push(twin);
      continue;
    }
    seen.push({ item, vector: mine });
    kept.push(item);
  }
  return { kept, dropped, asked };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export interface SemanticDedupeResult extends DedupeResult {
  dropped: { id: string; duplicateOf: string; similarity?: number; how?: NearDuplicate["how"] }[];
  /** `embeddings` when the meaning check ran; `words` when it fell back to word overlap. */
  method: "embeddings" | "words";
  /** Why the meaning check did not run, when it did not. */
  fallback?: string;
}

type Comparable = Pick<BotPack, "id" | "name" | "pitch"> & { starters?: readonly string[] };

const asItem = (p: Comparable): NearItem => ({ id: p.id, text: packText(p), card: packCard(p) });

/**
 * Drops packs that do the same job as an earlier one or one in `existing`, by meaning. The earlier
 * pack wins, so the order of `packs` matters. Without a cache, or when embedding fails, the
 * word-overlap `dedupe` decides.
 */
export async function semanticDedupe(
  packs: readonly BotPack[],
  existing: readonly Comparable[] = [],
  opts: Partial<NearOptions> = {},
): Promise<SemanticDedupeResult> {
  const idOf = (id: string) => (id.startsWith("candidate:") ? (packs[Number(id.slice(10))]?.id ?? id) : id);
  const words = (fallback: string): SemanticDedupeResult => {
    // The same own-id rule as below, so a same-named pack is compared with its namesake.
    const renamed = packs.map((p, i) => ({ ...p, id: `candidate:${i}` }));
    const result = dedupe(renamed, existing as BotPack[]);
    const keptIds = new Set(result.kept.map((k) => k.id));
    return {
      kept: packs.filter((_, i) => keptIds.has(`candidate:${i}`)),
      dropped: result.dropped.map((d) => ({ id: idOf(d.id), duplicateOf: idOf(d.duplicateOf) })),
      method: "words",
      fallback,
    };
  };
  if (!opts.cache) return words("no embedder is configured");
  try {
    // Candidates get ids of their own: a new pack whose name gives the same id as one on the shelf
    // is the likeliest twin of all, and must be compared with it, not skipped as itself.
    const candidates = packs.map((p, i) => ({ ...asItem(p), id: `candidate:${i}` }));
    const result = await nearDuplicates(candidates, existing.map(asItem), { ...opts, cache: opts.cache });
    const keptIds = new Set(result.kept.map((k) => k.id));
    return {
      kept: packs.filter((_, i) => keptIds.has(`candidate:${i}`)),
      dropped: result.dropped.map((d) => ({ ...d, id: idOf(d.id), duplicateOf: idOf(d.duplicateOf) })),
      method: "embeddings",
    };
  } catch (error) {
    return words(error instanceof Error ? error.message : String(error));
  }
}

/** Every pair on a shelf at or above `threshold`, most alike first: for `seed dedupe` and review. */
export async function similarPairs(
  packs: readonly Comparable[],
  cache: EmbeddingCache,
  threshold = MAYBE_DUPLICATE,
): Promise<{ a: string; b: string; similarity: number }[]> {
  const vectors = await cache.get(packs.map(packText));
  const out: { a: string; b: string; similarity: number }[] = [];
  for (let i = 0; i < packs.length; i++) {
    for (let j = i + 1; j < packs.length; j++) {
      const similarity = cosine(vectors[i] as number[], vectors[j] as number[]);
      if (similarity >= threshold) {
        out.push({
          a: (packs[i] as Comparable).id,
          b: (packs[j] as Comparable).id,
          similarity: round(similarity),
        });
      }
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}
