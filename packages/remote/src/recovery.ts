// Adapted from happy/packages/happy-app/sources/auth/secretKeyBackup.ts (slopus/happy, MIT,
// Copyright (c) 2024 Happy Coder Contributors).
/**
 * A 32-byte key as something a person can write down: RFC 4648 base32 in groups of five,
 * `XXXXX-XXXXX-…`. Reading it back forgives case, spaces, dashes, and 0/O, 1/I, 8/B mix-ups.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 0x1f];
  return out;
}

function fromBase32(text: string): Uint8Array {
  const cleaned = text
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/8/g, "B")
    .replace(/9/g, "G")
    .replace(/[^A-Z2-7]/g, "");
  if (!cleaned) throw new Error("There are no key letters in that.");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of cleaned) {
    buffer = (buffer << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function formatRecoveryKey(key: Uint8Array): string {
  if (key.length !== 32) throw new Error("A recovery key is 32 bytes.");
  return (toBase32(key).match(/.{1,5}/g) ?? []).join("-");
}

export function parseRecoveryKey(text: string): Uint8Array {
  const key = fromBase32(text);
  if (key.length !== 32) throw new Error(`That key is ${key.length} bytes long; a recovery key is 32.`);
  return key;
}
