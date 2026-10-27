// Adapted from openbot/server/src/plugins/content-governance.ts (MIT, CopilotKit)
/**
 * The outbound check: what would leave Steward if this call ran.
 *
 * Detects card numbers (Luhn), IBANs (mod-97 and the country's length), UK National Insurance and
 * US Social Security numbers, NHS numbers next to the word "NHS", API keys and tokens, private key
 * blocks, authorization headers, "password: x" pairs, UK sort code + account number pairs, and a
 * short list of health words. A finding never carries the value, only a masked hint such as
 * `•••• 4242`, so it is safe to show on an approval card and to keep in the record.
 *
 * Findings make the gateway ask (never silently refuse): every detector here has false positives,
 * and the person is the right judge of whether the text should go.
 *
 * The credential-field list, provider token patterns and authorization-header test come from
 * OpenBot's content governance. Card, IBAN, national id, bank and health detection are new.
 */
import type { OutboundFinding } from "@steward/shared";

type FindingKind = OutboundFinding["kind"];

/** One detected span in a string. `start`/`end` let the record mask it in place. */
export interface OutboundHit extends OutboundFinding {
  start: number;
  end: number;
}

/**
 * How much of the detector set runs. `full` is for text that is sent (mail, MCP writes, `outbound`);
 * `values` skips health words (text typed into a page, where a health search is not a leak);
 * `secrets` only looks for keys and passwords (URLs, where long numeric ids would look like cards).
 */
export type ScanLevel = "full" | "values" | "secrets";

const LABELS: Record<FindingKind, string> = {
  card_number: "A card number",
  iban: "A bank account number (IBAN)",
  national_id: "A national ID number",
  api_key: "An API key or access token",
  password: "A password",
  health: "A health detail",
  bank_account: "A bank sort code and account number",
};

const MASK = "••••";
const MAX_FINDINGS = 20;
/** Text past this many characters is not scanned; the call is refused instead (fail closed). */
export const MAX_SCAN_CHARS = 2_000_000;

// ── Checksums ──────────────────────────────────────────────────────────────────────────────────

/** True when `digits` (13 to 19 digits, nothing else) passes the Luhn check. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** IBAN lengths by country (SWIFT registry). An IBAN from a country not listed is not reported. */
const IBAN_LENGTHS: ReadonlyMap<string, number> = new Map(
  (
    "AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BI27 BR29 BY28 CH21 CR22 CY28 CZ24 DE22 DJ27 DK18 " +
    "DO28 EE20 EG29 ES24 FI18 FK18 FO18 FR27 GB22 GE22 GI23 GL18 GR27 GT28 HN28 HR21 HU28 IE22 IL23 " +
    "IQ23 IS26 IT27 JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 LV21 LY25 MC27 MD24 ME22 MK19 MN20 MR27 " +
    "MT31 MU30 NI28 NL18 NO15 OM23 PK24 PL28 PS29 PT25 QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24 SI19 " +
    "SK24 SM27 SO23 ST25 SV28 TL23 TN24 TR26 UA29 VA22 VG24 XK20 YE30"
  )
    .split(" ")
    .map((pair) => [pair.slice(0, 2), Number(pair.slice(2))] as const),
);

/** True when `iban` (spaces allowed) has its country's length and passes the mod-97 check. */
export function ibanValid(iban: string): boolean {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) return false;
  const expected = IBAN_LENGTHS.get(compact.slice(0, 2));
  if (expected === undefined || compact.length !== expected) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** NHS numbers carry a mod-11 check digit. */
function nhsValid(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * (10 - i);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === digits.charCodeAt(9) - 48;
}

// ── Detectors ──────────────────────────────────────────────────────────────────────────────────

function hit(kind: FindingKind, start: number, end: number, hint: string): OutboundHit {
  return { kind, hint, label: LABELS[kind], start, end };
}

function lastChars(value: string, n: number): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(-n);
}

/** Bearer and Basic headers, as OpenBot's content governance tests them. */
function isAuthorizationValue(scheme: string, token: string): boolean {
  if (scheme.toLowerCase() === "basic") {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(token, "base64"));
      return decoded.includes(":") && !/\p{Cc}/u.test(decoded);
    } catch {
      return false;
    }
  }
  return /[0-9._~+/=-]/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token.slice(1)));
}

/** Words that follow "password is" in ordinary sentences about passwords. */
const NOT_A_PASSWORD = new Set(
  (
    "required incorrect wrong invalid expired changed reset strong weak too not the a an your my below " +
    "above set needed missing correct case-sensitive protected hidden updated saved stored same different empty"
  ).split(" "),
);

