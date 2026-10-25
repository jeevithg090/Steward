// Profiles and skill manifests: who Tempo works for, which skills are on, how it must speak
// with the person and what it may never do. Mirrors SHIPPING.md §4.1-4.3 and the Gateway's
// ProfileView (tempo_core.profiles). A profile is enforced by the Harness, not just displayed.

/** The eight capability words (tempo_passport.ACTIONS). Mandates, profiles and skills share them. */
export const ACTIONS = [
  "claim",
  "call",
  "accept_cash",
  "accept_voucher",
  "discuss_other_accounts",
  "change_contract",
  "share_personal_data",
  "escalate",
] as const;

export type Action = (typeof ACTIONS)[number];

/** Plain words for each capability, in the person's terms. */
export const ACTION_WORDS: Record<Action, string> = {
  claim: "claim money for you",
  call: "phone a company for you",
  accept_cash: "accept cash on your behalf",
  accept_voucher: "accept vouchers instead of cash",
  discuss_other_accounts: "discuss your other accounts",
  change_contract: "change a contract",
  share_personal_data: "share your personal details",
  escalate: "take a complaint further",
};

export type SkillStatus = "ready" | "demo-values" | "experimental";
export type ProfileStatus = "starter" | "community";
export type Channel = "web" | "sms" | "voice";

/** `skills/<id>/skill.yaml` (§4.2). */
export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  status: SkillStatus;
  summary: string;
  jobs: string[];
  needs: Action[];
  channels: Channel[];
  mission?: string | null;
  operators?: string[];
  docs?: string | null;
  notes?: string | null;
  maintainers: string[];
}

export interface ProfileLimits {
  max_gbp_per_claim: string;
  max_user_questions: number;
  max_llm_gbp_per_mission: string;
  mandate_days: number;
}

export interface ProfileAccess {
  language: string;
  pace: "normal" | "slower";
  patience: "normal" | "high";
  voice: "default" | "low";
  prefers_text: boolean;
  plain_words: boolean;
}

export interface ProfileShare {
  public: boolean;
  author: string;
}

/** `profiles/<id>.yaml` as written (§4.3): the thing a share code carries. */
export interface Profile {
  id: string;
  name: string;
  version: string;
  status: ProfileStatus;
  summary: string;
  for_whom: string;
  skills: string[];
  may: Action[];
  may_not: Action[];
  limits: ProfileLimits;
  access: ProfileAccess;
  channels: Channel[];
  time_value_gbp_h: string;
  share: ProfileShare;
}

export interface ProfileSkillRef {
  id: string;
  name: string;
  status: SkillStatus;
  jobs: string[];
}

/** The derived view the Gateway and the web show (§4.3 "Derived view"). */
export interface ProfileView extends Omit<Profile, "skills"> {
  skills: ProfileSkillRef[];
  /** The ordered union of the skills' jobs: "what this profile will do for you". */
  jobs: string[];
  /** The YAML file as committed (catalog only; a Gateway view has none). */
  yaml?: string;
}

export interface Catalog {
  generated_at: string;
  source: string;
  skills: SkillManifest[];
  profiles: ProfileView[];
}

export const SHARE_PREFIX = "tp1.";
export const SHARE_MAX_BYTES = 4096;

/** Thrown when a share code cannot be trusted; `reason` is in plain words. */
export class ProfileInvalid extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "ProfileInvalid";
  }
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  pa: "Punjabi",
  pl: "Polish",
  ur: "Urdu",
  cy: "Welsh",
};

/** The access needs as short chips, e.g. "Hindi · slower · patient · texts the question". */
export function accessChips(access: ProfileAccess): string[] {
  const chips = [LANGUAGE_NAMES[access.language] ?? access.language];
  if (access.pace === "slower") chips.push("slower");
  if (access.patience === "high") chips.push("patient");
  if (access.voice === "low") chips.push("lower voice");
  if (access.prefers_text) chips.push("texts the question");
  if (access.plain_words) chips.push("plain words");
  return chips;
}

