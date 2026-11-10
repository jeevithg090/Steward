import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
/** The most of a listing's `keywords`: enough for its starters and skills, small for the index. */
const KEYWORDS_MAX = 400;

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
  /** The pack's content hash when it was listed. The pack fetched must still have it. */
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  /**
   * Words from the starters and skills, so a search finds more than the name and pitch say. Only a
   * help: a listing whose words are too long is read without them, never refused.
   */
  keywords: z.string().max(KEYWORDS_MAX).optional().catch(undefined),
});

export const DirectoryIndexSchema = z.object({
  name: z.string().min(1).max(120),
  site: z.string().max(2048).optional(),
  generatedAt: z.string().min(1),
  categories: z.record(z.string(), z.string()),
  bots: z.array(BotListingSchema),
});

export const DEFAULT_CACHE_MS = 5 * 60_000;
/** How long one read from the web may take before it is given up. */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** The largest index read: 1,251 bots are about 1 MB. */
export const MAX_INDEX_BYTES = 16 * 1024 * 1024;
/** The largest pack read. The schema's own limits keep a real pack well under 1 MB. */
export const MAX_PACK_BYTES = 2 * 1024 * 1024;
/** Redirects followed, each one checked like the address it came from. */
const MAX_REDIRECTS = 3;

export interface DirectoryClientOptions {
  /** An https URL of an `index.json`, or a path to one on disk. */
  source: string;
  /**
   * How the web is read. The server passes one that refuses private and metadata addresses
   * (except the configured directory's own), since a pack address can come from a link.
   */
  fetch?: typeof fetch;
  /** How long an index is reused before it is read again. */
  cacheMs?: number;
  /** How long one read from the web may take. */
  timeoutMs?: number;
}

export type BotsQueryValue = z.infer<typeof BotsQuery>;

const WEB = /^https?:\/\//i;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Where a pack or index may be read from on the web: https anywhere, and plain http only on this
 * machine, since anything else could be changed on the way.
 */
function checkWebLocation(url: URL): void {
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname.toLowerCase())) return;
  throw new Error(`Steward only reads bots from https addresses, and ${url.host || url.href} is not one`);
}

/** The body as text, refused once it passes `max` bytes, whatever the server said its length was. */
async function readCapped(response: Response, max: number, what: string): Promise<string> {
  const tooBig = () => new Error(`${what} is larger than ${Math.round(max / 1024 / 1024)} MB`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => {});
    throw tooBig();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

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

/** The words of a text that can match a job, in any script. */
function tokensOf(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t && !STOPWORDS.has(t)),
    ),
  ];
}

