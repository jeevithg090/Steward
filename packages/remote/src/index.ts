/**
 * @steward/remote: the crypto and protocol shared by Steward's bridge, the relay and the phone app
 * (docs/plans/phone-and-shortcuts.md §5). NaCl, the payload format, the key tree and the recovery
 * key are ported from Happy (MIT); the pairing confirmation, signed answers and the closed RPC
 * list are Steward's own. Runs in Node and in the browser.
 */
export * from "./bytes.ts";
export * from "./keys.ts";
export * from "./nacl.ts";
export * from "./payload.ts";
export * from "./protocol.ts";
export * from "./recovery.ts";
export * from "./sas.ts";
export * from "./signing.ts";
export { EXPECTED as VECTORS_EXPECTED, runVectors, type VectorResults } from "./vectors.ts";
export * from "./webauthn.ts";
