/**
 * The injection scan every pack goes through before it is listed (plan §4.3). Listing text is
 * written by third parties and read by the model, so the phrases that try to turn a bot's
 * instructions into orders for the model are refused outright, along with the ways of hiding them:
 * zero-width characters, long base64 blobs and template tokens that something else would fill in.
 */

export interface InjectionHit {
  /** The pattern's short name, for the problem list. */
  pattern: string;
  /** A little text around the match, whitespace collapsed. */
  excerpt: string;
}

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

const PATTERNS: readonly { name: string; re: RegExp }[] = [
  {
    name: "ignore previous instructions",
    re: /\bignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|rules?|prompts?|directions?|guidance)\b/gi,
  },
  { name: "you are now", re: /\byou\s+are\s+now\b/gi },
  { name: "system prompt", re: /\bsystem\s+prompts?\b/gi },
  { name: "disregard", re: /\bdisregard(?:ing|ed|s)?\b/gi },
  {
    name: "do not tell the user",
    re: /\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|show|let)\s+the\s+(?:user|person|human)\b/gi,
  },
  {
    name: "forward to",
    re: /\bforward(?:s|ed|ing)?\s+(?:it|this|that|them|everything|all|any|every|each|the|their|his|her|your|my)\b[^.\n]{0,80}?\bto\b/gi,
  },
  { name: "base64 blob", re: /[A-Za-z0-9+/]{200,}={0,2}/g },
  { name: "zero-width character", re: ZERO_WIDTH },
  { name: "template token", re: /\{\{[^}\n]{0,200}\}\}/g },
];

const MAX_HITS_PER_PATTERN = 3;
const EXCERPT_AROUND = 40;

function excerptOf(text: string, start: number, end: number): string {
  const from = Math.max(0, start - EXCERPT_AROUND);
  const to = Math.min(text.length, end + EXCERPT_AROUND);
  const piece = text.slice(from, to).replace(ZERO_WIDTH, "[zero-width]").replace(/\s+/g, " ").trim();
  const clipped = piece.length > 120 ? `${piece.slice(0, 119)}…` : piece;
  return `${from > 0 ? "…" : ""}${clipped}${to < text.length ? "…" : ""}`;
}

/** Finds text that reads as orders for the model rather than for the person. Empty when clean. */
export function scanForInjection(text: string): { hits: InjectionHit[] } {
  const hits: InjectionHit[] = [];
  if (!text) return { hits };
  for (const { name, re } of PATTERNS) {
    let count = 0;
    for (const match of text.matchAll(re)) {
      if (count++ >= MAX_HITS_PER_PATTERN) break;
      const start = match.index ?? 0;
      const end = start + Math.max(1, match[0].length);
      hits.push({
        pattern: name,
        excerpt:
          name === "base64 blob"
            ? `${match[0].slice(0, 24)}… (${match[0].length} characters)`
            : excerptOf(text, start, end),
      });
    }
  }
  return { hits };
}
