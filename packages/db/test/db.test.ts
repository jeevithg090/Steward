import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Db, fromJson, MIGRATION_ID, memoryDb, toJson } from "../src/index.ts";

const tables = (db: Db) =>
  db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'",
    )
    .map((r) => r.name)
    .sort();
const applied = (db: Db) =>
  db.all<{ id: string }>("SELECT id FROM _migrations ORDER BY rowid").map((r) => r.id);
const names = (db: Db) => db.all<{ name: string }>("SELECT name FROM t ORDER BY rowid").map((r) => r.name);

function withTable(): Db {
  return memoryDb([{ id: "test.001_t", sql: "CREATE TABLE t (name TEXT NOT NULL)" }]);
}

describe("migrate", () => {
  it("applies each migration once, in the order given", () => {
    const db = memoryDb();
    const list = [
      { id: "a.001_one", sql: "CREATE TABLE one (x)" },
      { id: "a.002_two", sql: "CREATE TABLE two (x); INSERT INTO two VALUES (1)" },
    ];
    db.migrate(list);
    db.migrate(list);
    expect(applied(db)).toEqual(["a.001_one", "a.002_two"]);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM two")?.n).toBe(1);
    db.migrate([...list, { id: "a.003_three", sql: "CREATE TABLE three (x)" }]);
    expect(tables(db)).toEqual(["one", "three", "two"]);
  });

  it("leaves no table and no record of a migration that fails, and says why", () => {
    const db = memoryDb();
    expect(() =>
      db.migrate([{ id: "a.001_bad", sql: "CREATE TABLE half (x); CREATE TABLE broken (" }]),
    ).toThrow();
    expect(tables(db)).toEqual([]);
    expect(applied(db)).toEqual([]);
  });

  it("refuses a list with an id used twice, before applying any of it", () => {
    const db = memoryDb();
    expect(() =>
      db.migrate([
        { id: "server.005_devices", sql: "CREATE TABLE devices (x)" },
        { id: "server.005_delegations", sql: "CREATE TABLE delegations (x)" },
        { id: "server.005_devices", sql: "CREATE TABLE other (x)" },
      ]),
    ).toThrow(/share the id "server.005_devices"/);
    expect(tables(db)).toEqual([]);
  });

  it("refuses an id that does not name its package and number", () => {
    for (const id of ["001_init", "Gateway.001_x", "gateway.1_x", "gateway.001-x", "gateway.001_"]) {
      expect(MIGRATION_ID.test(id)).toBe(false);
      expect(() => memoryDb([{ id, sql: "SELECT 1" }])).toThrow(/must look like/);
    }
    for (const id of ["gateway.001_rules", "bots-gen.010_cache", "server.007_delegations"]) {
      expect(MIGRATION_ID.test(id)).toBe(true);
    }
  });
});

describe("tx", () => {
  it("commits, and rolls everything back on a throw", () => {
    const db = withTable();
    expect(db.tx(() => db.run("INSERT INTO t VALUES ('kept')").changes)).toBe(1);
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t VALUES ('gone')");
        throw new Error("no");
      }),
    ).toThrow("no");
    expect(names(db)).toEqual(["kept"]);
  });

  it("undoes the inner writes when an outer transaction rolls back", () => {
    const db = withTable();
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t VALUES ('outer')");
        db.tx(() => db.run("INSERT INTO t VALUES ('inner')"));
        throw new Error("outer fails");
      }),
    ).toThrow("outer fails");
    expect(names(db)).toEqual([]);
  });

  it("undoes only a failed inner transaction's writes when the outer one catches", () => {
    const db = withTable();
    db.tx(() => {
      db.run("INSERT INTO t VALUES ('outer')");
      try {
        db.tx(() => {
          db.run("INSERT INTO t VALUES ('inner')");
          throw new Error("inner fails");
        });
      } catch {
        // The caller carries on without the inner work.
      }
      db.tx(() => db.run("INSERT INTO t VALUES ('after')"));
    });
    expect(names(db)).toEqual(["outer", "after"]);
  });

  it("refuses an async function, whose writes after an await would escape it", async () => {
    const db = withTable();
    expect(() =>
      db.tx(async () => {
        db.run("INSERT INTO t VALUES ('before')");
        await Promise.resolve();
      }),
    ).toThrow(/not an async one/);
    expect(names(db)).toEqual([]);
    // Nothing is left open: the next transaction works.
    db.tx(() => db.run("INSERT INTO t VALUES ('next')"));
    expect(names(db)).toEqual(["next"]);
  });

  it("throws the first error even when SQLite has already rolled back", () => {
    const db = withTable();
    expect(() =>
      db.tx(() => {
        db.exec("ROLLBACK");
        throw new Error("the real problem");
      }),
    ).toThrow("the real problem");
    db.tx(() => db.run("INSERT INTO t VALUES ('fine')"));
    expect(names(db)).toEqual(["fine"]);
  });
});

describe("JSON columns", () => {
  it("falls back for null, empty and broken text", () => {
    expect(fromJson(null, [1])).toEqual([1]);
    expect(fromJson(undefined, "x")).toBe("x");
    expect(fromJson("", { a: 1 })).toEqual({ a: 1 });
    expect(fromJson("{broken", 0)).toBe(0);
    expect(fromJson(toJson({ b: [2] }), {})).toEqual({ b: [2] });
    expect(toJson(undefined)).toBe("null");
  });
});

describe.skipIf(process.platform === "win32")("the database file", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const mode = (path: string) => statSync(path).mode & 0o777;

  it("is readable by this user only: folder 0700, file and its WAL 0600", () => {
    dir = mkdtempSync(join(tmpdir(), "steward-db-"));
    const path = join(dir, "data", "steward.db");
    const db = new Db(path);
    db.migrate([{ id: "test.001_t", sql: "CREATE TABLE t (name TEXT)" }]);
    db.run("INSERT INTO t VALUES ('secret')");
    expect(mode(join(dir, "data"))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(mode(`${path}-wal`)).toBe(0o600);
    expect(mode(`${path}-shm`)).toBe(0o600);
    db.close();
  });

  it("tightens a file an older Steward left readable by everyone", () => {
    dir = mkdtempSync(join(tmpdir(), "steward-db-"));
    const path = join(dir, "steward.db");
    writeFileSync(path, "");
    chmodSync(path, 0o644);
    const db = new Db(path);
    expect(mode(path)).toBe(0o600);
    db.close();
  });
});