/** The ordered union of the skills' jobs, first occurrence wins. */
export function unionJobs(skills: { jobs: string[] }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const skill of skills) {
    for (const job of skill.jobs) {
      if (seen.has(job)) continue;
      seen.add(job);
      out.push(job);
    }
  }
  return out;
}

/** Back from the derived view to the YAML shape (what a share code carries). */
export function toProfile(view: ProfileView): Profile {
  return {
    id: view.id,
    name: view.name,
    version: view.version,
    status: view.status,
    summary: view.summary,
    for_whom: view.for_whom,
    skills: view.skills.map((s) => s.id),
    may: [...view.may],
    may_not: [...view.may_not],
    limits: { ...view.limits },
    access: { ...view.access },
    channels: [...view.channels],
    time_value_gbp_h: view.time_value_gbp_h,
    share: { ...view.share },
  };
}

/** A view from a profile and the manifests it names (what the import page shows without a Gateway). */
export function toView(profile: Profile, manifests: SkillManifest[]): ProfileView {
  const skills: ProfileSkillRef[] = profile.skills.map((id) => {
    const manifest = manifests.find((m) => m.id === id);
    return manifest
      ? { id, name: manifest.name, status: manifest.status, jobs: manifest.jobs }
      : { id, name: id, status: "experimental", jobs: [] };
  });
  return { ...profile, skills, jobs: unionJobs(skills) };
}

