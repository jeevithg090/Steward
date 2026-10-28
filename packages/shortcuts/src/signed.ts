import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The files that ship signed with each release (`pnpm --filter @steward/shortcuts sign:release`):
 * the generic Steward shortcut and the launchers with nothing personal in them, signed for anyone
 * by a maintainer on a Mac. A host that cannot sign (Linux, CI) serves these.
 */
export const SIGNED_DIR = fileURLToPath(new URL("../signed/", import.meta.url));

export interface SignedManifest {
  version: number;
  signedAt: string;
  mode: "anyone";
  files: Record<string, { sha256: string; bytes: number; actions: number }>;
}

/** A shipped signed file by name (`Steward.shortcut`, `launchers/brief.shortcut`), or undefined. */
export function readSigned(name: string): Uint8Array | undefined {
  if (!/^(launchers\/)?[A-Za-z0-9 ._-]+\.shortcut$/.test(name)) return undefined;
  const path = `${SIGNED_DIR}${name}`;
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
}
