import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import {
  BOT_CATEGORIES,
  BotAuthorSchema,
  type BotCategory,
  type BotListing,
  type BotPack,
  BotPackSchema,
  BotsQuery,
  type DirectoryIndex,
  TOOLS,
} from "@steward/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { hashPack } from "./canonical.ts";
import { parseBotFolder } from "./pack.ts";
import { validatePack } from "./validate.ts";

/**
 * The directory (plan §3): a static `index.json` with one listing per bot and a `packs/<id>.json`
 * each. `DirectoryClient` reads an index from a URL or a folder, ranks listings for a search, and
 * fetches packs; `buildIndex` makes the index from a folder of bot packs. The shared contracts give
 * the shapes as interfaces; the schemas here check what arrives from outside.
 */

const CATEGORY_KEYS = Object.keys(BOT_CATEGORIES) as [BotCategory, ...BotCategory[]];

export const BotListingSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  pitch: z.string().min(1).max(240),
  category: z.enum(CATEGORY_KEYS),
  version: z.number().int().min(1),
  author: BotAuthorSchema,
  needs: BotPackSchema.shape.needs,
  installs: z.number().int().min(0).default(0),
  usedBy: z.number().int().min(0).default(0),
  updatedAt: z.string().min(1),
  packUrl: z.string().min(1).max(2048),
  pageUrl: z.string().max(2048).optional(),
});

export const DirectoryIndexSchema = z.object({
  name: z.string().min(1).max(120),
  site: z.string().max(2048).optional(),
  generatedAt: z.string().min(1),
  categories: z.record(z.string(), z.string()),
  bots: z.array(BotListingSchema),
});

export const DEFAULT_CACHE_MS = 5 * 60_000;

export interface DirectoryClientOptions {
  /** An https URL of an `index.json`, or a path to one on disk. */
  source: string;
  fetch?: typeof fetch;
  /** How long an index is reused before it is read again. */
  cacheMs?: number;
}

export type BotsQueryValue = z.infer<typeof BotsQuery>;

const WEB = /^https?:\/\//i;

/** Words that carry no meaning for matching a job. */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "me",
  "i",
  "for",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "at",
  "with",
  "that",
  "this",
  "is",
  "it",
  "do",
  "does",
  "can",
  "bot",
  "bots",
  "help",
  "please",
  "something",
  "one",
]);

function tokensOf(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t && !STOPWORDS.has(t)),
    ),
  ];
}

/** Exact words count fully; "rental" for "rentals" or "plan" for "planner" count less. */
function tokenMatch(query: string, word: string): number {
  if (query === word) return 1;
  const [short, long] = query.length <= word.length ? [query, word] : [word, query];
  if (short.length >= 4 && long.length - short.length <= 3 && long.startsWith(short)) return 0.6;
  return 0;
}

function best(query: string, words: readonly string[]): number {
  let top = 0;
  for (const word of words) top = Math.max(top, tokenMatch(query, word));
  return top;
}

/** Name matches count most, then the category, then the pitch. */
function scoreOf(listing: BotListing, tokens: readonly string[], categories: Record<string, string>): number {
  const name = tokensOf(listing.name);
  const pitch = tokensOf(listing.pitch);
  const category = tokensOf(`${listing.category} ${categories[listing.category] ?? ""}`);
  let score = 0;
  for (const token of tokens) {
    score += 3 * best(token, name) + 2 * best(token, category) + best(token, pitch);
  }
  return score;
}

type Scored = { listing: BotListing; score: number };

const desc = (a: number, b: number) => b - a;
const later = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

function comparator(sort: BotsQueryValue["sort"]): (a: Scored, b: Scored) => number {
  const byScore = (a: Scored, b: Scored) => desc(a.score, b.score);
  const byInstalls = (a: Scored, b: Scored) => desc(a.listing.installs, b.listing.installs);
  const byUsed = (a: Scored, b: Scored) => desc(a.listing.usedBy, b.listing.usedBy);
  const byDate = (a: Scored, b: Scored) => later(a.listing.updatedAt, b.listing.updatedAt);
  const byId = (a: Scored, b: Scored) => a.listing.id.localeCompare(b.listing.id);
  const order =
    sort === "new"
      ? [byDate, byScore, byInstalls, byUsed]
      : sort === "used"
        ? [byUsed, byInstalls, byScore, byDate]
        : sort === "installs"
          ? [byInstalls, byUsed, byScore, byDate]
          : [byScore, byInstalls, byUsed, byDate];
  return (a, b) => {
    for (const step of order) {
      const result = step(a, b);
      if (result !== 0) return result;
    }
    return byId(a, b);
  };
}

