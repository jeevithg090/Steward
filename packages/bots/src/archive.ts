import { crc32 } from "node:zlib";
import type { BotPack } from "@steward/shared";
import { packFiles } from "./pack.ts";

/**
 * A pack folder as a `.zip`, for "Submit to the directory": unzip it into a public repository and
 * paste the address on the directory's submit page. Files are stored, not compressed: a pack is a
 * few kilobytes, and stored entries open in every unzip tool.
 */

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

/** 1 Jan 2026 in MS-DOS time, so the same pack always gives the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function zipEntries(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data) >>> 0;
    const size = entry.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // made by
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, DOS_TIME, true);
    central.setUint16(14, DOS_DATE, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, entry.data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + size;
  }
  const centralSize = centrals.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `<id>/bot.yaml`, `<id>/README.md`, `<id>/skills/<name>/SKILL.md`: the layout the directory reads. */
export function zipPack(pack: BotPack): Uint8Array {
  return zipEntries(
    packFiles(pack).map((f) => ({ path: `${pack.id}/${f.path}`, data: encoder.encode(f.text) })),
  );
}
