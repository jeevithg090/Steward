import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import type { BotPack } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { zipEntries, zipPack } from "../src/archive.ts";
import { packFiles, parseBotFolder } from "../src/pack.ts";

const PACK: BotPack = {
  id: "chore-chart",
  name: "Chore Chart",
  pitch: "Shares out the week's chores fairly.",
  category: "home",
  version: 1,
  author: { kind: "ai", model: "test/model", generated: "2026-10-28" },
  licence: "MIT",
  needs: { tools: ["make_page"], connectors: [], model: "any" },
  instructions: "Help one household share out its chores. Say what you could not check.",
  starters: ["Make a chore chart for three people."],
  examples: [],
  skills: [
    {
      name: "split-chores",
      description: "Splits chores fairly.",
      body: "Count them. Share them out. Ünïcode is fine.",
    },
  ],
  rules: [],
  routines: [],
  shortcuts: [],
  readme: "# Chore Chart\n\nShares out the chores.",
};

/** Reads a stored zip back: every entry's name and text, checking each CRC on the way. */
function readZip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, string> = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(crc32(data) >>> 0).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    at += 30 + nameLength + size;
  }
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  return out;
}

describe("zipPack", () => {
  it("holds the pack folder under its id, as the directory reads it", () => {
    const files = readZip(zipPack(PACK));
    expect(Object.keys(files)).toEqual([
      "chore-chart/bot.yaml",
      "chore-chart/README.md",
      "chore-chart/skills/split-chores/SKILL.md",
    ]);
    for (const f of packFiles(PACK)) expect(files[`chore-chart/${f.path}`]).toBe(f.text);
    expect(files["chore-chart/skills/split-chores/SKILL.md"]).toContain("Ünïcode");
  });

  it("gives the same bytes for the same pack", () => {
    expect(Buffer.from(zipPack(PACK)).equals(Buffer.from(zipPack(PACK)))).toBe(true);
  });

  it("opens with the system unzip and parses back to the same pack", async () => {
    let hasUnzip = true;
    try {
      execFileSync("unzip", ["-v"], { stdio: "ignore" });
    } catch {
      hasUnzip = false;
    }
    if (!hasUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), "steward-zip-"));
    try {
      writeFileSync(join(dir, "pack.zip"), zipPack(PACK));
      execFileSync("unzip", ["-q", "pack.zip"], { cwd: dir });
      const back = await parseBotFolder(join(dir, "chore-chart"));
      expect(back).toEqual(PACK);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes an empty archive that is still valid", () => {
    const empty = zipEntries([]);
    expect(empty.length).toBe(22);
    expect(new DataView(empty.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});