/** `sk-` alone is a common prefix in slugs; a real key has a long mixed letters-and-digits segment. */
function looksRandom(value: string): boolean {
  return value.split(/[-_]/).some((part) => part.length >= 16 && /\d/.test(part) && /[A-Za-z]/.test(part));
}

interface TokenPattern {
  re: RegExp;
  prefix: string;
  check?: (match: string) => boolean;
}

const TOKEN_PATTERNS: TokenPattern[] = [
  { re: /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}/g, prefix: "sk-", check: looksRandom },
  { re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, prefix: "sk_" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, prefix: "gh_" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, prefix: "github_pat_" },
  { re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, prefix: "xox" },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, prefix: "AKIA" },
  { re: /\bAIza[0-9A-Za-z_-]{35}/g, prefix: "AIza" },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, prefix: "eyJ" },
];

function detectSecrets(text: string, out: OutboundHit[]): void {
  for (const m of text.matchAll(
    /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  )) {
    out.push(hit("api_key", m.index, m.index + m[0].length, "a private key"));
  }
  for (const p of TOKEN_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      if (p.check && !p.check(m[0])) continue;
      out.push(hit("api_key", m.index, m.index + m[0].length, `${p.prefix}${MASK}`));
    }
  }
  for (const m of text.matchAll(/\b(Bearer|Basic)\s+([A-Za-z0-9._~+/-]{12,}=*)/gi)) {
    const scheme = m[1] ?? "";
    const token = m[2] ?? "";
    if (scheme.toLowerCase() === "bearer" && token.length < 16) continue;
    if (!isAuthorizationValue(scheme, token)) continue;
    out.push(hit("api_key", m.index, m.index + m[0].length, `${scheme} ${MASK}`));
  }
  for (const m of text.matchAll(
    /\b(api[ _-]?key|access[ _-]?token|auth[ _-]?token|client[ _-]?secret|secret[ _-]?key|secret|token)\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{8,})/gi,
  )) {
    const value = m[2] ?? "";
    if (!/\d/.test(value)) continue;
    out.push(hit("api_key", m.index, m.index + m[0].length, `${(m[1] ?? "key").toLowerCase()}: ${MASK}`));
  }
  for (const m of text.matchAll(
    /\b(password|passwd|pwd|passcode|passphrase|pin(?: code| number)?)(?:\s+is\s+|\s*[:=]\s*)["']?([^\s"',;]{3,})/gi,
  )) {
    const value = (m[2] ?? "").replace(/[.!?]+$/, "");
    if (value.length < 3 || NOT_A_PASSWORD.has(value.toLowerCase())) continue;
    out.push(
      hit("password", m.index, m.index + m[0].length, `${(m[1] ?? "password").toLowerCase()}: ${MASK}`),
    );
  }
}

function detectCards(text: string, out: OutboundHit[]): void {
  for (const m of text.matchAll(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g)) {
    const raw = m[0];
    const compact = raw.replace(/[ -]/g, "");
    const separators = new Set(raw.replace(/\d/g, ""));
    if (separators.size > 1) continue;
    if (
      separators.size === 1 &&
      !/^\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,3})?$|^\d{4}[ -]\d{6}[ -]\d{4,5}$/.test(raw)
    ) {
      continue;
    }
    if (!/^[2-6]/.test(compact) || /^(\d)\1+$/.test(compact) || !luhnValid(compact)) continue;
    out.push(hit("card_number", m.index, m.index + raw.length, `${MASK} ${compact.slice(-4)}`));
  }
}

function detectIbans(text: string, out: OutboundHit[]): void {
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,32}/g)) {
    const raw = m[0];
    const country = raw.slice(0, 2);
    const length = IBAN_LENGTHS.get(country);
    if (length === undefined) continue;
    // Walk the raw text until `length` characters (spaces aside) are taken: the IBAN may be
    // followed by more capitals that the pattern swallowed.
    let taken = 0;
    let end = 0;
    while (end < raw.length && taken < length) {
      if (raw[end] !== " ") taken++;
      end++;
    }
    if (taken < length) continue;
    const candidate = raw.slice(0, end);
    if (!ibanValid(candidate)) continue;
    out.push(hit("iban", m.index, m.index + end, `${country}•• ${MASK} ${lastChars(candidate, 4)}`));
  }
}