function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${where} is not JSON`);
  }
}

export class DirectoryClient {
  private readonly source: string;
  private readonly fetchFn: typeof fetch;
  private readonly cacheMs: number;
  private cached?: { index: DirectoryIndex; at: number };
  private loading?: Promise<DirectoryIndex>;

  constructor(opts: DirectoryClientOptions) {
    this.source = opts.source;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.cacheMs = opts.cacheMs ?? DEFAULT_CACHE_MS;
  }

  /** True when the index comes from the web, which decides where packs may come from. */
  get fromWeb(): boolean {
    return WEB.test(this.source);
  }

  private async read(location: string, what: string): Promise<string> {
    if (WEB.test(location)) {
      const response = await this.fetchFn(location, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`The directory answered ${response.status} for ${what}`);
      return response.text();
    }
    return readFile(location, "utf8");
  }

  private async load(): Promise<DirectoryIndex> {
    const location = this.fromWeb ? this.source : resolve(this.source);
    const raw = parseJson(await this.read(location, "its index"), "The directory index");
    const checked = DirectoryIndexSchema.safeParse(raw);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new Error(
        `The directory index is not valid: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown"}`,
      );
    }
    return checked.data as DirectoryIndex;
  }

  /** The index, read once and reused for `cacheMs`. Concurrent callers share one read. */
  async index(): Promise<DirectoryIndex> {
    if (this.cached && Date.now() - this.cached.at < this.cacheMs) return this.cached.index;
    if (!this.loading) {
      this.loading = this.load()
        .then((index) => {
          this.cached = { index, at: Date.now() };
          return index;
        })
        .finally(() => {
          this.loading = undefined;
        });
    }
    return this.loading;
  }

  /** Forgets the cached index, so the next call reads it again. */
  invalidate(): void {
    this.cached = undefined;
  }

  /**
   * Listings for a query. With `q`, listings are scored by word overlap on name (counts most),
   * category and pitch, and ones that match nothing are left out; ties go to installs, then
   * "I use this" counts, then the newest. `sort` picks another first key.
   */
  async list(input: BotsQueryValue): Promise<{ bots: BotListing[]; total: number }> {
    const query = BotsQuery.parse(input);
    const index = await this.index();
    const tokens = tokensOf(query.q ?? "");
    let scored: Scored[] = index.bots
      .filter((listing) => !query.category || listing.category === query.category)
      .map((listing) => ({
        listing,
        score: tokens.length > 0 ? scoreOf(listing, tokens, index.categories) : 0,
      }));
    if (tokens.length > 0) scored = scored.filter((s) => s.score > 0);
    scored.sort(comparator(query.sort));
    return {
      bots: scored.slice(query.offset, query.offset + query.limit).map((s) => s.listing),
      total: scored.length,
    };
  }

  async get(id: string): Promise<BotListing | undefined> {
    const index = await this.index();
    return index.bots.find((b) => b.id === id);
  }

  /** Where a listing's pack is, resolved against the index. Refuses a disk path from a web index. */
  resolvePackUrl(packUrl: string): string {
    const trimmed = packUrl.trim();
    if (this.fromWeb) {
      let url: URL;
      try {
        url = new URL(trimmed, this.source);
      } catch {
        throw new Error(`"${trimmed}" is not a web address`);
      }
      if (!WEB.test(url.href)) {
        throw new Error("The directory index came from the web, so its packs must be web addresses too");
      }
      return url.href;
    }
    if (WEB.test(trimmed)) return trimmed;
    const base = dirname(resolve(this.source));
    let path: string;
    if (trimmed.startsWith("file:")) path = fileURLToPath(trimmed);
    else path = resolve(base, trimmed);
    const inside = relative(base, path);
    if (inside.startsWith("..") || inside.startsWith(sep) || /^[a-z]:/i.test(inside)) {
      throw new Error("A pack path must stay inside the directory folder");
    }
    return path;
  }

  /**
   * The full pack for a listing, or for a pack URL. It is checked against the schema, and when it
   * carries a hash, the hash must match its content: a pack that changed since it was listed is
   * refused rather than installed.
   */
  async pack(listingOrPackUrl: BotListing | string): Promise<BotPack> {
    const packUrl = typeof listingOrPackUrl === "string" ? listingOrPackUrl : listingOrPackUrl.packUrl;
    const location = this.resolvePackUrl(packUrl);
    const raw = parseJson(await this.read(location, `the pack at ${packUrl}`), "The pack");
    const checked = BotPackSchema.safeParse(raw);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new Error(
        `The pack at ${packUrl} is not valid: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown"}`,
      );
    }
    const pack = checked.data;
    if (pack.hash && hashPack(pack) !== pack.hash) throw new Error("pack changed since it was listed");
    return pack;
  }
}

