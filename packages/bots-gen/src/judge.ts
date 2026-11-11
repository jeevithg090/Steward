import type { BotPack, TextModel } from "@steward/shared";
import { parseJsonObject } from "./json.ts";
import { buildJudgePrompt, JUDGE_SYSTEM, SAFETY_CATEGORIES } from "./prompt.ts";
import { overlap, tokens } from "./text.ts";

/**
 * The quality gate a generated pack passes before it is written: a second model call scores
 * usefulness, honesty and clarity (and safety, for health, money and investing bots), and
 * near-duplicates are dropped. The batch runner drops a pack whose average is below `JUDGE_BAR`,
 * or whose safety score is below `SAFETY_BAR`.
 */

export const JUDGE_BAR = 3.5;

/**
 * The least safety score a health, money or investing bot may have, whatever its mean: one that
 * never sends the person to a doctor or an adviser, or picks doses from search results, scores 1
 * or 2, and strong scores elsewhere must not carry it over the bar.
 */
export const SAFETY_BAR = 3;

export interface Judgement {
  /** The mean of the scores, 1 to 5. */
  score: number;
  /** One line per aspect: "Usefulness 4/5: …". */
  notes: string[];
  scores: { usefulness: number; honesty: number; clarity: number; safety?: number };
}

const ASPECTS = ["usefulness", "honesty", "clarity"] as const;

function readScore(value: unknown): number | undefined {
  const entry = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  const raw = entry?.score ?? value;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(n) || n < 1 || n > 5) return undefined;
  return n;
}

function readNote(value: unknown): string {
  const entry = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  return typeof entry?.note === "string" ? entry.note.trim() : "";
}

/**
 * Turns the judge's JSON into a judgement. Throws when a score is missing or out of range;
 * `safety` is required when asked for, so a health bot cannot pass without it.
 */
export function parseJudgement(text: string, opts: { safety?: boolean } = {}): Judgement {
  const raw = parseJsonObject(text);
  const scores = {} as Judgement["scores"];
  const notes: string[] = [];
  const aspects: readonly (keyof Judgement["scores"])[] = opts.safety ? [...ASPECTS, "safety"] : ASPECTS;
  for (const aspect of aspects) {
    const score = readScore(raw[aspect]);
    if (score === undefined) throw new Error(`The judge gave no score for ${aspect}.`);
    scores[aspect] = score;
    const note = readNote(raw[aspect]);
    notes.push(`${aspect[0]!.toUpperCase()}${aspect.slice(1)} ${score}/5${note ? `: ${note}` : ""}`);
  }
  const values = aspects.map((a) => scores[a] ?? 0);
  const score = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  return { score, notes, scores };
}

/** `opts.tools` is the catalogue, so the judge knows which tool names are real. */
export async function judgeBot(
  pack: BotPack,
  model: TextModel,
  opts: { tools?: readonly string[] } = {},
): Promise<Judgement> {
  const answer = await model.complete({
    system: JUDGE_SYSTEM,
    prompt: buildJudgePrompt(pack, opts.tools),
    maxTokens: 800,
  });
  return parseJudgement(answer, { safety: SAFETY_CATEGORIES.has(pack.category) });
}

export const DUPLICATE_OVERLAP = 0.8;

export interface DedupeResult {
  kept: BotPack[];
  dropped: { id: string; duplicateOf: string }[];
}

/**
 * Drops packs whose name and pitch overlap an earlier one (or one in `existing`) by more than
 * `DUPLICATE_OVERLAP` of their tokens. The earlier pack wins, so the order of `packs` matters.
 */
export function dedupe(packs: readonly BotPack[], existing: readonly BotPack[] = []): DedupeResult {
  const seen: { id: string; tokens: Set<string> }[] = existing.map((p) => ({
    id: p.id,
    tokens: tokens(`${p.name} ${p.pitch}`),
  }));
  const kept: BotPack[] = [];
  const dropped: DedupeResult["dropped"] = [];
  for (const pack of packs) {
    const mine = tokens(`${pack.name} ${pack.pitch}`);
    const twin = seen.find(
      (s) =>
        s.id !== pack.id &&
        Math.min(s.tokens.size, mine.size) >= 4 &&
        overlap(s.tokens, mine) > DUPLICATE_OVERLAP,
    );
    if (twin) {
      dropped.push({ id: pack.id, duplicateOf: twin.id });
      continue;
    }
    seen.push({ id: pack.id, tokens: mine });
    kept.push(pack);
  }
  return { kept, dropped };
}
