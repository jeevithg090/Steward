// Adapted from happy-agent-runtime packages/happy-agent-modules/sources/happy/crypto/nobleNaCl.ts
// (slopus/happy-agent, MIT, Copyright (c) 2026 rig Contributors).
/**
 * NaCl box and secretbox on `@noble`, so one module runs in Node and in the browser. Byte for byte
 * the same as TweetNaCl and libsodium (`crypto_box_easy`, `crypto_secretbox_easy`); the tests check
 * it against TweetNaCl.
 *
 * Steward's addition: the X25519 secret may be a non-extractable WebCrypto key (the phone's own
 * device key, kept in IndexedDB), so the shared secret comes from `subtle.deriveBits`.
 */
import { hsalsa, secretbox } from "@noble/ciphers/salsa.js";
import { u8, u32 } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";

export const BOX_PUBLIC_KEY_BYTES = 32;
export const BOX_SECRET_KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const SECRETBOX_OVERHEAD_BYTES = 16;

export interface BoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** A box secret: raw bytes, or a WebCrypto X25519 private key that never leaves the device. */
export type BoxSecret = Uint8Array | CryptoKey;

const SIGMA = u32(new TextEncoder().encode("expand 32-byte k"));
const ZERO_HSALSA_INPUT = new Uint32Array(4);

export function boxKeyPairFromSecretKey(secretKey: Uint8Array): BoxKeyPair {
  assertLength(secretKey, BOX_SECRET_KEY_BYTES, "X25519 secret key");
  const owned = secretKey.slice();
  return { publicKey: x25519.getPublicKey(owned), secretKey: owned };
}

export function secretBoxSeal(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  return secretbox(key, nonce).seal(plaintext);
}

export function secretBoxOpen(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Uint8Array | undefined {
  try {
    return secretbox(key, nonce).open(ciphertext);
  } catch {
    return undefined;
  }
}

/** `crypto_box_beforenm`: HSalsa20 of the X25519 shared secret. */
export function boxKeyFromShared(sharedSecret: Uint8Array): Uint8Array {
  const output = new Uint32Array(8);
  hsalsa(SIGMA, u32(sharedSecret), ZERO_HSALSA_INPUT, output);
  return u8(output).slice();
}

/** The box key between a public key and a secret, raw or WebCrypto. */
export async function boxKey(publicKey: Uint8Array, secret: BoxSecret): Promise<Uint8Array> {
  assertLength(publicKey, BOX_PUBLIC_KEY_BYTES, "X25519 public key");
  if (secret instanceof Uint8Array) {
    assertLength(secret, BOX_SECRET_KEY_BYTES, "X25519 secret key");
    return boxKeyFromShared(x25519.getSharedSecret(secret, publicKey));
  }
  const peer = await crypto.subtle.importKey("raw", publicKey as BufferSource, { name: "X25519" }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: "X25519", public: peer }, secret, 256);
  return boxKeyFromShared(new Uint8Array(bits));
}

export async function boxSeal(
  plaintext: Uint8Array,
  nonce: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderSecret: BoxSecret,
): Promise<Uint8Array> {
  return secretBoxSeal(plaintext, nonce, await boxKey(recipientPublicKey, senderSecret));
}

export async function boxOpen(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientSecret: BoxSecret,
): Promise<Uint8Array | undefined> {
  try {
    return secretBoxOpen(ciphertext, nonce, await boxKey(senderPublicKey, recipientSecret));
  } catch {
    return undefined;
  }
}

function assertLength(value: Uint8Array, length: number, label: string): void {
  if (value.byteLength !== length)
    throw new Error(`The ${label} must contain exactly ${String(length)} bytes.`);
}
