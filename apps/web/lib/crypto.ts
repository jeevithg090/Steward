// The person's key, K_user, lives on their device (spec §18, build plan S8.3). Tempo's servers
// hold only ciphertext and data keys wrapped by K_user; this file is where K_user comes from.
//
// - With a passkey that supports the WebAuthn PRF extension, K_user is derived from it, so it
//   is rebuilt by Face ID on any device holding that passkey.
// - Otherwise K_user is 32 random bytes, stored only wrapped by a non-extractable WebCrypto key
//   that the browser keeps (the raw wrapping key can't be read back out, even by this code).

export interface WrappedKey {
  wrappingKey: CryptoKey; // non-extractable, stored as a CryptoKey (structured clone)
  iv: Uint8Array;
  wrapped: ArrayBuffer;
}

export interface KeyStore {
  load(): Promise<WrappedKey | null>;
  save(value: WrappedKey): Promise<void>;
}

const subtle = () => globalThis.crypto.subtle;

/** K_user for this device: unwrap the stored one, or make and store a new one. */
export async function deviceUserKey(store: KeyStore): Promise<Uint8Array> {
  const found = await store.load();
  if (found) {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: found.iv as BufferSource }, found.wrappingKey, found.wrapped));
  }
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const wrappingKey = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, wrappingKey, key as BufferSource);
  await store.save({ wrappingKey, iv, wrapped });
  return key;
}

/** The PRF extension input: the same salt on every device gives the same K_user. */
export const PRF_SALT = new TextEncoder().encode("tempo K_user v1");

/** K_user from a passkey's PRF output (HKDF-SHA256), or null if the authenticator has no PRF. */
export async function prfUserKey(credential: { getClientExtensionResults(): AuthenticationExtensionsClientOutputs }): Promise<Uint8Array | null> {
  const prf = (credential.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } }).prf;
  const first = prf?.results?.first;
  if (!first) return null;
  const material = await subtle().importKey("raw", first, "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: PRF_SALT as BufferSource }, material, 256,
  );
  return new Uint8Array(bits);
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The printable recovery code, in the same format as tempo_crypto.envelope.recovery_code. */
export function recoveryCode(key: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of key) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

/** IndexedDB in the browser; tests pass an in-memory KeyStore. */
export function indexedDbKeyStore(name = "tempo-keys"): KeyStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = <T,>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>) =>
    open().then((db) => new Promise<T>((resolve, reject) => {
      const request = work(db.transaction("keys", mode).objectStore("keys"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  return {
    load: () => run<WrappedKey | undefined>("readonly", (s) => s.get("k_user")).then((v) => v ?? null),
    save: (value) => run("readwrite", (s) => s.put(value, "k_user")).then(() => undefined),
  };
}
