import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * One SQLite file holds everything Steward keeps: policy, approvals, the audit chain, tasks,
 * routines, memory and connector state. `node:sqlite` ships with Node, so there is nothing to
 * install and nothing to run beside the server.
 *
 * Every package owns its tables and hands its migrations to `Db.migrate`. Migration ids are global,
 * so prefix them with the package name (`gateway.001_policy`).
 *
 * The file holds mail, memory, every conversation and each phone's data key, so it is readable by
 * this user only: its folder is created `0700` and the file and its `-wal`/`-shm` siblings `0600`.
 */

/** `<package>.<three digits>_<name>`, for example `gateway.001_policy`. */
export const MIGRATION_ID = /^[a-z][a-z0-9-]*\.\d{3}_[a-z0-9_]+$/;

/**
 * Takes group and other access off a file or folder that has any, keeping the owner's. A no-op where
 * modes mean nothing (Windows) or the file is not ours to change.
 */
export function keepPrivate(path: string): void {
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode & 0o077) chmodSync(path, mode & 0o700);
  } catch {
    // Missing, or not ours: nothing to tighten.
  }
}

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

export class Db {
  readonly path: string;
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    this.path = path;
    const onDisk = path !== ":memory:" && !path.startsWith("file:");
    if (onDisk) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // Made here, private, before SQLite makes it with the umask's mode; its -wal and -shm files
      // take the database file's mode.
      if (!existsSync(path)) closeSync(openSync(path, "a", 0o600));
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    // Files an older Steward made readable by everyone.
    if (onDisk) for (const file of [path, `${path}-wal`, `${path}-shm`]) keepPrivate(file);
  }

  /**
   * Applies each migration once, in the order given, each in its own transaction. Refuses the whole
   * list, before applying any, when an id is malformed or appears twice: a second migration under a
   * used id would otherwise be skipped without a word.
   */
  migrate(migrations: readonly Migration[]): void {
    const ids = new Set<string>();
    for (const m of migrations) {
      if (!MIGRATION_ID.test(m.id)) {
        throw new Error(`Migration id "${m.id}" must look like "package.001_name".`);
      }
      if (ids.has(m.id)) throw new Error(`Two migrations share the id "${m.id}". Give one the next number.`);
      ids.add(m.id);
    }
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
    const stmt = this.db.prepare(sql);
    const r = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get<T>(sql: string, params: Params = []): T | undefined {
    const stmt = this.db.prepare(sql);
    const row = Array.isArray(params) ? stmt.get(...params) : stmt.get(params);
    return (row ?? undefined) as T | undefined;
  }

  all<T>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql);
    return (Array.isArray(params) ? stmt.all(...params) : stmt.all(params)) as T[];
  }

  /**
   * Runs `fn` in a transaction: all of its writes, or none. A nested call runs in a savepoint inside
   * the outer transaction, so when it throws only its own writes are undone, whether or not the
   * caller catches the error. `fn` must finish before it returns: an async function would commit at
   * its first `await`, so one is refused (and its writes so far undone).
   */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      const savepoint = `steward_tx_${this.depth}`;
      this.db.exec(`SAVEPOINT ${savepoint}`);
      this.depth++;
      try {
        const out = settled(fn());
        this.db.exec(`RELEASE ${savepoint}`);
        return out;
      } catch (err) {
        quietly(() => {
          this.db.exec(`ROLLBACK TO ${savepoint}`);
          this.db.exec(`RELEASE ${savepoint}`);
        });
        throw err;
      } finally {
        this.depth--;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const out = settled(fn());
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      // When SQLite has already rolled back (a full disk, say), the first error is the one to see.
      quietly(() => this.db.exec("ROLLBACK"));
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.db.close();
  }
}

/** Refuses a promise from a transaction's function: its writes after an `await` would escape it. */
function settled<T>(out: T): T {
  if (out !== null && typeof out === "object" && typeof (out as { then?: unknown }).then === "function") {
    // Nobody will wait for it now; its failure must not become an unhandled rejection.
    (out as unknown as PromiseLike<unknown>).then(undefined, () => {});
    throw new TypeError("Db.tx takes a function that finishes before it returns, not an async one.");
  }
  return out;
}

function quietly(fn: () => void): void {
  try {
    fn();
  } catch {
    // Already undone.
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
