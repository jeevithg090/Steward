// Adapted from happy-agent-runtime packages/happy-agent-modules/sources/happy/crypto/happyEncryption.ts
// (slopus/happy-agent, MIT, Copyright (c) 2026 rig Contributors) and the sealed-box helpers in
// happy/packages/happy-app/sources/encryption/libsodium.ts (slopus/happy, MIT, Copyright (c) 2024
// Happy Coder Contributors).
/**
 * The formats on the wire, all carried as base64:
 *
 * - **Payload:** `0x00 | nonce(12) | AES-256-GCM(JSON) | tag(16)`. WebCrypto, so the server and the
 *   phone share one module; the key may be a non-extractable `CryptoKey` on the phone.
 * - **Sealed box:** `ephemeralPublic(32) | nonce(24) | box(data)`, to a recipient's X25519 key.
 * - **Wrapped data key:** `0x00 | sealed box`, the version byte kept from Happy.
 */
import { concat, fromUtf8, randomBytes, utf8 } from "./bytes.ts";
import {
  BOX_PUBLIC_KEY_BYTES,
  type BoxSecret,
  boxKeyPairFromSecretKey,
  boxOpen,
  boxSeal,
  NONCE_BYTES,
} from "./nacl.ts";

const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const PAYLOAD_OVERHEAD = 1 + GCM_NONCE_BYTES + GCM_TAG_BYTES;

export type DataKey = Uint8Array | CryptoKey;

async function aesKey(key: DataKey, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (!(key instanceof Uint8Array)) return key;
  if (key.length !== 32) throw new Error("A data key is 32 bytes.");
  return crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-GCM" }, false, [usage]);
}

/** Imports a data key the phone can use but never read back (non-extractable). */
export function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptPayload(
  key: DataKey,
  value: unknown,
  nonce: Uint8Array = randomBytes(GCM_NONCE_BYTES),
): Promise<Uint8Array> {
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, tagLength: 128 },
    await aesKey(key, "encrypt"),
    utf8(JSON.stringify(value)) as BufferSource,
  );
  return concat(new Uint8Array([0]), nonce, new Uint8Array(sealed));
}

/** The value inside, or undefined for anything that does not open cleanly. */
export async function decryptPayload<T = unknown>(key: DataKey, bundle: Uint8Array): Promise<T | undefined> {
  try {
    if (bundle[0] !== 0 || bundle.length < PAYLOAD_OVERHEAD) return undefined;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bundle.slice(1, 1 + GCM_NONCE_BYTES) as BufferSource, tagLength: 128 },
      await aesKey(key, "decrypt"),
      bundle.slice(1 + GCM_NONCE_BYTES) as BufferSource,
    );
    return JSON.parse(fromUtf8(new Uint8Array(plain))) as T;
  } catch {
    return undefined;
  }
}

/** Seals bytes to a recipient's public key with a fresh ephemeral key: only the recipient opens it. */
export async function sealBox(data: Uint8Array, recipientPublicKey: Uint8Array): Promise<Uint8Array> {
  const ephemeral = boxKeyPairFromSecretKey(randomBytes(32));
  const nonce = randomBytes(NONCE_BYTES);
  const box = await boxSeal(data, nonce, recipientPublicKey, ephemeral.secretKey);
  return concat(ephemeral.publicKey, nonce, box);
}

export async function openBox(
  bundle: Uint8Array,
  recipientSecret: BoxSecret,
): Promise<Uint8Array | undefined> {
  if (bundle.length < BOX_PUBLIC_KEY_BYTES + NONCE_BYTES) return undefined;
  return boxOpen(
    bundle.slice(BOX_PUBLIC_KEY_BYTES + NONCE_BYTES),
    bundle.slice(BOX_PUBLIC_KEY_BYTES, BOX_PUBLIC_KEY_BYTES + NONCE_BYTES),
    bundle.slice(0, BOX_PUBLIC_KEY_BYTES),
    recipientSecret,
  );
}

/** A data key sealed to a device: `0x00 | sealed box`. */
export async function wrapDataKey(dataKey: Uint8Array, recipientPublicKey: Uint8Array): Promise<Uint8Array> {
  return concat(new Uint8Array([0]), await sealBox(dataKey, recipientPublicKey));
}

export async function unwrapDataKey(
  bundle: Uint8Array,
  recipientSecret: BoxSecret,
): Promise<Uint8Array | undefined> {
  if (bundle[0] !== 0) return undefined;
  const key = await openBox(bundle.slice(1), recipientSecret);
  return key?.length === 32 ? key : undefined;
}

/** JSON sealed to a public key, for the pairing hello. */
export async function sealJson(value: unknown, recipientPublicKey: Uint8Array): Promise<Uint8Array> {
  return sealBox(utf8(JSON.stringify(value)), recipientPublicKey);
}

export async function openJson<T>(bundle: Uint8Array, recipientSecret: BoxSecret): Promise<T | undefined> {
  const bytes = await openBox(bundle, recipientSecret);
  if (!bytes) return undefined;
  try {
    return JSON.parse(fromUtf8(bytes)) as T;
  } catch {
    return undefined;
  }
}
