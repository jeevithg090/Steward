import { createHash } from "node:crypto";
import { type BotPack, BotPackSchema } from "@steward/shared";

/**
 * The content hash a pack carries (plan §5, provenance). The same pack always gives the same hash,
 * whatever order its keys were written in and whether optional lists were left out or empty: the
 * pack is run through the schema first, so defaults are filled, then keys are sorted at every depth.
 * Arrays keep their order, because order means something in starters and rules.
 */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = sortKeys(item);
    }
    return out;
  }
  return value;
}

/** Stable JSON for a pack, with `hash` left out. Throws when the pack does not fit the schema. */
export function canonicalPack(pack: BotPack): string {
  const { hash: _hash, ...rest } = BotPackSchema.parse(pack);
  return JSON.stringify(sortKeys(rest));
}

/** sha256 of `canonicalPack`, as hex. */
export function hashPack(pack: BotPack): string {
  return createHash("sha256").update(canonicalPack(pack), "utf8").digest("hex");
}
