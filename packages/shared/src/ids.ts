const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * A sortable id with a readable prefix: `apr_01k8x...`. The first ten characters encode the
 * millisecond time, so ids sort by creation; the rest is random. Works in Node and the browser.
 */
export function newId(prefix: string): string {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % 32];
  return `${prefix}_${time}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