function detectNationalIds(text: string, out: OutboundHit[]): void {
  // UK National Insurance number. Prefixes BG, GB, KN, NK, NT, TN and ZZ are never issued.
  for (const m of text.matchAll(
    /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g,
  )) {
    out.push(hit("national_id", m.index, m.index + m[0].length, `${MASK}${lastChars(m[0], 2)}`));
  }
  // US Social Security number, written with dashes or spaces.
  for (const m of text.matchAll(/\b(?!000|666|9\d\d)\d{3}([- ])(?!00)\d{2}\1(?!0000)\d{4}\b/g)) {
    out.push(hit("national_id", m.index, m.index + m[0].length, `•••-••-••${m[0].slice(-2)}`));
  }
  // NHS number, only next to the word "NHS" (ten digits alone are usually a phone number).
  for (const m of text.matchAll(/\bNHS(?:\s+(?:number|no\.?))?[\s:#]*(\d{3}[ -]?\d{3}[ -]?\d{4})\b/gi)) {
    const digits = (m[1] ?? "").replace(/\D/g, "");
    if (!nhsValid(digits)) continue;
    out.push(hit("national_id", m.index, m.index + m[0].length, `NHS ${MASK}${digits.slice(-2)}`));
  }
}

function detectBankAccounts(text: string, out: OutboundHit[]): void {
  const sortCodes = [...text.matchAll(/(?<![\d-])\d{2}[- ]\d{2}[- ]\d{2}(?![\d-])/g)];
  if (sortCodes.length === 0) return;
  const accounts = [...text.matchAll(/(?<![\d-])\d{8}(?![\d-])/g)];
  for (const sc of sortCodes) {
    for (const acc of accounts) {
      const gap = Math.abs(acc.index - sc.index);
      if (gap > 80) continue;
      const from = Math.max(0, Math.min(sc.index, acc.index) - 100);
      const to = Math.max(sc.index, acc.index) + 100;
      if (!/sort|account|acct|a\/c|bank/i.test(text.slice(from, to))) continue;
      const hint = `sort code ••-••-${sc[0].slice(-2)}, account ${MASK}${acc[0].slice(-4)}`;
      out.push(hit("bank_account", sc.index, sc.index + sc[0].length, hint));
      out.push(hit("bank_account", acc.index, acc.index + acc[0].length, hint));
      break;
    }
  }
}

/** A deliberately short list. Matching is whole-word and case-insensitive. */
export const HEALTH_TERMS = [
  "diagnosis",
  "diagnosed",
  "prescription",
  "medication",
  "HIV",
  "cancer",
  "chemotherapy",
  "tumour",
  "tumor",
  "pregnant",
  "pregnancy",
  "miscarriage",
  "depression",
  "bipolar",
  "schizophrenia",
  "psychiatrist",
  "therapist",
  "mental health",
  "rehab",
  "addiction",
  "overdose",
  "STI",
  "STD",
  "chlamydia",
  "diabetes",
  "insulin",
  "biopsy",
  "blood test",
  "test results",
  "medical records",
  "sick note",
  "fit note",
] as const;

const HEALTH_RE = new RegExp(
  `\\b(${HEALTH_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);

function detectHealth(text: string, out: OutboundHit[]): void {
  let found = 0;
  for (const m of text.matchAll(HEALTH_RE)) {
    out.push(hit("health", m.index, m.index + m[0].length, `mentions "${m[0].toLowerCase()}"`));
    if (++found >= 3) break;
  }
}

/** Every sensitive span in `text`, in order of position. */
export function detectSensitive(text: string, level: ScanLevel = "full"): OutboundHit[] {
  const out: OutboundHit[] = [];
  if (!text) return out;
  detectSecrets(text, out);
  if (level !== "secrets") {
    detectCards(text, out);
    detectIbans(text, out);
    detectNationalIds(text, out);
    detectBankAccounts(text, out);
  }
  if (level === "full") detectHealth(text, out);
  // One span, one finding: "token=ghp_…" is a single key, and the digits inside an IBAN are not
  // also a card number. The earliest, longest span wins; health words never hide a value.
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: OutboundHit[] = [];
  for (const h of out) {
    const covered = kept.some(
      (k) => k.kind !== "health" && h.kind !== "health" && h.start < k.end && h.end > k.start,
    );
    if (!covered) kept.push(h);
  }
  return kept;
}

function dedupe(hits: readonly OutboundFinding[]): OutboundFinding[] {
  const seen = new Set<string>();
  const out: OutboundFinding[] = [];
  for (const h of hits) {
    const key = `${h.kind}\u0000${h.hint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: h.kind, hint: h.hint, label: h.label });
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}

/** Findings in one string, deduplicated, without positions. */
export function scanText(text: string, level: ScanLevel = "full"): OutboundFinding[] {
  return dedupe(detectSensitive(text, level));
}

/**
 * Replaces every value-type finding (not health words) with its masked hint. The record and
 * previews use this so a card number in a message body never lands in the audit chain.
 */
export function maskSensitive(text: string): string {
  if (!text) return text;
  const hits = detectSensitive(text, "values").filter((h) => h.kind !== "health");
  if (hits.length === 0) return text;
  let out = "";
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    out += `${text.slice(at, h.start)}[${h.hint}]`;
    at = h.end;
  }
  return out + text.slice(at);
}