// ── Building an index ──────────────────────────────────────────────────────────────────────────

export interface BuildIndexOptions {
  name?: string;
  /** The directory's web site, for `pageUrl` links: `<site>/bots/<id>`. */
  site?: string;
  /** The clock, for `updatedAt` on bots that changed. Tests pass a fixed one. */
  now?: () => Date;
}

async function readCategories(root: string): Promise<Record<string, string>> {
  const path = join(root, "categories.yaml");
  if (!existsSync(path)) return { ...BOT_CATEGORIES };
  const raw = parseYaml(await readFile(path, "utf8")) as unknown;
  const value =
    raw && typeof raw === "object" && "categories" in raw ? (raw as { categories: unknown }).categories : raw;
  const out: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && typeof item.id === "string") {
        out[item.id] =
          typeof item.label === "string" ? item.label : typeof item.name === "string" ? item.name : item.id;
      }
    }
  } else if (value && typeof value === "object") {
    for (const [id, label] of Object.entries(value as Record<string, unknown>)) {
      if (typeof label === "string") out[id] = label;
    }
  }
  return Object.keys(out).length > 0 ? out : { ...BOT_CATEGORIES };
}

const CountsSchema = z.record(
  z.string(),
  z.object({ installs: z.number().int().min(0).optional(), usedBy: z.number().int().min(0).optional() }),
);

async function readCounts(root: string): Promise<z.infer<typeof CountsSchema>> {
  const path = join(root, "counts.json");
  if (!existsSync(path)) return {};
  const checked = CountsSchema.safeParse(parseJson(await readFile(path, "utf8"), "counts.json"));
  if (!checked.success) {
    console.warn("counts.json: ignored: it is not a map of { installs, usedBy } by bot id");
    return {};
  }
  return checked.data;
}

/** The newest change in a folder, in milliseconds; 0 when it has no files. */
async function latestMtime(dir: string): Promise<number> {
  let latest = 0;
  const walk = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else latest = Math.max(latest, (await stat(full)).mtimeMs);
    }
  };
  await walk(dir);
  return latest;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * What a build needs of the last index: when it was built and each bot's date. Read loosely, so a
 * listing field added or changed since (a new field, a longer pitch) does not reset every date.
 */
const PreviousIndexSchema = z.object({
  generatedAt: z.string(),
  bots: z.array(z.object({ id: z.string(), updatedAt: z.string() }).nullable().catch(null)),
});

/** The last build's index, for each bot's `updatedAt`; undefined when there is none or it is broken. */
function previousIndex(text: string | undefined): z.infer<typeof PreviousIndexSchema> | undefined {
  if (!text) return undefined;
  try {
    const checked = PreviousIndexSchema.safeParse(JSON.parse(text));
    return checked.success ? checked.data : undefined;
  } catch {
    return undefined;
  }
}

/** The hash the built pack carried, read from its JSON text. */
function hashIn(text: string | undefined): string | undefined {
  if (!text) return undefined;
  try {
    const hash = (JSON.parse(text) as { hash?: unknown }).hash;
    return typeof hash === "string" ? hash : undefined;
  } catch {
    return undefined;
  }
}