// Canonical JSON: keys sorted at every level, no whitespace (what the Gateway signs and compares).
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new ProfileInvalid("The code has characters that don't belong in a share code.");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new ProfileInvalid("The code isn't complete. Copy the whole link and try again.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `tp1.` + base64url(canonical JSON) of the profile; at most 4096 bytes. */
export function encodeShareCode(profile: Profile): string {
  const code = SHARE_PREFIX + toBase64Url(new TextEncoder().encode(canonical(profile)));
  if (code.length > SHARE_MAX_BYTES) throw new ProfileInvalid("This profile is too big to share as a link.");
  return code;
}

/** The share link for the hash-routed app: the code rides in the route's query, never a server log. */
export function shareUrl(origin: string, profile: Profile): string {
  return `${origin}/#/profiles/import?p=${encodeShareCode(profile)}`;
}

/** The `#p=` code from a URL hash, or null. */
/** The code from a pasted link or hash: `#/profiles/import?p=…`, `?p=…`, `#p=…` or `p=…`. */
export function codeFromHash(hash: string): string | null {
  const match = /(?:^|[#?&])p=([^&#]+)/.exec(hash.trim());
  return match ? decodeURIComponent(match[1]!) : null;
}

const ID = /^[a-z0-9-]{2,40}$/;

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function stringList(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || !v.every(isString)) throw new ProfileInvalid(`"${what}" should be a list of words.`);
  return v;
}

function actionList(v: unknown, what: string): Action[] {
  const list = stringList(v, what);
  const bad = list.find((a) => !(ACTIONS as readonly string[]).includes(a));
  if (bad) throw new ProfileInvalid(`"${bad}" isn't a capability Tempo knows (in "${what}").`);
  return list as Action[];
}

function money(v: unknown, what: string): string {
  if (!isString(v) || !/^\d+(\.\d{1,2})?$/.test(v)) throw new ProfileInvalid(`"${what}" should be an amount like "250.00".`);
  return v;
}

function intIn(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new ProfileInvalid(`"${what}" should be a whole number from ${min} to ${max}.`);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, what: string, allowed: readonly T[]): T {
  if (!isString(v) || !(allowed as readonly string[]).includes(v)) {
    throw new ProfileInvalid(`"${what}" should be one of: ${allowed.join(", ")}.`);
  }
  return v as T;
}

function keysOnly(obj: Record<string, unknown>, allowed: string[], where: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ProfileInvalid(`"${extra[0]}" isn't part of a ${where}.`);
}

/**
 * Check a decoded object is a profile (schema with no extra keys, `may ∩ may_not = ∅`, amounts
 * as strings, ids well formed). Whether each skill exists is checked against the manifests given;
 * `needs(skill) ⊆ may` is checked when the manifest is known. The Gateway re-checks everything.
 */
export function validateProfile(raw: unknown, manifests: SkillManifest[] | null = null): Profile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProfileInvalid("The code doesn't hold a profile.");
  const o = raw as Record<string, unknown>;
  keysOnly(o, ["id", "name", "version", "status", "summary", "for_whom", "skills", "may", "may_not", "limits", "access", "channels", "time_value_gbp_h", "share"], "profile");
  for (const key of ["id", "name", "version", "summary", "for_whom", "time_value_gbp_h"]) {
    if (!isString(o[key]) || !(o[key] as string).trim()) throw new ProfileInvalid(`The profile is missing "${key}".`);
  }
  if (!ID.test(o.id as string)) throw new ProfileInvalid("The profile's id should be 2 to 40 lower-case letters, digits or dashes.");
  if ((o.name as string).length > 80) throw new ProfileInvalid("The profile's name is too long.");
  const status = oneOf(o.status, "status", ["starter", "community"] as const);
  const skills = stringList(o.skills, "skills");
  if (!skills.length) throw new ProfileInvalid("A profile needs at least one skill.");
  const may = actionList(o.may, "may");
  const mayNot = actionList(o.may_not, "may_not");
  const both = may.find((a) => mayNot.includes(a));
  if (both) throw new ProfileInvalid(`"${both}" is in both "may" and "may_not". A profile has to choose.`);
  if (!o.limits || typeof o.limits !== "object") throw new ProfileInvalid('The profile is missing "limits".');
  const l = o.limits as Record<string, unknown>;
  keysOnly(l, ["max_gbp_per_claim", "max_user_questions", "max_llm_gbp_per_mission", "mandate_days"], "profile's limits");
  const limits: ProfileLimits = {
    max_gbp_per_claim: money(l.max_gbp_per_claim, "max_gbp_per_claim"),
    max_user_questions: intIn(l.max_user_questions, "max_user_questions", 1, 10),
    max_llm_gbp_per_mission: money(l.max_llm_gbp_per_mission, "max_llm_gbp_per_mission"),
    mandate_days: intIn(l.mandate_days, "mandate_days", 1, 7),
  };
  if (!o.access || typeof o.access !== "object") throw new ProfileInvalid('The profile is missing "access".');
  const a = o.access as Record<string, unknown>;
  keysOnly(a, ["language", "pace", "patience", "voice", "prefers_text", "plain_words"], "profile's access needs");
  const access: ProfileAccess = {
    language: oneOf(a.language, "language", Object.keys(LANGUAGE_NAMES)),
    pace: oneOf(a.pace, "pace", ["normal", "slower"] as const),
    patience: oneOf(a.patience, "patience", ["normal", "high"] as const),
    voice: oneOf(a.voice, "voice", ["default", "low"] as const),
    prefers_text: Boolean(a.prefers_text),
    plain_words: Boolean(a.plain_words),
  };
  if (typeof a.prefers_text !== "boolean" || typeof a.plain_words !== "boolean") {
    throw new ProfileInvalid('"prefers_text" and "plain_words" should be true or false.');
  }
  const channels = stringList(o.channels, "channels").map((c) => oneOf(c, "channels", ["web", "sms", "voice"] as const));
  money(o.time_value_gbp_h, "time_value_gbp_h");
  if (!o.share || typeof o.share !== "object") throw new ProfileInvalid('The profile is missing "share".');
  const s = o.share as Record<string, unknown>;
  keysOnly(s, ["public", "author"], "profile's share block");
  if (typeof s.public !== "boolean" || !isString(s.author)) throw new ProfileInvalid('"share" should say public: true/false and name an author.');
  if (manifests) {
    for (const id of skills) {
      const manifest = manifests.find((m) => m.id === id);
      if (!manifest) throw new ProfileInvalid(`"${id}" isn't a skill Tempo has.`);
      const missing = manifest.needs.find((n) => !may.includes(n));
      if (missing) {
        throw new ProfileInvalid(`"${manifest.name}" needs "${missing}", but this profile doesn't allow it.`);
      }
    }
  }
  return {
    id: o.id as string,
    name: o.name as string,
    version: o.version as string,
    status,
    summary: o.summary as string,
    for_whom: o.for_whom as string,
    skills,
    may,
    may_not: mayNot,
    limits,
    access,
    channels,
    time_value_gbp_h: o.time_value_gbp_h as string,
    share: { public: s.public, author: s.author },
  };
}

/** Decode a share code in the browser. Throws `ProfileInvalid` with a plain reason. */
export function decodeShareCode(code: string, manifests: SkillManifest[] | null = null): Profile {
  const trimmed = code.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) throw new ProfileInvalid('A Tempo share code starts with "tp1.".');
  if (trimmed.length > SHARE_MAX_BYTES) throw new ProfileInvalid("This code is longer than a profile can be.");
  const bytes = fromBase64Url(trimmed.slice(SHARE_PREFIX.length));
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProfileInvalid("The code has been changed or cut short: it no longer holds a profile.");
  }
  return validateProfile(parsed, manifests);
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  if (/^[A-Za-z][A-Za-z0-9 _.()'-]*$/.test(value) && !/^(true|false|yes|no|null|on|off)$/i.test(value)) return value;
  return JSON.stringify(value);
}

function yamlFlow(list: readonly string[]): string {
  return `[${list.map(yamlScalar).join(", ")}]`;
}

function yamlFolded(text: string, indent = "  "): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 92) {
      lines.push(line.trim());
      line = word;
    } else line = `${line} ${word}`;
  }
  if (line.trim()) lines.push(line.trim());
  return `>-\n${lines.map((l) => indent + l).join("\n")}`;
}

