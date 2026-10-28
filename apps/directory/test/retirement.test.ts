import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fixture, makeFixture, pack, SEED } from "./fixture.ts";

/** 92 days after the AI-made bots in the fixture were made, at 04:00 UTC. */
const NOW = new Date("2027-01-28T04:00:00Z");
const AI = { kind: "ai" as const, model: "test/model", generated: "2026-10-28" };

let f: Fixture;

beforeEach(async () => {
  f = await makeFixture({
    seed: [
      ...SEED,
      pack("used-ai", {
        name: "Used AI",
        pitch: "Someone installed this one.",
        category: "food",
        author: AI,
      }),
      pack("new-ai", {
        name: "New AI",
        pitch: "Made last month.",
        category: "food",
        author: { ...AI, generated: "2026-12-20" },
      }),
    ],
    config: { retirement: { days: 90, hour: 3, floor: 2, regenerate: false } },
  });
});

afterEach(async () => {
  await f.close();
});

describe("the nightly retirement", () => {
  it("is due once a day after its hour, and never when switched off", async () => {
    const task = f.server.retirement;
    expect(task.due(new Date("2027-01-28T02:59:00Z"))).toBe(false);
    expect(task.due(NOW)).toBe(true);
    await task.tick(NOW);
    expect(task.due(new Date("2027-01-28T23:00:00Z"))).toBe(false);
    expect(task.due(new Date("2027-01-29T03:00:00Z"))).toBe(true);
    const off = await makeFixture({
      config: { retirement: { days: 0, hour: 0, floor: 0, regenerate: false } },
    });
    try {
      expect(off.server.retirement.due(NOW)).toBe(false);
      expect(await off.server.retirement.tick(NOW)).toBeUndefined();
    } finally {
      await off.close();
    }
  });

  it("retires unused AI-made bots, keeps installed and young ones, and says so on the old page", async () => {
    await f.request("/api/bots/used-ai/installed", { method: "POST" });
    const run = await f.server.retirement.tick(NOW);
    expect(run?.retired.map((r) => r.id)).toEqual(["meal-planner"]);
    expect(run?.young).toBe(1);
    // food had meal-planner, used-ai and new-ai; two left is at the floor.
    expect(run?.thinned).toEqual([]);

    const index = (await f.request("/index.json")).body as { bots: { id: string }[] };
    expect(index.bots.map((b) => b.id)).not.toContain("meal-planner");
    expect(index.bots.map((b) => b.id)).toEqual(expect.arrayContaining(["used-ai", "new-ai", "rent-scout"]));
    expect(existsSync(join(f.dir, "bots", "meal-planner"))).toBe(false);
    expect(JSON.parse(readFileSync(join(f.dir, "retired.json"), "utf8")).retired[0]).toMatchObject({
      id: "meal-planner",
      category: "food",
      generated: "2026-10-28",
    });
    // The install count survives the rebuild.
    expect(index.bots.find((b) => b.id === "used-ai")).toMatchObject({ installs: 1 });

    const page = await f.request("/bots/meal-planner");
    expect(page.status).toBe(410);
    expect(page.text).toContain("Meal Planner was retired");
    expect(page.text).toContain("A copy you already added keeps working.");
    const api = await f.request("/api/bots/meal-planner");
    expect(api.status).toBe(410);
    expect(api.body.retired.id).toBe("meal-planner");
    expect((await f.request("/api/retired")).body.retired.map((r: { id: string }) => r.id)).toEqual([
      "meal-planner",
    ]);
    expect((await f.request("/api/bots?q=dinners")).body.total).toBe(0);
  });

  it("reports a thinned category when top-up is off, on the review page", async () => {
    const thin = await makeFixture({
      config: { retirement: { days: 90, hour: 3, floor: 3, regenerate: false } },
    });
    try {
      const run = await thin.server.retirement.run(NOW);
      expect(run.thinned).toEqual([{ category: "food", live: 0, floor: 3, need: 3 }]);
      expect(run.problem).toBeUndefined();
      const page = await thin.request("/admin", { session: thin.signIn("rev", 900) });
      expect(page.text).toContain("1 bot retired");
      expect(page.text).toContain("Thinned: food (0 of 3)");
      expect(page.text).toContain("top-up is off");
    } finally {
      await thin.close();
    }
  });

  it("says so when top-up is on but there is no model key", async () => {
    const regen = await makeFixture({
      config: { retirement: { days: 90, hour: 3, floor: 3, regenerate: true } },
    });
    try {
      const saved = {
        NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
        STEWARD_SEED_BASE_URL: process.env.STEWARD_SEED_BASE_URL,
      };
      delete process.env.NVIDIA_API_KEY;
      delete process.env.STEWARD_SEED_BASE_URL;
      try {
        const run = await regen.server.retirement.run(NOW);
        expect(run.problem).toContain("no model key");
      } finally {
        Object.assign(
          process.env,
          Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)),
        );
      }
    } finally {
      await regen.close();
    }
  });

  it("lets a reviewer run it now, and nobody else", async () => {
    expect(
      (await f.request("/api/admin/retire", { method: "POST", session: f.signIn("ana", 101) })).status,
    ).toBe(403);
    const res = await f.request("/api/admin/retire", { method: "POST", session: f.signIn("rev", 900) });
    expect(res.status).toBe(200);
    expect(res.body.run.day).toBe(new Date().toISOString().slice(0, 10));
  });
});