/** Midnight UTC of an AI-made bot's `generated` date, or undefined when it cannot be read. */
function generatedAt(pack: BotPack): number | undefined {
  if (pack.author.kind !== "ai") return undefined;
  const value = pack.author.generated.trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Reads every `<dir>/bots/<id>/` folder, validates it against the built-in tool catalogue and the
 * gateway's rule check, and writes `<dir>/packs/<id>.json` (with its hash) and `<dir>/index.json`.
 * A folder that fails is skipped with a warning naming the problem, so one bad pack never takes
 * the directory down, and its old `packs/<id>.json` is removed, as is any pack whose folder is
 * gone. Install and use counts come from `<dir>/counts.json` when there is one.
 *
 * `updatedAt` is when the bot's content last changed, not when its files were touched: a bot whose
 * hash matches the last build keeps that build's date, so a fresh clone or a reformat changes
 * nothing. A bot that changed gets the time of this build. A bot the last build did not list gets
 * its `generated` date when it is AI-made, otherwise its files' modified time. Nothing changed
 * means nothing is written, so a rebuild with no changes leaves the folder as it was.
 */
export async function buildIndex(dir: string, opts: BuildIndexOptions = {}): Promise<DirectoryIndex> {
  const root = resolve(dir);
  const botsDir = join(root, "bots");
  const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);
  const ctx = { tools: Object.keys(TOOLS), validateRule: (when: string) => engine.validate(when) };
  const [categories, counts] = await Promise.all([readCategories(root), readCounts(root)]);
  const folders =
    existsSync(botsDir) && statSync(botsDir).isDirectory()
      ? (await readdir(botsDir, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : [];
  await mkdir(join(root, "packs"), { recursive: true });
  const site = opts.site?.replace(/\/+$/, "");
  const now = (opts.now ?? (() => new Date()))();
  const indexPath = join(root, "index.json");
  const oldIndex = await readText(indexPath);
  const previous = previousIndex(oldIndex);
  const before = new Map(
    (previous?.bots ?? []).flatMap((listing) =>
      listing && Number.isFinite(Date.parse(listing.updatedAt))
        ? [[listing.id, listing.updatedAt] as const]
        : [],
    ),
  );

  const bots: BotListing[] = [];
  for (const folder of folders) {
    const where = `bots/${folder}`;
    let parsed: BotPack;
    try {
      parsed = await parseBotFolder(join(botsDir, folder));
    } catch (error) {
      console.warn(`${where}: skipped: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (parsed.id !== folder) {
      console.warn(`${where}: skipped: bot.yaml says id "${parsed.id}" but the folder is "${folder}"`);
      continue;
    }
    const result = validatePack(parsed, ctx);
    for (const problem of result.problems.filter((p) => p.severity === "warn")) {
      console.warn(`${where}: ${problem.path}: ${problem.message}`);
    }
    if (!result.ok || !result.pack) {
      const errors = result.problems.filter((p) => p.severity === "error");
      console.warn(`${where}: skipped: ${errors.map((p) => `${p.path}: ${p.message}`).join("; ")}`);
      continue;
    }
    const pack: BotPack = { ...result.pack, hash: hashPack(result.pack) };
    const packPath = join(root, "packs", `${pack.id}.json`);
    const text = `${JSON.stringify(pack, null, 2)}\n`;
    const old = await readText(packPath);
    if (old !== text) await writeFile(packPath, text, "utf8");
    const listed = before.get(pack.id);
    let updatedAt: string;
    if (listed !== undefined && hashIn(old) === pack.hash) updatedAt = listed;
    else if (listed !== undefined) updatedAt = now.toISOString();
    else {
      const first = generatedAt(pack) ?? (await latestMtime(join(botsDir, folder)));
      updatedAt = new Date(first > 0 && first < now.getTime() ? first : now.getTime()).toISOString();
    }
    const count = counts[pack.id];
    bots.push({
      id: pack.id,
      name: pack.name,
      pitch: pack.pitch,
      category: pack.category,
      version: pack.version,
      author: pack.author,
      needs: pack.needs,
      installs: count?.installs ?? 0,
      usedBy: count?.usedBy ?? 0,
      updatedAt,
      packUrl: `packs/${pack.id}.json`,
      ...(site ? { pageUrl: `${site}/bots/${pack.id}` } : {}),
    });
  }

  // A pack whose folder is gone, or no longer passes, must not stay installable by its URL.
  const listedIds = new Set(bots.map((b) => b.id));
  for (const file of await readdir(join(root, "packs"))) {
    if (!file.endsWith(".json") || listedIds.has(file.slice(0, -".json".length))) continue;
    await rm(join(root, "packs", file), { force: true });
    console.warn(`packs/${file}: removed: no bot folder passes for it`);
  }

  const index: DirectoryIndex = {
    name: opts.name ?? "Steward bots",
    ...(site ? { site } : {}),
    generatedAt: now.toISOString(),
    categories,
    bots,
  };
  const render = (value: DirectoryIndex) => `${JSON.stringify(value, null, 2)}\n`;
  // The same listings as last time keep the last build's date, so the file does not change.
  if (previous && render({ ...index, generatedAt: previous.generatedAt }) === oldIndex) {
    index.generatedAt = previous.generatedAt;
  }
  const indexText = render(index);
  if (indexText !== oldIndex) await writeFile(indexPath, indexText, "utf8");
  return index;
}
