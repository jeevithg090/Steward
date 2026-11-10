import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/**
 * One SQLite file holds everything Steward keeps: policy, approvals, the audit chain, tasks,
 * routines, memory and connector state. `node:sqlite` ships with Node, so there is nothing to
 * install and nothing to run beside the server.
 *
 * Every package owns its tables and hands its migrations to `Db.migrate`. Migration ids are global,
 * so prefix them with the package name (`gateway.001_policy`).
 */

export interface Migration {
  /** Globally unique and never renamed, e.g. `gateway.001_policy`. */
  id: string;
  sql: string;
}

export type Params = Record<string, SQLInputValue> | SQLInputValue[];

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * How many prepared statements `Db` keeps. Preparing costs far more than running a small query
 * (20 to 200 µs against about 3 µs), and Steward runs the same few hundred queries over and over.
 */
export const STATEMENT_CACHE_SIZE = 256;

export class Db {
  readonly path: string;
  private readonly db: DatabaseSync;
  private depth = 0;
  /** Prepared statements by their SQL, least recently used first. */
  private readonly statements = new Map<string, StatementSync>();

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // First, so that switching to WAL waits for another process (the bots CLI, say) instead of
    // failing at once with SQLITE_BUSY.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  }

  /** Applies each migration once, in the order given, each in its own transaction. */
  migrate(migrations: readonly Migration[]): void {
    for (const m of migrations) {
      const done = this.get<{ id: string }>("SELECT id FROM _migrations WHERE id = ?", [m.id]);
      if (done) continue;
      this.tx(() => {
        this.db.exec(m.sql);
        this.run("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", [m.id, new Date().toISOString()]);
      });
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: Params = []): RunResult {
    const stmt = this.prepare(sql);
    const r = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get<T>(sql: string, params: Params = []): T | undefined {
    const stmt = this.prepare(sql);
    const row = Array.isArray(params) ? stmt.get(...params) : stmt.get(params);
    return (row ?? undefined) as T | undefined;
  }

  all<T>(sql: string, params: Params = []): T[] {
    const stmt = this.prepare(sql);
    return (Array.isArray(params) ? stmt.all(...params) : stmt.all(params)) as T[];
  }

  /**
   * The statement for `sql`, prepared once and kept. SQLite prepares it again by itself when a
   * migration changes the schema, and every call binds its own parameters afresh, so a kept
   * statement behaves as a new one. `run`, `get` and `all` finish with a statement before they
   * return, so one is never in use twice at once.
   */
  private prepare(sql: string): StatementSync {
    const kept = this.statements.get(sql);
    if (kept) {
      // Most recently used goes last.
      this.statements.delete(sql);
      this.statements.set(sql, kept);
      return kept;
    }
    const stmt = this.db.prepare(sql);
    this.statements.set(sql, stmt);
    if (this.statements.size > STATEMENT_CACHE_SIZE) {
      const oldest = this.statements.keys().next().value;
      if (oldest !== undefined) this.statements.delete(oldest);
    }
    return stmt;
  }

  /** Runs `fn` in a transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}

/** Serialises a value for a TEXT JSON column. */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Reads a TEXT JSON column, falling back when it is empty or broken. */
export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** A fresh in-memory database, for tests. */
export function memoryDb(migrations: readonly Migration[] = []): Db {
  const db = new Db(":memory:");
  db.migrate(migrations);
  return db;
}
