import { type BotPack, BotPackSchema, type BotProblem } from "@steward/shared";
import { issueMessage, issuePath, ONLY_TIGHTEN } from "./pack.ts";
import { scanForInjection } from "./scan.ts";

export { ONLY_TIGHTEN };

/**
 * Everything a pack must pass before it is listed or installed (plan §4.3 and §5). It fails closed:
 * a tool Steward does not have, a rule that would loosen the gateway or does not compile, text that
 * reads as orders for the model, or personal data in the instructions are errors. Long sentences
 * and jargon are warnings, so an author sees them without being blocked.
 */

/** One finding: where in the pack (`rules[0].when`, `skills[1].body`, `needs.tools[2]`), and what. */
export type PackProblem = BotProblem;

export interface ValidateContext {
  /** The tool names this Steward has: the built-in catalogue plus any MCP tools. */
  tools: string[];
  /** The gateway's rule check. Throwing means the rule cannot be used; the message is shown. */
  validateRule: (when: string) => void;
  /** Connectors this Steward knows (`mail`, `calendar`, MCP server ids). Unknown ones warn. */
  connectors?: string[];
}

export interface ValidationResult {
  ok: boolean;
  /** The parsed pack, with defaults filled, when the schema passed. */
  pack?: BotPack;
  problems: PackProblem[];
}

/** Longer than this and a sentence is hard to follow when read aloud. */
export const MAX_SENTENCE_WORDS = 35;

/** Words that say less than they seem to. A warning, not a ban. */
export const JARGON = [
  "leverage",
  "utilise",
  "utilize",
  "synergy",
  "synergies",
  "paradigm",
  "holistic",
  "seamless",
  "seamlessly",
  "streamline",
  "cutting-edge",
  "best-in-class",
  "world-class",
  "empower",
  "actionable",
  "bandwidth",
  "circle back",
  "touch base",
  "deep dive",
  "low-hanging fruit",
  "going forward",
  "operationalise",
  "operationalize",
  "scalable",
  "ecosystem",
  "supercharge",
  "turbocharge",
  "next-level",
  "game-changing",
  "state-of-the-art",
] as const;

const JARGON_RE = new RegExp(`\\b(?:${JARGON.map((w) => w.replace(/[-]/g, "\\-")).join("|")})\\b`, "gi");

/** Domains reserved for examples (RFC 2606). An address on one of them is not anyone's. */
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;
/** A role mailbox (`report@`, `abuse@`, `help@`) belongs to an organisation, not a person. */
const ROLE_MAILBOX =
  /^(?:abuse|admin|complaints|contact|enquiries|inquiries|feedback|hello|help|info|legal|no-?reply|office|phishing|press|privacy|report|reports|sales|security|support|team)$/i;
