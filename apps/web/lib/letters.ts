// Read It To Me (SHIPPING.md §4.8, the flagship accessibility beat): a photo of an official
// letter becomes a plain spoken-ready reading with the clocks it starts. Mirrors the
// LetterReading JSON of `POST /letters/read` (tempo_core.letters) and `POST /letters/reply`.
// `kind` and `money.direction` are the contract's codes; the words for them live here.

export const LETTER_KINDS = ["water_bill", "council_tax", "benefit_decision", "debt_letter", "unknown"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export const MONEY_DIRECTIONS = ["owed_to_you", "you_owe", "none"] as const;
export type MoneyDirection = (typeof MONEY_DIRECTIONS)[number];

/** What each kind is, in plain words ("A water bill from Thames Water"). */
export const KIND_WORDS: Record<LetterKind, string> = {
  water_bill: "A water bill",
  council_tax: "A council tax letter",
  benefit_decision: "A benefits decision letter",
  debt_letter: "A letter about a debt",
  unknown: "A letter",
};

export const DIRECTION_WORDS: Record<MoneyDirection, string> = {
  owed_to_you: "Money is coming to you",
  you_owe: "Money is owed by you",
  none: "No money changes hands",
};

export interface LetterMoney {
  /** Who owes whom: money coming to you, money you must pay, or no money in it. */
  direction: MoneyDirection;
  amount_gbp: string | null;
}

/** A right or duty with a clock the letter starts (Rights Decay keeps it). */
export interface LetterClock {
  id: string;
  label: string;
  expires_on: string; // YYYY-MM-DD
}

/** One fact vision was not sure of; the question is read back before anything else. */
export interface LetterUnsure {
  key: string; // e.g. "due_date"
  question: string;
}

export interface LetterReading {
  kind: LetterKind;
  sender: string;
  date: string | null; // YYYY-MM-DD when read
  says: string;
  money: LetterMoney;
  must_do: string;
  by: string | null; // YYYY-MM-DD, when there is a deadline
  clocks: LetterClock[];
  unsure: LetterUnsure[];
  /** The whole reading as Tempo would say it, in `language`, Flesch >= 60. */
  reading_text: string;
  language: string; // a code in tempo_core.voice_profile.LANGUAGES ("en", "hi", ...) or BCP 47
  /** True only on a hand-written reading; the committed fixtures were recorded from the Gateway. */
  sample?: boolean;
  /** Set by the Gateway when vision was replayed (replay mode). */
  simulated?: string[];
}

export interface SampleLetter {
  id: string;
  title: string;
  description: string;
  reading: LetterReading;
}

export interface LettersFixture {
  recorded_at: string;
  source: string;
  letters: SampleLetter[];
}

/** `POST /letters/read` body: the photo, as Mission Control already sends a card. */
export interface ReadLetterRequest {
  image_b64: string;
  filename: string;
  user_id?: string;
  display_name?: string;
  language?: string;
}

/** `POST /letters/reply`: your words in, a plain formal reply out, adding no facts. */
export interface ReplyRequest {
  reading: LetterReading;
  said: string;
  display_name?: string;
}

export interface ReplyDraft {
  draft: string;
  /** What the drafter promises: it used only the reading and the person's words. */
  adds_no_facts: boolean;
  language: string;
}

export function kindWords(kind: string): string {
  return (KIND_WORDS as Record<string, string>)[kind] ?? KIND_WORDS.unknown;
}

export function directionWords(direction: string): string {
  return (DIRECTION_WORDS as Record<string, string>)[direction] ?? DIRECTION_WORDS.none;
}

export function longDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * A reply drafted in the browser from the reading and the person's own words, nothing else
 * (the Decision Challenger's rule). Used in showcase mode, where there is no Gateway.
 */
export function draftReplyLocally(reading: LetterReading, said: string, displayName?: string): ReplyDraft {
  const about = reading.date ? `your letter of ${longDate(reading.date)}` : "your recent letter";
  const lines = [
    `Dear ${reading.sender},`,
    "",
    `I am writing about ${about}, which I understand is ${lowerFirst(kindWords(reading.kind))}.`,
    "",
    ...said.trim().split(/\n+/).map((p) => p.trim()).filter(Boolean),
    "",
    "Please reply in writing. Thank you.",
    "",
    "Yours faithfully,",
    displayName?.trim() || "[your name]",
  ];
  return { draft: lines.join("\n"), adds_no_facts: true, language: reading.language };
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
