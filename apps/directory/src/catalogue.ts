import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildIndex, DirectoryIndexSchema } from "@steward/bots";
import { type RetiredEntry, readRetired } from "@steward/bots-gen";
import {
  BOT_CATEGORIES,
  type BotListing,
  type BotPack,
  BotPackSchema,
  type DirectoryIndex,
} from "@steward/shared";
import type { DirectoryStore } from "./store.ts";

/**
 * The directory as this server serves it: the built `index.json` and `packs/<id>.json` from the
 * folder, with install and "I use this" counts from the store laid over them, and a full-text
 * index over name, pitch, starters, category and README in an in-memory SQLite FTS5 table. The
 * folder stays the source of truth; `rebuild` runs `buildIndex` over it and reloads.
 */
export interface CatalogueOptions {
  /** The folder with `bots/`, `index.json` and `packs/`. */
  dir: string;
  store: DirectoryStore;
  /** The public site, for `pageUrl` and the index's `site`. No trailing slash. */
  site: string;
  name: string;
}

export type SortKey = "match" | "new" | "used" | "installs";

export interface SearchQuery {
  q?: string;
  category?: string;
  /** Connectors or tools a bot must need (`mail`, `calendar`, `web_search`); `none` means no connectors. */
  needs?: string[];
  sort?: SortKey;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  bots: BotListing[];
  total: number;
}

export interface CategoryCount {
  id: string;
  label: string;
  count: number;
}

export const MAX_LIMIT = 100;

/** Words that carry no meaning for finding a job. */
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
  "want",
  "need",
]);

export function tokensOf(text: string): string[] {
  const seen = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOPWORDS.has(token) || token.length < 2) continue;
    seen.add(token);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** An FTS5 query: each word quoted, longer ones as prefixes, any of them matching. */
export function ftsQuery(tokens: readonly string[]): string {
  return tokens.map((t) => (t.length >= 4 ? `"${t}"*` : `"${t}"`)).join(" OR ");
}

/** Column weights for bm25: id (unindexed), name, pitch, starters, category, readme. */
const RANK = "bm25(fts, 0, 6, 4, 3, 2, 1)";