const EMAIL_RE = /([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})/gi;
/** A phone number: an optional country code, then groups of digits, 9 to 15 digits in all. */
const PHONE_RE = /(?<![\w/])(?:\+\d{1,3}[\s.-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}(?![\w/])/g;
/** 13 to 19 digits with optional spaces or dashes between them: a card, whether or not it checks out. */
const CARD_RE = /(?<![\d/-])(?:\d[ -]?){12,18}\d(?![\d/-])/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function error(path: string, message: string): PackProblem {
  return { path, message, severity: "error" };
}

function warn(path: string, message: string): PackProblem {
  return { path, message, severity: "warn" };
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

function personalData(path: string, text: string, out: PackProblem[]): void {
  for (const match of text.matchAll(EMAIL_RE)) {
    const [, local = "", domain = ""] = match;
    if (EXAMPLE_DOMAIN.test(domain) || ROLE_MAILBOX.test(local)) continue;
    out.push(error(path, `contains an email address (${match[0]}); a bot must not carry personal data`));
  }
  // Card numbers first; their digits are blanked so they are not reported as phone numbers too.
  let rest = text;
  for (const match of text.matchAll(CARD_RE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    out.push(error(path, `contains a card-like run of digits (${match[0].trim()})`));
    const start = match.index ?? 0;
    rest = rest.slice(0, start) + " ".repeat(match[0].length) + rest.slice(start + match[0].length);
  }
  for (const match of rest.matchAll(PHONE_RE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) continue;
    out.push(error(path, `contains what looks like a phone number (${match[0].trim()})`));
  }
}

function injection(path: string, text: string, out: PackProblem[]): void {
  for (const hit of scanForInjection(text).hits) {
    out.push(error(path, `reads as instructions for the model ("${hit.pattern}"): ${hit.excerpt}`));
  }
}

function plainLanguage(path: string, text: string, out: PackProblem[]): void {
  const sentences = text.split(/(?<=[.!?])\s+|\n{2,}/);
  let long = 0;
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
    if (words.length <= MAX_SENTENCE_WORDS) continue;
    if (long++ >= 3) break;
    out.push(
      warn(path, `a sentence has ${words.length} words; keep sentences short ("${excerpt(sentence)}")`),
    );
  }
  const found = [...new Set([...text.matchAll(JARGON_RE)].map((m) => m[0].toLowerCase()))];
  if (found.length > 0) {
    out.push(warn(path, `uses jargon: ${found.map((w) => `"${w}"`).join(", ")}; say it in plain words`));
  }
}

/**
 * Checks a pack against this Steward: its schema, its tools, its rules through the gateway's own
 * rule check, its skills, and its text. `ok` is false when any problem is an error.
 */
export function validatePack(input: unknown, ctx: ValidateContext): ValidationResult {
  const problems: PackProblem[] = [];
  const parsed = BotPackSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(error(issuePath(issue.path) || "pack", issueMessage(issue, input)));
    }
    return { ok: false, problems };
  }
  const pack = parsed.data;

  const known = new Set(ctx.tools);
  pack.needs.tools.forEach((tool, i) => {
    if (tool === "*")
      problems.push(error(`needs.tools[${i}]`, "list the tools by name; a bot cannot ask for all of them"));
    else if (!known.has(tool))
      problems.push(error(`needs.tools[${i}]`, `"${tool}" is not a tool this Steward has`));
  });
  if (ctx.connectors) {
    const connectors = new Set(ctx.connectors);
    pack.needs.connectors.forEach((connector, i) => {
      if (!connectors.has(connector)) {
        problems.push(
          warn(
            `needs.connectors[${i}]`,
            `"${connector}" is not connected here; the person would have to add it`,
          ),
        );
      }
    });
  }

  pack.rules.forEach((rule, i) => {
    try {
      ctx.validateRule(rule.when);
    } catch (err) {
      problems.push(error(`rules[${i}].when`, err instanceof Error ? err.message : String(err)));
    }
  });

  const skillNames = new Set<string>();
  const needed = new Set(pack.needs.tools);
  pack.skills.forEach((skill, i) => {
    if (skillNames.has(skill.name))
      problems.push(error(`skills[${i}].name`, `"${skill.name}" is used twice`));
    skillNames.add(skill.name);
    (skill.allowedTools ?? []).forEach((tool, j) => {
      if (!needed.has(tool)) {
        problems.push(
          warn(
            `skills[${i}].allowedTools[${j}]`,
            `"${tool}" is not in needs.tools, so the skill cannot use it`,
          ),
        );
      }
    });
  });

  injection("instructions", pack.instructions, problems);
  injection("readme", pack.readme, problems);
  pack.skills.forEach((skill, i) => {
    injection(`skills[${i}].body`, skill.body, problems);
  });
  pack.examples.forEach((example, i) => {
    injection(`examples[${i}].ask`, example.ask, problems);
    injection(`examples[${i}].does`, example.does, problems);
  });

  personalData("instructions", pack.instructions, problems);
  pack.skills.forEach((skill, i) => {
    personalData(`skills[${i}].description`, skill.description, problems);
    personalData(`skills[${i}].body`, skill.body, problems);
  });

  plainLanguage("pitch", pack.pitch, problems);
  plainLanguage("instructions", pack.instructions, problems);
  plainLanguage("readme", pack.readme, problems);
  pack.skills.forEach((skill, i) => {
    plainLanguage(`skills[${i}].description`, skill.description, problems);
    plainLanguage(`skills[${i}].body`, skill.body, problems);
  });

  if (pack.author.kind === "ai" && !DATE_RE.test(pack.author.generated.trim())) {
    problems.push(error("author.generated", "must be the date the bot was generated, such as 2026-10-28"));
  }

  return { ok: !problems.some((p) => p.severity === "error"), pack, problems };
}
