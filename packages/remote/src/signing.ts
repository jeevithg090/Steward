import { fromBase64, toBase64, utf8 } from "./bytes.ts";

/**
 * A phone's signing key: ECDSA P-256 in WebCrypto. On the phone the private key is made
 * non-extractable and kept in IndexedDB, so not even the app's own script can read it back.
 * Signatures are IEEE P1363 (`r || s`), as WebCrypto makes them.
 */
const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

export async function generateSigningKey(extractable = false): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALG, extractable, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey("spki", key)));
}

export async function signText(privateKey: CryptoKey, text: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.sign(SIGN, privateKey, utf8(text) as BufferSource)));
}

/** True only for a valid signature by this public key (SPKI, base64). Never throws. */
export async function verifyText(publicKeySpki: string, text: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", fromBase64(publicKeySpki) as BufferSource, ALG, false, [
      "verify",
    ]);
    return await crypto.subtle.verify(
      SIGN,
      key,
      fromBase64(signature) as BufferSource,
      utf8(text) as BufferSource,
    );
  } catch {
    return false;
  }
}
