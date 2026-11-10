import { MIGRATION_ID, memoryDb } from "@steward/db";
import { describe, expect, it } from "vitest";
import { migrations as server } from "../src/store/migrations.ts";
import { missingPackages } from "./helpers.ts";

const missing = await missingPackages();
if (missing.length > 0) it.todo(`migrations (waiting for ${missing.join(", ")})`);

describe.runIf(missing.length === 0)("the migrations applied at start", async () => {
  const [
    { migrations: gateway },
    { migrations: connectors },
    { migrations: proactive },
    { migrations: harnesses },
  ] = await Promise.all([
    import("@steward/gateway"),
    import("@steward/connectors"),
    import("@steward/proactive"),
    import("@steward/harnesses"),
  ]);
  const lists = { gateway, connectors, proactive, harnesses, server };

  it("are named after the package that owns them, each id once", () => {
    const seen = new Set<string>();
    for (const [owner, list] of Object.entries(lists)) {
      for (const { id } of list) {
        expect(id).toMatch(MIGRATION_ID);
        expect(id.startsWith(`${owner}.`), `${id} is in ${owner}'s list`).toBe(true);
        expect(seen.has(id), `${id} is used twice`).toBe(false);
        seen.add(id);
      }
    }
  });

  it("number each package's migrations in order", () => {
    for (const list of Object.values(lists)) {
      const numbers = list.map(({ id }) => Number(id.split(".")[1]?.slice(0, 3)));
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    }
  });

  it("apply together on an empty database, and again without change", () => {
    const all = Object.values(lists).flat();
    const db = memoryDb(all);
    db.migrate(all);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM _migrations")?.n).toBe(all.length);
    db.close();
  });
});
