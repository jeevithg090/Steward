import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { type BotPack, type DirectoryIndex, TOOLS } from "@steward/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { hashPack } from "../src/canonical.ts";
import { DirectoryIndexSchema } from "../src/directory.ts";
import { parseBotFolder } from "../src/pack.ts";
import { validatePack } from "../src/validate.ts";

/**
 * The directory the repository ships (`directory/`) is what every Steward reads by default. This
 * checks that what was committed is what `seed build` would write: every bot folder passes, its
 * built pack carries the same content, and the index lists exactly those bots. A pack edited by
 * hand, or a folder changed without a rebuild, fails here.
 */

const DIRECTORY = resolve(import.meta.dirname, "../../../directory");
const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);
const ctx = { tools: Object.keys(TOOLS), validateRule: (when: string) => engine.validate(when) };

let folders: string[];
let packFiles: string[];
let index: DirectoryIndex;
const parsed = new Map<string, BotPack>();

beforeAll(async () => {
  folders = readdirSync(join(DIRECTORY, "bots"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  packFiles = readdirSync(join(DIRECTORY, "packs"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
  index = DirectoryIndexSchema.parse(
    JSON.parse(readFileSync(join(DIRECTORY, "index.json"), "utf8")),
  ) as DirectoryIndex;
  for (const folder of folders) parsed.set(folder, await parseBotFolder(join(DIRECTORY, "bots", folder)));
});

describe("the shipped directory", () => {
  it("lists exactly the bot folders, each with one built pack", () => {
    expect(folders.length).toBeGreaterThan(0);
    expect(index.bots.map((b) => b.id).sort()).toEqual(folders);
    expect(packFiles).toEqual(folders);
  });

  it("has every bot folder pass validation, with its id as its folder name", () => {
    const failing: string[] = [];
    for (const [folder, pack] of parsed) {
      if (pack.id !== folder) failing.push(`${folder}: id is "${pack.id}"`);
      const result = validatePack(pack, ctx);
      for (const p of result.problems.filter((p) => p.severity === "error"))
        failing.push(`${folder}: ${p.path}: ${p.message}`);
    }
    expect(failing).toEqual([]);
  });

  it("built each pack from its folder as it is now", () => {
    const stale: string[] = [];
    for (const [folder, pack] of parsed) {
      const built = JSON.parse(readFileSync(join(DIRECTORY, "packs", `${folder}.json`), "utf8")) as BotPack;
      const hash = hashPack(pack);
      if (built.hash !== hash || hashPack(built) !== hash) stale.push(folder);
    }
    expect(stale).toEqual([]);
  });

  it("lists each bot as its pack describes it", () => {
    const wrong: string[] = [];
    for (const listing of index.bots) {
      const pack = parsed.get(listing.id);
      if (!pack) continue;
      const fields = ["name", "pitch", "category", "version"] as const;
      for (const field of fields) if (listing[field] !== pack[field]) wrong.push(`${listing.id}: ${field}`);
      if (JSON.stringify(listing.author) !== JSON.stringify(pack.author)) wrong.push(`${listing.id}: author`);
      if (JSON.stringify(listing.needs) !== JSON.stringify(pack.needs)) wrong.push(`${listing.id}: needs`);
      if (listing.packUrl !== `packs/${listing.id}.json`) wrong.push(`${listing.id}: packUrl`);
      if (Number.isNaN(Date.parse(listing.updatedAt))) wrong.push(`${listing.id}: updatedAt`);
    }
    expect(wrong).toEqual([]);
  });
});
