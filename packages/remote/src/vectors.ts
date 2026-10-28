/**
 * Fixed vectors, run in Node by vitest and in Chromium by the phone app's self-test (e2e), so the
 * same bytes come out of both runtimes. Exported from the package so the browser build can run it.
 */
import {
  boxKey,
  boxKeyPairFromSecretKey,
  decryptPayload,
  deriveKey,
  encryptPayload,
  formatRecoveryKey,
  fromHex,
  secretBoxSeal,
  toHex,
} from "./index.ts";

/** RFC 7748 §6.1: Alice and Bob. */
export const RFC7748 = {
  aliceSecret: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
  alicePublic: "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
  bobSecret: "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
  bobPublic: "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
};

/** NaCl's `crypto_box_beforenm` for those keys (the "firstkey" of NaCl's own tests). */
export const NACL_BEFORENM = "1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389";

/** Happy's key tree vector (happy-app/sources/encryption/deriveKey.appspec.ts). */
export const KEY_TREE = {
  seed: "test seed",
  usage: "test usage",
  path: ["child1", "child2"],
  finalKey: "1011C097D2105D27362B987A631496BBF68B836124D1D072E9D1613C6028CF75",
};

/** A pinned AES-GCM payload: key 0x00..0x1f, nonce 0x00..0x0b, value {"hello":"steward"}. */
export const PAYLOAD = {
  key: Array.from({ length: 32 }, (_, i) => i),
  nonce: Array.from({ length: 12 }, (_, i) => i),
  value: { hello: "steward" },
};

export interface VectorResults {
  alicePublic: string;
  beforenm: string;
  secretbox: string;
  keyTree: string;
  payload: string;
  payloadOpens: boolean;
  recovery: string;
}

/**
 * What every runtime must produce. The first two are RFC 7748 and NaCl; the key tree is Happy's;
 * secretbox is checked against TweetNaCl in the unit tests; the payload and recovery key are pinned.
 */
export const EXPECTED: VectorResults = {
  alicePublic: RFC7748.alicePublic,
  beforenm: NACL_BEFORENM,
  secretbox: "3720f711fd306bddaf7d554939cd3f8075a4471009b17a",
  keyTree: KEY_TREE.finalKey,
  payload: "00000102030405060708090a0b3c20be7ea989ad39b763e4ffd49e191fe7f4fad93b2bf72600d736b96d713189c2b27d",
  payloadOpens: true,
  recovery: "AAAQE-AYEAU-DAOCA-JBIFQ-YDIOB-4IBCE-QTCQK-RMFYY-DENBW-HA5DY-PQ",
};

/** Runs every vector and returns hex, so two runtimes can be compared byte for byte. */
export async function runVectors(): Promise<VectorResults> {
  const alice = boxKeyPairFromSecretKey(fromHex(RFC7748.aliceSecret));
  const before = await boxKey(fromHex(RFC7748.bobPublic), fromHex(RFC7748.aliceSecret));
  const box = secretBoxSeal(new TextEncoder().encode("steward"), new Uint8Array(24), before);
  const tree = await deriveKey(new TextEncoder().encode(KEY_TREE.seed), KEY_TREE.usage, KEY_TREE.path);
  const key = Uint8Array.from(PAYLOAD.key);
  const payload = await encryptPayload(key, PAYLOAD.value, Uint8Array.from(PAYLOAD.nonce));
  const opened = await decryptPayload<{ hello: string }>(key, payload);
  return {
    alicePublic: toHex(alice.publicKey),
    beforenm: toHex(before),
    secretbox: toHex(box),
    keyTree: toHex(tree).toUpperCase(),
    payload: toHex(payload),
    payloadOpens: opened?.hello === "steward",
    recovery: formatRecoveryKey(Uint8Array.from(PAYLOAD.key)),
  };
}
