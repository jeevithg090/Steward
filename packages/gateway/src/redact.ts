// Adapted from openbot/server/src/audit.ts and approvals/types.ts (MIT, CopilotKit)
/**
 * Canonical JSON, hashing and redaction.
 *
 * Redaction is by key name, as in OpenBot's audit (CopilotKit/openbot server/src/audit.ts, MIT): a
 * value under a key that names a secret is replaced, whatever it looks like. The record goes further
 * and masks sensitive values found inside strings (a card number in a message body) and cuts long
 * strings to a short preview.
 */
import { createHash } from "node:crypto";
import { maskSensitive } from "./outbound.ts";

export const REDACTED = "[redacted]";

/** JSON with object keys sorted at every level. Two equal values always give the same string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined || typeof v === "function" || typeof v === "symbol") continue;
    out[key] = sortKeys(v);
  }
  return out;
}

/** A plain JSON copy: drops undefined, functions and cycles' worth of trouble before hashing or storing. */
export function plainJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Words that, in a key name, mean the value is a secret. Matched against camelCase/snake_case words. */
const SECRET_WORDS = new Set([
  "password",
  "passwd",
  "pwd",
  "passcode",
  "passphrase",
  "secret",
  "secrets",
  "token",
  "tokens",
  "authorization",
  "cookie",
  "cookies",
  "otp",
  "pin",
  "cvv",
  "cvc",
  "csc",
  "key",
  "credential",
  "credentials",
  "ssn",
]);

/** Substrings of a flattened key name that mean the same. */
const SECRET_SUBSTRINGS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "credential",
  "apikey",
  "privatekey",
  "accesskey",
  "sessionid",
];

/** True when a key named like this holds a secret (`password`, `apiKey`, `x-auth-token`, `pin`). */
export function isSecretKey(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => SECRET_WORDS.has(w))) return true;
  const flat = words.join("");
  return SECRET_SUBSTRINGS.some((s) => flat.includes(s));
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export interface RedactOptions {
  /** Longest string kept; longer ones are cut with an ellipsis. */
  maxString: number;
  /** Mask card numbers, IBANs, keys and the like inside strings. */
  mask: boolean;
  /** Most items kept from an array, and keys from an object. */
  maxItems: number;
  maxDepth: number;
  /** Dotted paths that look secret but are not for this call, e.g. `key` for `browser_press`. */
  keep?: ReadonlySet<string>;
  /** Dotted paths that are secret for this call, e.g. `text` typed into a password field. */
  hide?: ReadonlySet<string>;
}

function redactValue(value: unknown, opts: RedactOptions, depth: number, path: string): unknown {
  if (typeof value === "string") {
    const masked = opts.mask ? maskSensitive(value) : value;
    return truncate(masked, opts.maxString);
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    return value;
  }
  if (depth >= opts.maxDepth) return "…";
  if (Array.isArray(value)) {
    const items = value.slice(0, opts.maxItems).map((v) => redactValue(v, opts, depth + 1, path));
    if (value.length > opts.maxItems) items.push(`… ${value.length - opts.maxItems} more`);
    return items;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [key, child] of entries.slice(0, opts.maxItems)) {
    const childPath = path ? `${path}.${key}` : key;
    const hidden = opts.hide?.has(childPath);
    const kept = opts.keep?.has(childPath);
    if (hidden || (!kept && isSecretKey(key))) {
      out[key] = child === undefined || child === null || child === "" ? child : REDACTED;
      continue;
    }
    const v = redactValue(child, opts, depth + 1, childPath);
    if (v !== undefined) out[key] = v;
  }
  if (entries.length > opts.maxItems) out["…"] = `${entries.length - opts.maxItems} more`;
  return out;
}

export function redact(value: unknown, opts: RedactOptions): unknown {
  return redactValue(value, opts, 0, "");
}

/** `keep`/`hide` paths moved under a parent key: `text` → `args.text`. */
export function underKey(key: string, paths: ReadonlySet<string> | undefined): Set<string> {
  return new Set([...(paths ?? [])].map((p) => `${key}.${p}`));
}

/** For the record: secrets by key, sensitive values masked, strings cut to 200 characters. */
export function redactForAudit(
  value: Record<string, unknown>,
  extra?: Pick<RedactOptions, "keep" | "hide">,
): Record<string, unknown> {
  return redact(value, { maxString: 200, mask: true, maxItems: 30, maxDepth: 6, ...extra }) as Record<
    string,
    unknown
  >;
}

/**
 * For an approval card: secrets by key only. Message bodies are shown whole (up to 20,000
 * characters) because the person approves what they can see.
 */
export function redactForApproval(
  value: Record<string, unknown>,
  extra?: Pick<RedactOptions, "keep" | "hide">,
): Record<string, unknown> {
  return redact(value, { maxString: 20_000, mask: false, maxItems: 200, maxDepth: 12, ...extra }) as Record<
    string,
    unknown
  >;
}

/** A short, masked preview of a tool result for the record. */
export function previewOf(result: unknown, max = 200): string {
  let text: string;
  if (typeof result === "string") text = result;
  else if (result === undefined) text = "";
  else {
    try {
      text = JSON.stringify(redact(result, { maxString: max, mask: true, maxItems: 20, maxDepth: 4 })) ?? "";
    } catch {
      text = "[result could not be shown]";
    }
  }
  return truncate(maskSensitive(text), max);
}