/** Whether a listing reaches what a `needs` filter names. `none` is chat only: it reaches nothing. */
function reaches(needs: BotListing["needs"], wanted: NonNullable<BotsQueryValue["needs"]>): boolean {
  const surfaces = new Set<string>(needs.connectors);
  for (const tool of needs.tools) {
    if (Object.hasOwn(TOOLS, tool)) surfaces.add(TOOLS[tool as keyof typeof TOOLS].surface);
    else surfaces.add("mcp");
  }
  surfaces.delete("ui");
  return wanted === "none" ? surfaces.size === 0 : surfaces.has(wanted);
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

/** Name matches count most, then the category, then the pitch and the starters and skills. */
function scoreOf(listing: BotListing, tokens: readonly string[], categories: Record<string, string>): number {
  const name = tokensOf(listing.name);
  const pitch = tokensOf(listing.pitch);
  const category = tokensOf(`${listing.category} ${categories[listing.category] ?? ""}`);
  const keywords = tokensOf(listing.keywords ?? "");
  let score = 0;
  for (const token of tokens) {
    score +=
      3 * best(token, name) + 2 * best(token, category) + Math.max(best(token, pitch), best(token, keywords));
  }
  return score;
}

/** A listing's search words: its starters, then its skills' names and descriptions, cut at a word. */
export function keywordsOf(pack: Pick<BotPack, "starters" | "skills">): string {
  const parts = [
    ...pack.starters,
    ...pack.skills.flatMap((skill) => [skill.name.replace(/-/g, " "), skill.description]),
  ];
  const text = parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  if (text.length <= KEYWORDS_MAX) return text;
  const cut = text.slice(0, KEYWORDS_MAX);
  const space = cut.lastIndexOf(" ");
  return space > KEYWORDS_MAX / 2 ? cut.slice(0, space) : cut;
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

/**
 * The directory has no pack at that address: no such file in its folder, or the web answered 404
 * or 410. Its message names the address as it was given, never a path on this machine.
 */
export class PackNotFoundError extends Error {
  constructor(packUrl: string) {
    super(`There is no bot at ${packUrl}`);
    this.name = "PackNotFoundError";
  }
}

/** A failed file read, without the absolute path Node puts in its message. */
function fileProblem(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code !== "string" || !/^E[A-Z]+$/.test(code)) return undefined;
  return code;
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
  private readonly timeoutMs: number;
  private cached?: { index: DirectoryIndex; at: number };
  private loading?: Promise<DirectoryIndex>;

  constructor(opts: DirectoryClientOptions) {
    this.source = opts.source;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.cacheMs = opts.cacheMs ?? DEFAULT_CACHE_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** True when the index comes from the web, which decides where packs may come from. */
  get fromWeb(): boolean {
    return WEB.test(this.source);
  }

  /**
   * Reads a location: a file, or a web address with a time limit and a size cap. Redirects are
   * followed by hand, a few at most, each one held to the same rules as the first address.
   */
  private async read(location: string, what: string, maxBytes: number): Promise<string> {
    if (!WEB.test(location)) return readFile(location, "utf8");
    const signal = AbortSignal.timeout(this.timeoutMs);
    let url = new URL(location);
    for (let hop = 0; ; hop++) {
      checkWebLocation(url);
      let response: Response;
      try {
        response = await this.fetchFn(url.href, {
          headers: { accept: "application/json" },
          redirect: "manual",
          signal,
        });
      } catch (err) {
        if (signal.aborted) {
          throw new Error(`The directory took longer than ${this.timeoutMs / 1000} seconds for ${what}`);
        }
        throw err;
      }
      const next = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && next) {
        await response.body?.cancel().catch(() => {});
        if (hop >= MAX_REDIRECTS) throw new Error(`The directory redirected too many times for ${what}`);
        url = new URL(next, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw Object.assign(new Error(`The directory answered ${response.status} for ${what}`), {
          status: response.status,
        });
      }
      try {
        return await readCapped(response, maxBytes, `${what.charAt(0).toUpperCase()}${what.slice(1)}`);
      } catch (err) {
        if (signal.aborted) {
          throw new Error(`The directory took longer than ${this.timeoutMs / 1000} seconds for ${what}`);
        }
        throw err;
      }
    }
  }

  private async load(): Promise<DirectoryIndex> {
    const location = this.fromWeb ? this.source : resolve(this.source);
    const raw = parseJson(await this.read(location, "the index", MAX_INDEX_BYTES), "The directory index");
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
    // Words that say nothing about a job ("help me please") match no bot, rather than every bot.
    if (query.q?.trim() && tokens.length === 0) return { bots: [], total: 0 };
    let scored: Scored[] = index.bots
      .filter((listing) => !query.category || listing.category === query.category)
      .filter((listing) => !query.needs || reaches(listing.needs, query.needs))
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

  /**
   * Where a listing's pack is, resolved against the index. Refuses a disk path from a web index, a
   * path outside a folder index, and a plain http address anywhere but this machine.
   */
  resolvePackUrl(packUrl: string): string {
    const trimmed = packUrl.trim();
    if (this.fromWeb || WEB.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed, this.fromWeb ? this.source : undefined);
      } catch {
        throw new Error(`"${trimmed}" is not a web address`);
      }
      if (!WEB.test(url.href)) {
        throw new Error("The directory index came from the web, so its packs must be web addresses too");
      }
      checkWebLocation(url);
      return url.href;
    }
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
    const listing = typeof listingOrPackUrl === "string" ? await this.listingAt(location) : listingOrPackUrl;
    let text: string;
    try {
      text = await this.read(location, `the pack at ${packUrl}`, MAX_PACK_BYTES);
    } catch (err) {
      const status = (err as { status?: unknown }).status;
      const code = fileProblem(err);
      if (status === 404 || status === 410 || code === "ENOENT" || code === "ENOTDIR") {
        throw new PackNotFoundError(packUrl);
      }
      if (code) throw new Error(`The pack at ${packUrl} could not be read (${code})`);
      throw err;
    }
    const raw = parseJson(text, "The pack");
    const checked = BotPackSchema.safeParse(raw);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new Error(
        `The pack at ${packUrl} is not valid: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown"}`,
      );
    }
    const pack = checked.data;
    const actual = hashPack(pack);
    if (pack.hash && actual !== pack.hash) throw new Error("pack changed since it was listed");
    // The listing pins the pack: one swapped since the index was built, hash and all, is refused.
    if (listing?.hash && actual !== listing.hash) throw new Error("pack changed since it was listed");
    return pack;
  }

  /** The index's listing whose pack lives at `location`, when the index can be read and has one. */
  private async listingAt(location: string): Promise<BotListing | undefined> {
    let index: DirectoryIndex;
    try {
      index = await this.index();
    } catch {
      return undefined; // No index to compare with: the pack's own hash still has to hold.
    }
    return index.bots.find((listing) => {
      try {
        return this.resolvePackUrl(listing.packUrl) === location;
      } catch {
        return false;
      }
    });
  }
}

// ── Building an index ──────────────────────────────────────────────────────────────────────────

export interface BuildIndexOptions {
  name?: string;
  /** The directory's web site, for `pageUrl` links: `<site>/bots/<id>`. */
  site?: string;
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

/** The newest change in a folder, for `updatedAt`. */
async function latestMtime(dir: string): Promise<string> {
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
  return new Date(latest || Date.now()).toISOString();
}

/**
 * Reads every `<dir>/bots/<id>/` folder, validates it against the built-in tool catalogue and the
 * gateway's rule check, and writes `<dir>/packs/<id>.json` (with its hash) and `<dir>/index.json`.
 * A folder that fails is skipped with a warning naming the problem, so one bad pack never takes
 * the directory down. Install and use counts come from `<dir>/counts.json` when there is one.
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
    await writeFile(join(root, "packs", `${pack.id}.json`), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    const count = counts[pack.id];
    const keywords = keywordsOf(pack);
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
      updatedAt: await latestMtime(join(botsDir, folder)),
      packUrl: `packs/${pack.id}.json`,
      ...(site ? { pageUrl: `${site}/bots/${pack.id}` } : {}),
      hash: pack.hash,
      ...(keywords ? { keywords } : {}),
    });
  }

  const index: DirectoryIndex = {
    name: opts.name ?? "Steward bots",
    ...(site ? { site } : {}),
    generatedAt: new Date().toISOString(),
    categories,
    bots,
  };
  await writeFile(join(root, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}
