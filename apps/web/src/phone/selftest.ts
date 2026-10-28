/**
 * The shared crypto vectors, run in this browser (e2e loads this module in Chromium). The Node unit
 * tests run the same ones against the same expected bytes, so the two runtimes must agree. It also
 * does what pairing does with a non-extractable WebCrypto X25519 key.
 */
import { fromBase64, openJson, runVectors, sealJson, VECTORS_EXPECTED } from "@steward/remote";

export async function run() {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sealed = await sealJson({ hello: "phone" }, publicKey);
  const opened = await openJson<{ hello: string }>(sealed, pair.privateKey);
  let readable = true;
  try {
    await crypto.subtle.exportKey("jwk", pair.privateKey);
  } catch {
    readable = false;
  }
  return {
    results: await runVectors(),
    expected: VECTORS_EXPECTED,
    nonExtractableOpens: opened?.hello === "phone",
    privateKeyReadable: readable,
    base64: Array.from(fromBase64("AAEC")),
  };
}
