import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotListing, BotPack, DirectoryIndex } from "@steward/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndex } from "../src/directory.ts";
import { writeBotFolder } from "../src/pack.ts";

/**
 * `updatedAt` says when a bot's content last changed, so a clone, a checkout or a reformat (which
 * touch every file) must not move it, and a rebuild with nothing changed must write nothing.
 */

function pack(id: string, extra: Partial<BotPack> = {}): BotPack {
  return {
    id,
    name: id,
    pitch: "A bot.",
    category: "misc",
    version: 1,
    author: { kind: "person", handle: "sam" },
    licence: "MIT",
    needs: { tools: ["web_search"], connectors: [], model: "any" },
    instructions: "Help the person.",
    starters: [],
    examples: [],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme: "",
    ...extra,
  };
}

function touch(dir: string, date: Date): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) touch(path, date);
    else utimesSync(path, date, date);
  }
}

const readIndex = (root: string) =>
  JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as DirectoryIndex;
const dateOf = (root: string, id: string) =>
  readIndex(root).bots.find((b: BotListing) => b.id === id)?.updatedAt;

let root: string;
let warnings: string[];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "steward-build-"));
  await writeBotFolder(join(root, "bots", "rent-scout"), pack("rent-scout"));
  await writeBotFolder(
    join(root, "bots", "meal-planner"),
    pack("meal-planner", { author: { kind: "ai", model: "test/model", generated: "2026-10-28" } }),
  );
  touch(join(root, "bots", "rent-scout"), new Date("2026-01-05T00:00:00Z"));
  touch(join(root, "bots", "meal-planner"), new Date("2026-11-02T09:00:00Z"));
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const at = (iso: string) => () => new Date(iso);

describe("buildIndex dates", () => {
  it("dates a new bot by its generated day when AI-made, else by its files", async () => {
    await buildIndex(root, { now: at("2026-11-10T12:00:00Z") });
    expect(dateOf(root, "meal-planner")).toBe("2026-10-28T00:00:00.000Z");
    expect(dateOf(root, "rent-scout")).toBe("2026-01-05T00:00:00.000Z");
    expect(readIndex(root).generatedAt).toBe("2026-11-10T12:00:00.000Z");
  });

  it("keeps every date when the files were touched but nothing changed, and writes nothing", async () => {
    await buildIndex(root, { now: at("2026-11-10T12:00:00Z") });
    const index = readFileSync(join(root, "index.json"), "utf8");
    const packMtime = statSync(join(root, "packs", "rent-scout.json")).mtimeMs;
    // A fresh clone: every file is new on disk.
    touch(join(root, "bots"), new Date("2026-12-01T00:00:00Z"));
    await buildIndex(root, { now: at("2026-12-01T08:00:00Z") });
    expect(readFileSync(join(root, "index.json"), "utf8")).toBe(index);
    expect(statSync(join(root, "packs", "rent-scout.json")).mtimeMs).toBe(packMtime);
    expect(dateOf(root, "rent-scout")).toBe("2026-01-05T00:00:00.000Z");
    expect(readIndex(root).generatedAt).toBe("2026-11-10T12:00:00.000Z");
  });

  it("moves a bot's date to the build when its content changed, and only that bot's", async () => {
    await buildIndex(root, { now: at("2026-11-10T12:00:00Z") });
    await writeBotFolder(
      join(root, "bots", "rent-scout"),
      pack("rent-scout", { version: 2, pitch: "Better." }),
    );
    touch(join(root, "bots", "rent-scout"), new Date("2026-01-05T00:00:00Z"));
    await buildIndex(root, { now: at("2026-12-01T08:00:00Z") });
    expect(dateOf(root, "rent-scout")).toBe("2026-12-01T08:00:00.000Z");
    expect(dateOf(root, "meal-planner")).toBe("2026-10-28T00:00:00.000Z");
    expect(readIndex(root).generatedAt).toBe("2026-12-01T08:00:00.000Z");
  });

  it("never dates a bot after the build", async () => {
    await writeBotFolder(
      join(root, "bots", "future"),
      pack("future", { author: { kind: "ai", model: "test/model", generated: "2027-05-01" } }),
    );
    await buildIndex(root, { now: at("2026-11-10T12:00:00Z") });
    expect(dateOf(root, "future")).toBe("2026-11-10T12:00:00.000Z");
  });
});

describe("buildIndex stale packs", () => {
  it("removes the pack of a folder that is gone or no longer passes", async () => {
    await writeBotFolder(join(root, "bots", "inbox-zero"), pack("inbox-zero"));
    await buildIndex(root);
    expect(existsSync(join(root, "packs", "rent-scout.json"))).toBe(true);
    expect(existsSync(join(root, "packs", "inbox-zero.json"))).toBe(true);

    rmSync(join(root, "bots", "rent-scout"), { recursive: true });
    // Now asks for a tool Steward does not have, so it fails validation.
    await writeBotFolder(
      join(root, "bots", "inbox-zero"),
      pack("inbox-zero", { needs: { tools: ["teleport"], connectors: [], model: "any" } }),
    );
    await buildIndex(root);
    expect(readIndex(root).bots.map((b: BotListing) => b.id)).toEqual(["meal-planner"]);
    expect(existsSync(join(root, "packs", "rent-scout.json"))).toBe(false);
    expect(existsSync(join(root, "packs", "inbox-zero.json"))).toBe(false);
    expect(existsSync(join(root, "packs", "meal-planner.json"))).toBe(true);
    expect(warnings).toContain("packs/rent-scout.json: removed: no bot folder passes for it");
  });
});