function orderBy(sort: SortKey, withQuery: boolean): string {
  const rank = withQuery ? [RANK] : [];
  const installs = "b.installs DESC";
  const used = "b.used_by DESC";
  const newest = "b.updated_at DESC";
  const keys =
    sort === "new"
      ? [newest, ...rank, installs, used]
      : sort === "used"
        ? [used, installs, ...rank, newest]
        : sort === "installs"
          ? [installs, used, ...rank, newest]
          : [...rank, installs, used, newest];
  return [...keys, "b.id"].join(", ");
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export class Catalogue {
  private readonly db = new DatabaseSync(":memory:");
  private raw = new Map<string, BotListing>();
  private packs = new Map<string, BotPack>();
  private counts = new Map<string, { installs: number; usedBy: number }>();
  categories: Record<string, string> = { ...BOT_CATEGORIES };
  generatedAt = new Date(0).toISOString();
  loaded = false;
  /** Bots retired from this directory (`retired.json`), so their pages can say so. */
  retired = new Map<string, RetiredEntry>();

  constructor(private readonly opts: CatalogueOptions) {
    this.db.exec(`
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        installs INTEGER NOT NULL DEFAULT 0,
        used_by INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE fts USING fts5(id UNINDEXED, name, pitch, starters, category, readme, tokenize = 'porter unicode61');
    `);
  }

  get dir(): string {
    return this.opts.dir;
  }

  get site(): string {
    return this.opts.site;
  }

  get name(): string {
    return this.opts.name;
  }

  get size(): number {
    return this.raw.size;
  }

  /** Reads `index.json` and every pack. A pack that cannot be read is skipped with a warning. */
  async load(): Promise<void> {
    const indexPath = join(this.opts.dir, "index.json");
    if (!existsSync(indexPath)) {
      throw new Error(
        `No index.json in ${this.opts.dir}. Build the directory first: pnpm --filter @steward/bots-gen seed build`,
      );
    }
    const parsed = DirectoryIndexSchema.safeParse(JSON.parse(await readFile(indexPath, "utf8")));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `index.json is not valid: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown"}`,
      );
    }
    const index = parsed.data as DirectoryIndex;
    const installs = this.opts.store.installsByBot();
    const usedBy = this.opts.store.usedByBot();

    const raw = new Map<string, BotListing>();
    const packs = new Map<string, BotPack>();
    const counts = new Map<string, { installs: number; usedBy: number }>();
    for (const listing of index.bots) {
      const relative = /^https?:\/\//i.test(listing.packUrl) ? `packs/${listing.id}.json` : listing.packUrl;
      const packPath = resolve(this.opts.dir, relative);
      let pack: BotPack;
      try {
        pack = BotPackSchema.parse(JSON.parse(await readFile(packPath, "utf8")));
      } catch (error) {
        console.warn(`${listing.id}: skipped: its pack could not be read (${(error as Error).message})`);
        continue;
      }
      raw.set(listing.id, listing);
      packs.set(listing.id, pack);
      counts.set(listing.id, {
        installs: installs.get(listing.id) ?? 0,
        usedBy: usedBy.get(listing.id) ?? 0,
      });
    }

    const insertBot = this.db.prepare(
      "INSERT INTO bots (id, category, installs, used_by, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    const insertFts = this.db.prepare(
      "INSERT INTO fts (id, name, pitch, starters, category, readme) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM bots; DELETE FROM fts;");
      for (const [id, listing] of raw) {
        const pack = packs.get(id)!;
        const count = counts.get(id)!;
        insertBot.run(id, listing.category, count.installs, count.usedBy, listing.updatedAt);
        insertFts.run(
          id,
          listing.name,
          listing.pitch,
          pack.starters.join("\n"),
          `${listing.category} ${index.categories[listing.category] ?? BOT_CATEGORIES[listing.category] ?? ""}`,
          pack.readme,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.raw = raw;
    this.packs = packs;
    this.counts = counts;
    this.categories = Object.keys(index.categories).length > 0 ? index.categories : { ...BOT_CATEGORIES };
    this.generatedAt = index.generatedAt;
    this.retired = new Map((await readRetired(this.opts.dir).catch(() => [])).map((r) => [r.id, r]));
    this.loaded = true;
  }

  private decorate(listing: BotListing): BotListing {
    const count = this.counts.get(listing.id) ?? { installs: 0, usedBy: 0 };
    return {
      ...listing,
      installs: count.installs,
      usedBy: count.usedBy,
      packUrl: `packs/${listing.id}.json`,
      pageUrl: `${this.opts.site}/bots/${listing.id}`,
    };
  }

  /** The index as Steward reads it: counts laid over the file, `site` set to this server. */
  index(): DirectoryIndex {
    return {
      name: this.opts.name,
      site: this.opts.site,
      generatedAt: this.generatedAt,
      categories: this.categories,
      bots: [...this.raw.values()].map((l) => this.decorate(l)),
    };
  }

  listing(id: string): BotListing | undefined {
    const raw = this.raw.get(id);
    return raw ? this.decorate(raw) : undefined;
  }

  pack(id: string): BotPack | undefined {
    return this.packs.get(id);
  }

  /** The URL of a listing's pack on this server. */
  packUrlOf(id: string): string {
    return `${this.opts.site}/packs/${encodeURIComponent(id)}.json`;
  }

  /**
   * Listings for a query. With words, bm25 over name (counts most), pitch, starters, category and
   * README decides the order; without, installs, then "I use this", then the newest. `sort` puts
   * another key first. `needs` keeps bots that need every item named.
   */
  search(query: SearchQuery = {}): SearchResult {
    const limit = clamp(Math.trunc(query.limit ?? 50), 1, MAX_LIMIT);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const sort: SortKey = query.sort ?? "match";
    const tokens = tokensOf(query.q ?? "");
    const category = query.category?.trim();
    const params: string[] = [];
    let sql: string;
    if (tokens.length > 0) {
      params.push(ftsQuery(tokens));
      if (category) params.push(category);
      sql = `SELECT b.id FROM fts JOIN bots b ON b.id = fts.id WHERE fts MATCH ?${
        category ? " AND b.category = ?" : ""
      } ORDER BY ${orderBy(sort, true)}`;
    } else {
      if (category) params.push(category);
      sql = `SELECT b.id FROM bots b${category ? " WHERE b.category = ?" : ""} ORDER BY ${orderBy(sort, false)}`;
    }
    const ids = this.db
      .prepare(sql)
      .all(...params)
      .map((row) => (row as { id: string }).id);
    const needs = (query.needs ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean);
    let listings = ids.flatMap((id) => {
      const listing = this.raw.get(id);
      return listing ? [listing] : [];
    });
    if (needs.length > 0) {
      listings = listings.filter((listing) => {
        const has = new Set(
          [...listing.needs.connectors, ...listing.needs.tools].map((s) => s.toLowerCase()),
        );
        return needs.every((n) => (n === "none" ? listing.needs.connectors.length === 0 : has.has(n)));
      });
    }
    return {
      bots: listings.slice(offset, offset + limit).map((l) => this.decorate(l)),
      total: listings.length,
    };
  }

  latest(limit = 50, category?: string): BotListing[] {
    return this.search({ sort: "new", limit, ...(category ? { category } : {}) }).bots;
  }

  /** Every category in the index's order, with how many bots it holds. */
  categoryCounts(): CategoryCount[] {
    const rows = this.db.prepare("SELECT category, COUNT(*) AS n FROM bots GROUP BY category").all() as {
      category: string;
      n: number;
    }[];
    const counts = new Map(rows.map((r) => [r.category, Number(r.n)]));
    return Object.entries(this.categories).map(([id, label]) => ({ id, label, count: counts.get(id) ?? 0 }));
  }

  // ── Counts ───────────────────────────────────────────────────────────────────────────────────

  /** One more install today. Nothing for an id that is not listed. */
  installed(id: string, day?: string): number | undefined {
    if (!this.raw.has(id)) return undefined;
    const installs = this.opts.store.countInstall(id, day);
    this.setCounts(id, { installs });
    return installs;
  }

  /** "I use this" from one account. `added` is false when the account had already said so. */
  used(id: string, githubId: number): { usedBy: number; added: boolean } | undefined {
    if (!this.raw.has(id)) return undefined;
    const added = this.opts.store.vote(id, githubId);
    const usedBy = this.opts.store.usedBy(id);
    this.setCounts(id, { usedBy });
    return { usedBy, added };
  }

  unused(id: string, githubId: number): { usedBy: number; removed: boolean } | undefined {
    if (!this.raw.has(id)) return undefined;
    const removed = this.opts.store.unvote(id, githubId);
    const usedBy = this.opts.store.usedBy(id);
    this.setCounts(id, { usedBy });
    return { usedBy, removed };
  }

  private setCounts(id: string, change: Partial<{ installs: number; usedBy: number }>): void {
    const current = this.counts.get(id) ?? { installs: 0, usedBy: 0 };
    const next = { ...current, ...change };
    this.counts.set(id, next);
    this.db
      .prepare("UPDATE bots SET installs = ?, used_by = ? WHERE id = ?")
      .run(next.installs, next.usedBy, id);
  }

  // ── Rebuilding ───────────────────────────────────────────────────────────────────────────────

  /**
   * Writes the counts the store holds to `counts.json`, rebuilds `index.json` and `packs/` from
   * `bots/` with `buildIndex` (every pack validated again, through the gateway's rule engine), and
   * reloads. Called after a reviewer approves a submission.
   */
  async rebuild(): Promise<DirectoryIndex> {
    await writeFile(
      join(this.opts.dir, "counts.json"),
      `${JSON.stringify(this.opts.store.counts(), null, 2)}\n`,
      "utf8",
    );
    await buildIndex(this.opts.dir, { name: this.opts.name, site: this.opts.site });
    await this.load();
    return this.index();
  }

  close(): void {
    this.db.close();
  }
}
