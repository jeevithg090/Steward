/**
 * What Steward remembers about values typed through the secret box: never the values, only a keyed
 * digest of each (HMAC-SHA-256 under a random key that lives in memory and dies with the computer)
 * and a 32-bit rolling fingerprint under another random key, used to find candidates quickly.
 *
 * Masking by element is not enough: a page can re-render the field (a "Show password" toggle),
 * echo the value into text ("Strength of …: weak"), its title or its address. `scrub` finds any run
 * of text whose digest matches a filled value and replaces it, so the value does not reach the
 * model, the record or the screen's status, wherever the page puts it. Each value is remembered as
 * written and as web addresses encode it, so a link or text that repeats a GET form's address
 * (`p%40ss+word%21`) is caught too.
 */
import { createHmac, randomBytes } from "node:crypto";

/**
 * Values shorter than this are hidden only where they are the whole text (a field's value), not
 * inside longer text: a four-digit PIN found inside every year and price would hide half a page.
 */
export const MIN_SCRUBBED_INSIDE = 4;

/**
 * `value` as written, as `encodeURIComponent` writes it (`%20` for a space), and as a form sent with
 * GET writes it (`+` for a space, and `!'()~` encoded too).
 */
function writtenForms(value: string): string[] {
  const forms = new Set([value]);
  try {
    forms.add(encodeURIComponent(value));
  } catch {
    // A lone surrogate cannot be encoded; the value as written is still kept.
  }
  forms.add(new URLSearchParams([["", value]]).toString().slice(1));
  return [...forms];
}

export class SecretEcho {
  private readonly key = randomBytes(32);
  /** Odd, so multiplying by it is invertible mod 2^32 and every position counts. */
  private readonly base = randomBytes(4).readUInt32LE(0) | 1;
  private readonly digests = new Set<string>();
  /** Value length → fingerprints of filled values of that length. */
  private readonly prints = new Map<number, Set<number>>();
  /** Value length → base^(length - 1) mod 2^32, for rolling the fingerprint. */
  private readonly powers = new Map<number, number>();

  /** How many forms of filled values are remembered; 0 when nothing was filled. */
  get size(): number {
    return this.digests.size;
  }

  add(value: string): void {
    if (value === "") return;
    for (const form of writtenForms(value)) this.addForm(form);
  }

  private addForm(value: string): void {
    this.digests.add(this.digest(value));
    let set = this.prints.get(value.length);
    if (!set) {
      set = new Set();
      this.prints.set(value.length, set);
      let power = 1;
      for (let i = 1; i < value.length; i++) power = Math.imul(power, this.base);
      this.powers.set(value.length, power >>> 0);
    }
    set.add(this.fingerprint(value, 0, value.length));
  }

  clear(): void {
    this.digests.clear();
    this.prints.clear();
    this.powers.clear();
  }

  /** Whether `text` is exactly a filled value. */
  has(text: string): boolean {
    return text !== "" && this.prints.has(text.length) && this.digests.has(this.digest(text));
  }

  /** `text` with every filled value in it replaced by `replacement`. */
  scrub(text: string, replacement: string): string {
    if (this.digests.size === 0 || text === "") return text;
    const hits: Array<[number, number]> = [];
    for (const [length, prints] of this.prints) {
      if (text.length < length) continue;
      if (length < MIN_SCRUBBED_INSIDE || text.length === length) {
        if (text.length === length && this.has(text)) hits.push([0, length]);
        continue;
      }
      const power = this.powers.get(length) ?? 1;
      let print = this.fingerprint(text, 0, length);
      for (let i = 0; ; i++) {
        if (prints.has(print) && this.digests.has(this.digest(text.slice(i, i + length)))) {
          hits.push([i, i + length]);
        }
        if (i + length >= text.length) break;
        // Drop the first code unit, add the next: (print - out * base^(n-1)) * base + in, mod 2^32.
        const out = Math.imul(text.charCodeAt(i), power);
        print = (Math.imul(print - out, this.base) + text.charCodeAt(i + length)) >>> 0;
      }
    }
    if (hits.length === 0) return text;
    hits.sort((a, b) => a[0] - b[0]);
    let out = "";
    let at = 0;
    for (const [start, end] of hits) {
      if (end <= at) continue;
      if (start >= at) out += text.slice(at, start) + replacement;
      at = end;
    }
    return out + text.slice(at);
  }

  private digest(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("base64url");
  }

  private fingerprint(text: string, start: number, length: number): number {
    let print = 0;
    for (let i = start; i < start + length; i++)
      print = (Math.imul(print, this.base) + text.charCodeAt(i)) >>> 0;
    return print;
  }
}