// ── Scanning a call ────────────────────────────────────────────────────────────────────────────

/** Field names whose non-empty value is a credential, whatever it looks like. */
const CREDENTIAL_FIELDS = new Set([
  "access_token",
  "api_key",
  "api_secret",
  "auth_token",
  "authorization",
  "bearer_token",
  "client_secret",
  "credential",
  "credentials",
  "id_token",
  "passwd",
  "password",
  "private_key",
  "pwd",
  "refresh_token",
  "secret",
  "secret_key",
  "session_token",
  "signing_key",
  "ssh_key",
  "token",
  "passcode",
  "cvv",
  "cvc",
]);

function normalisedField(name: string): string {
  const snake = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-.\s]/g, "_");
  return snake.startsWith("x_") ? snake.slice(2) : snake;
}

interface Collected {
  texts: string[];
  fields: OutboundFinding[];
  chars: number;
}

function collect(value: unknown, into: Collected, depth: number, seen: WeakSet<object>): void {
  if (depth > 20) throw new Error("the arguments are nested too deeply to check");
  if (typeof value === "string") {
    into.chars += value.length;
    if (into.chars > MAX_SCAN_CHARS) throw new Error("the text is too large to check");
    into.texts.push(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("the arguments refer to themselves");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const field = normalisedField(key);
    if (CREDENTIAL_FIELDS.has(field) && child !== null && child !== undefined && child !== "") {
      const kind: FindingKind = /pass|pwd|cvv|cvc/.test(field) ? "password" : "api_key";
      into.fields.push({ kind, hint: `${key}: ${MASK}`, label: LABELS[kind] });
      continue;
    }
    collect(child, into, depth + 1, seen);
  }
}

/** What the outbound check needs to know about a call. */
export interface OutboundInput {
  tool: { name: string; kind: string; surface: string };
  args: Record<string, unknown>;
  target?: { url?: string };
  /** After reading untrusted content, a URL is checked for personal values too, not only keys. */
  tainted?: boolean;
  outbound?: string;
}

/**
 * The findings for a call, or a thrown error when it cannot be checked (the gateway refuses then).
 *
 * - `outbound` (the text that leaves, as the agent states it) is always scanned in full.
 * - Every string argument is scanned in full when the call sends, pays or signs, or writes through
 *   an MCP server; for `browser_type` the typed text is scanned for values but not health words.
 * - A target URL is scanned for keys and passwords, so a fetch cannot carry a key out in a query
 *   string. Once the conversation is tainted it is scanned for personal values too (card, IBAN,
 *   national ids), because an injected page may try to smuggle them out by opening a link.
 */
export function scanOutbound(call: OutboundInput): OutboundFinding[] {
  const findings: OutboundFinding[] = [];
  let chars = 0;
  const scan = (text: string | undefined, level: ScanLevel) => {
    if (!text) return;
    chars += text.length;
    if (chars > MAX_SCAN_CHARS) throw new Error("the text is too large to check");
    findings.push(...scanText(text, level));
  };

  scan(call.outbound, "full");

  const { kind, surface, name } = call.tool;
  const sends =
    kind === "send" || kind === "pay" || kind === "sign" || (surface === "mcp" && kind !== "read");
  if (sends || name === "browser_type") {
    const collected: Collected = { texts: [], fields: [], chars };
    collect(call.args, collected, 0, new WeakSet());
    chars = collected.chars;
    findings.push(...collected.fields);
    const level: ScanLevel = sends ? "full" : "values";
    for (const text of collected.texts) findings.push(...scanText(text, level));
  }

  scan(call.target?.url, call.tainted ? "values" : "secrets");
  return dedupe(findings);
}

/** Lower-cases the first letter for use mid-sentence, leaving acronyms such as IBAN alone. */
function lowerFirst(label: string): string {
  const second = label.charAt(1);
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** "a card number and a health detail", for a reason sentence. */
export function describeFindings(findings: readonly OutboundFinding[]): string {
  const labels = [...new Set(findings.map((f) => lowerFirst(f.label)))];
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
