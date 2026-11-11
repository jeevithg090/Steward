import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Db, memoryDb, STATEMENT_CACHE_SIZE } from "../src/index.ts";

/** Counts what `Db` prepares, by spying on the `DatabaseSync` inside it. */
function preparing(db: Db) {
  const inner = (db as unknown as { db: { prepare: (sql: string) => unknown } }).db;
  return vi.spyOn(inner, "prepare");
}

describe("Db", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("prepares a statement once and reuses it", () => {
    const db = memoryDb([{ id: "test.001_t", sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)" }]);
    const prepare = preparing(db);
    for (let i = 0; i < 5; i++) db.run("INSERT INTO t (name) VALUES (?)", [`n${i}`]);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM t")?.n).toBe(5);
    expect(db.all<{ name: string }>("SELECT name FROM t WHERE id > ?", [3]).map((r) => r.name)).toEqual([
      "n3",
      "n4",
    ]);
    expect(db.all<{ name: string }>("SELECT name FROM t WHERE id > ?", [4]).map((r) => r.name)).toEqual([
      "n4",
    ]);
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it("binds each call's parameters afresh", () => {
    const db = memoryDb();
    expect(db.get("SELECT ? AS a, ? AS b", [1, 2])).toEqual({ a: 1, b: 2 });
    // A kept statement must not remember the last call's second value.
    expect(db.get("SELECT ? AS a, ? AS b", [7])).toEqual({ a: 7, b: null });
    expect(db.get("SELECT :x AS x, :y AS y", { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(db.get("SELECT :x AS x, :y AS y", { x: 3 })).toEqual({ x: 3, y: null });
  });

  it("keeps working after a migration changes the schema under a kept statement", () => {
    const db = memoryDb([{ id: "test.001_t", sql: "CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('x');" }]);
    expect(db.get("SELECT * FROM t")).toEqual({ a: "x" });
    db.migrate([{ id: "test.002_t", sql: "ALTER TABLE t ADD COLUMN b TEXT NOT NULL DEFAULT 'y'" }]);
    expect(db.get("SELECT * FROM t")).toEqual({ a: "x", b: "y" });
    db.migrate([
      { id: "test.003_t", sql: "DROP TABLE t; CREATE TABLE t (z INTEGER); INSERT INTO t VALUES (5);" },
    ]);
    expect(db.get("SELECT * FROM t")).toEqual({ z: 5 });
  });

  it("reuses a statement after it failed", () => {
    const db = memoryDb([{ id: "test.001_t", sql: "CREATE TABLE t (id TEXT PRIMARY KEY)" }]);
    db.run("INSERT INTO t (id) VALUES (?)", ["a"]);
    expect(() => db.run("INSERT INTO t (id) VALUES (?)", ["a"])).toThrow(/UNIQUE/);
    db.run("INSERT INTO t (id) VALUES (?)", ["b"]);
    expect(db.all<{ id: string }>("SELECT id FROM t ORDER BY id").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps at most STATEMENT_CACHE_SIZE statements, dropping the least recently used", () => {
    const db = memoryDb();
    const prepare = preparing(db);
    const sql = (i: number) => `SELECT ${i} AS n`;
    for (let i = 0; i < STATEMENT_CACHE_SIZE; i++) db.get(sql(i));
    db.get(sql(0)); // used again: now the newest
    db.get(sql(STATEMENT_CACHE_SIZE)); // one too many: the oldest, 1, goes
    expect(prepare).toHaveBeenCalledTimes(STATEMENT_CACHE_SIZE + 1);
    db.get(sql(0));
    expect(prepare).toHaveBeenCalledTimes(STATEMENT_CACHE_SIZE + 1);
    db.get(sql(1));
    expect(prepare).toHaveBeenCalledTimes(STATEMENT_CACHE_SIZE + 2);
    expect((db as unknown as { statements: Map<string, unknown> }).statements.size).toBe(
      STATEMENT_CACHE_SIZE,
    );
  });

  it("joins nested transactions to the outer one, and rolls back all of it on an error", () => {
    const db = memoryDb([{ id: "test.001_t", sql: "CREATE TABLE t (id TEXT PRIMARY KEY)" }]);
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t (id) VALUES (?)", ["outer"]);
        db.tx(() => db.run("INSERT INTO t (id) VALUES (?)", ["inner"]));
        throw new Error("no");
      }),
    ).toThrow("no");
    expect(db.all("SELECT id FROM t")).toEqual([]);
    db.tx(() => {
      db.run("INSERT INTO t (id) VALUES (?)", ["outer"]);
      db.tx(() => db.run("INSERT INTO t (id) VALUES (?)", ["inner"]));
    });
    expect(db.all<{ id: string }>("SELECT id FROM t ORDER BY id").map((r) => r.id)).toEqual([
      "inner",
      "outer",
    ]);
  });

  it("waits for another program's write to finish when it opens the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "steward-db-"));
    dirs.push(dir);
    const path = join(dir, "steward.db");
    // Another program (the bots CLI, say) is halfway through a write on the same file.
    const other = new Worker(
      `const { DatabaseSync } = require("node:sqlite");
      const { workerData, parentPort } = require("node:worker_threads");
      const db = new DatabaseSync(workerData);
      db.exec("CREATE TABLE IF NOT EXISTS t (a)");
      db.exec("BEGIN EXCLUSIVE");
      db.exec("INSERT INTO t VALUES (1)");
      parentPort.postMessage("writing");
      const end = Date.now() + 300;
      while (Date.now() < end) {}
      db.exec("COMMIT");
      db.close();`,
      { eval: true, workerData: path },
    );
    await once(other, "message");
    // Switching to WAL needs the file to itself; it used to fail at once with "database is locked".
    const db = new Db(path);
    expect(db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode).toBe("wal");
    expect(db.all("SELECT a FROM t")).toEqual([{ a: 1 }]);
    db.close();
    await once(other, "exit");
  });

  it("opens a file in WAL mode, and closes with statements still kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "steward-db-"));
    dirs.push(dir);
    const path = join(dir, "nested", "steward.db");
    const db = new Db(path);
    expect(db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode).toBe("wal");
    expect(db.get<{ timeout: number }>("PRAGMA busy_timeout")?.timeout).toBe(5000);
    db.migrate([{ id: "test.001_t", sql: "CREATE TABLE t (id TEXT)" }]);
    db.run("INSERT INTO t (id) VALUES (?)", ["kept"]);
    db.close();
    const again = new Db(path);
    expect(again.all("SELECT id FROM t")).toEqual([{ id: "kept" }]);
    again.close();
  });
});