/** The profile as a `profiles/<id>.yaml` file, for download (the catalog's own text when it has it). */
export function profileToYaml(view: ProfileView): string {
  if (view.yaml) return view.yaml;
  const p = toProfile(view);
  return [
    `# A Tempo Profile: who Tempo works for, which skills are on, and what it may never do.`,
    `id: ${p.id}`,
    `name: ${yamlScalar(p.name)}`,
    `version: ${JSON.stringify(p.version)}`,
    `status: ${p.status}`,
    `summary: ${yamlFolded(p.summary)}`,
    `for_whom: ${yamlFolded(p.for_whom)}`,
    `skills: ${yamlFlow(p.skills)}`,
    `may: ${yamlFlow(p.may)}`,
    `may_not: ${yamlFlow(p.may_not)}`,
    `limits:`,
    `  max_gbp_per_claim: ${JSON.stringify(p.limits.max_gbp_per_claim)}`,
    `  max_user_questions: ${p.limits.max_user_questions}`,
    `  max_llm_gbp_per_mission: ${JSON.stringify(p.limits.max_llm_gbp_per_mission)}`,
    `  mandate_days: ${p.limits.mandate_days}`,
    `access:`,
    `  language: ${p.access.language}`,
    `  pace: ${p.access.pace}`,
    `  patience: ${p.access.patience}`,
    `  voice: ${p.access.voice}`,
    `  prefers_text: ${p.access.prefers_text}`,
    `  plain_words: ${p.access.plain_words}`,
    `channels: ${yamlFlow(p.channels)}`,
    `time_value_gbp_h: ${JSON.stringify(p.time_value_gbp_h)}`,
    `share:`,
    `  public: ${p.share.public}`,
    `  author: ${yamlScalar(p.share.author)}`,
    ``,
  ].join("\n");
}
