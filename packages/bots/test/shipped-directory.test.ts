import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { type BotPack, type DirectoryIndex, TOOLS } from "@steward/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { hashPack } from "../src/canonical.ts";
import { buildIndex, DirectoryIndexSchema } from "../src/directory.ts";
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

  it("is exactly what a build writes: rebuilding a copy changes no file", async () => {
    const copy = mkdtempSync(join(tmpdir(), "steward-shipped-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const entry of ["bots", "packs", "index.json", "categories.yaml", "counts.json"]) {
        if (existsSync(join(DIRECTORY, entry)))
          cpSync(join(DIRECTORY, entry), join(copy, entry), { recursive: true });
      }
      // A far-off clock: a bot whose content changed since the last build would take its date.
      await buildIndex(copy, {
        name: index.name,
        ...(index.site ? { site: index.site } : {}),
        now: () => new Date("2100-01-01T00:00:00Z"),
      });
      const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
      const shipped = new Map(index.bots.map((b) => [b.id, JSON.stringify(b)]));
      const rebuilt = DirectoryIndexSchema.parse(JSON.parse(read(copy, "index.json"))) as DirectoryIndex;
      const differ = rebuilt.bots.filter((b) => shipped.get(b.id) !== JSON.stringify(b)).map((b) => b.id);
      expect(differ, "listings that differ from a fresh build").toEqual([]);
      expect(readdirSync(join(copy, "packs")).sort()).toEqual(packFiles.map((id) => `${id}.json`).sort());
      const packs = packFiles.filter(
        (id) => read(copy, `packs/${id}.json`) !== read(DIRECTORY, `packs/${id}.json`),
      );
      expect(packs, "packs that differ from a fresh build").toEqual([]);
      expect(read(copy, "index.json") === read(DIRECTORY, "index.json"), "index.json is byte for byte").toBe(
        true,
      );
    } finally {
      warn.mockRestore();
      rmSync(copy, { recursive: true, force: true });
    }
  }, 120_000);
});
