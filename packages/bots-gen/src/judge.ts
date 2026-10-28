import type { BotPack, TextModel } from "@steward/shared";
import { parseJsonObject } from "./json.ts";
import { buildJudgePrompt, JUDGE_SYSTEM } from "./prompt.ts";
import { overlap, tokens } from "./text.ts";

/**
 * The quality gate a generated pack passes before it is written: a second model call scores
 * usefulness, honesty and clarity, and near-duplicates are dropped. The batch runner drops a pack
 * whose average is below `JUDGE_BAR`.
 */

export const JUDGE_BAR = 3.5;

export interface Judgement {
  /** The mean of the three scores, 1 to 5. */
  score: number;
  /** One line per aspect: "Usefulness 4/5: …". */
  notes: string[];
  scores: { usefulness: number; honesty: number; clarity: number };
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

/** Turns the judge's JSON into a judgement. Throws when a score is missing or out of range. */
export function parseJudgement(text: string): Judgement {
  const raw = parseJsonObject(text);
  const scores = {} as Judgement["scores"];
  const notes: string[] = [];
  for (const aspect of ASPECTS) {
    const score = readScore(raw[aspect]);
    if (score === undefined) throw new Error(`The judge gave no score for ${aspect}.`);
    scores[aspect] = score;
    const note = readNote(raw[aspect]);
    notes.push(`${aspect[0]!.toUpperCase()}${aspect.slice(1)} ${score}/5${note ? `: ${note}` : ""}`);
  }
  const score = Math.round(((scores.usefulness + scores.honesty + scores.clarity) / 3) * 100) / 100;
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
    maxTokens: 600,
  });
  return parseJudgement(answer);
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
