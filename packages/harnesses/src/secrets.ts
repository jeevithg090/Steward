/**
 * Key-shaped strings, so a key never reaches a message, the transcript or the record by way of a
 * harness. Kept here, not imported from the gateway, so this package depends only on the shared
 * contracts. The list follows the gateway's outbound check (`packages/gateway/src/outbound.ts`),
 * read a little more loosely: hiding too much in an error line costs nothing.
 */
const KEY_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /\bsk-(?:proj-|ant-|or-|live-|test-)?[A-Za-z0-9_-]{12,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:nvapi|xai|gsk|hf)[-_][A-Za-z0-9_-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\b(?:api[ _-]?key|access[ _-]?token|auth[ _-]?token|client[ _-]?secret|secret|token|password)\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

const MASK = "••••";

/** True when a value looks like a key or token. */
export function looksLikeKey(value: string): boolean {
  return KEY_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

/** The text with every key-shaped part replaced by a mask. */
export function maskKeys(text: string): string {
  let out = text;
  for (const pattern of KEY_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, MASK);
  }
  return out;
}
