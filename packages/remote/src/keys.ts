// Adapted from happy/packages/happy-app/sources/encryption/deriveKey.ts (slopus/happy, MIT,
// Copyright (c) 2024 Happy Coder Contributors).
/**
 * A BIP32-style key tree with string indices: root `I = HMAC-SHA512(usage + " Master Seed", seed)`,
 * key `I[0:32]`, chain code `I[32:]`; each child is `HMAC-SHA512(chain, 0x00 || utf8(index))`.
 * WebCrypto HMAC, so it runs in Node and the browser.
 *
 * Usage strings are Steward's own (`Steward …`), so no key is ever shared with a Happy key domain.
 */
import { concat, utf8 } from "./bytes.ts";

export interface KeyTreeState {
  key: Uint8Array;
  chainCode: Uint8Array;
}

/** Every usage string Steward derives with. */
export const STEWARD_USAGE = {
  /** The key that seals a device's event log and replies (per device). */
  data: "Steward Data",
  /** The key that seals notification bodies. */
  push: "Steward Push",
} as const;

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

export async function deriveSecretKeyTreeRoot(seed: Uint8Array, usage: string): Promise<KeyTreeState> {
  const I = await hmacSha512(utf8(`${usage} Master Seed`), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

export async function deriveSecretKeyTreeChild(chainCode: Uint8Array, index: string): Promise<KeyTreeState> {
  const I = await hmacSha512(chainCode, concat(new Uint8Array([0]), utf8(index)));
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

export async function deriveKey(
  master: Uint8Array,
  usage: string,
  path: readonly string[],
): Promise<Uint8Array> {
  let state = await deriveSecretKeyTreeRoot(master, usage);
  for (const index of path) state = await deriveSecretKeyTreeChild(state.chainCode, index);
  return state.key;
}
