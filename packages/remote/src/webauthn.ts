import { concat, equalBytes, fromBase64, fromUtf8, sha256, toBase64Url, utf8 } from "./bytes.ts";

/**
 * Checks a WebAuthn assertion the phone made before signing a risky answer (docs/plans/
 * phone-and-shortcuts.md §5.4): its challenge is SHA-256 of the signed answer, so the Face ID check
 * belongs to that answer and no other. Only ES256 credentials are accepted.
 */

/** The challenge for an answer: SHA-256 of the exact message the phone signs. */
export async function challengeFor(message: string): Promise<Uint8Array> {
  return sha256(utf8(message));
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` → 64-byte `r || s` for WebCrypto. */
export function derToP1363(der: Uint8Array): Uint8Array {
  let i = 0;
  const expect = (byte: number) => {
    if (der[i++] !== byte) throw new Error("Not a DER ECDSA signature.");
  };
  const length = () => {
    let len = der[i++]!;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | der[i++]!;
    }
    return len;
  };
  expect(0x30);
  length();
  const int = () => {
    expect(0x02);
    const len = length();
    let bytes = der.slice(i, i + len);
    i += len;
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.length > 32) throw new Error("ECDSA integer too long.");
    return concat(new Uint8Array(32 - bytes.length), bytes);
  };
  return concat(int(), int());
}

export interface AssertionCheck {
  /** The credential's public key, SPKI, base64 (from `getPublicKey()` at registration). */
  publicKey: string;
  rpId: string;
  origin: string;
  challenge: Uint8Array;
  authenticatorData: string;
  clientDataJSON: string;
  /** DER, base64, as the authenticator returns it. */
  signature: string;
}

const UP = 0x01;
const UV = 0x04;

/** True when the assertion is for this challenge, this site, with the person checked (UV). */
export async function verifyAssertion(check: AssertionCheck): Promise<boolean> {
  try {
    const authData = fromBase64(check.authenticatorData);
    const clientBytes = fromBase64(check.clientDataJSON);
    const client = JSON.parse(fromUtf8(clientBytes)) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };
    if (client.type !== "webauthn.get") return false;
    if (client.challenge !== toBase64Url(check.challenge)) return false;
    if (client.origin !== check.origin) return false;
    if (authData.length < 37) return false;
    if (!equalBytes(authData.slice(0, 32), await sha256(utf8(check.rpId)))) return false;
    const flags = authData[32]!;
    if ((flags & UP) === 0 || (flags & UV) === 0) return false;
    const key = await crypto.subtle.importKey(
      "spki",
      fromBase64(check.publicKey) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signed = concat(authData, await sha256(clientBytes));
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToP1363(fromBase64(check.signature)) as BufferSource,
      signed as BufferSource,
    );
  } catch {
    return false;
  }
}
