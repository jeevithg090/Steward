/**
 * The data behind `show_choices`: quick replies the person can tap instead of typing.
 *
 * A chip is only ever a reply in words. It is never a way to say yes to sending, paying, signing or
 * deleting: those go through the approval card, which shows exactly what will happen. So a chip
 * that reads like consent to one of those ("Send it", "Yes, pay now", "Delete them") is dropped
 * here, whatever the model asked for.
 */

export interface Choice {
  /** What the chip says. */
  label: string;
  /** What is sent as the person's message. Usually the label itself. */
  message: string;
}

export interface ChoiceSet {
  question?: string;
  choices: Choice[];
}

export const MAX_CHOICES = 6;
const MAX_LABEL = 60;

const GATED_VERB = String.raw`(send|pay|sign|delete|remove|buy|purchase|transfer|submit|wire|refund|place\s+(the\s+|my\s+|an?\s+)?order)`;
/** "Send it", "Pay now", "Delete them all". */
const STARTS_WITH_GATED = new RegExp(String.raw`^(please\s+)?(go ahead and\s+)?${GATED_VERB}\b`, "i");
/** "Yes, send it", "OK to pay", "Confirm and delete", "Approve". */
const CONSENT_TO_GATED = new RegExp(
  String.raw`^(yes|yeah|yep|ok|okay|sure|confirm(ed)?|approve(d)?|go ahead|do it|allow)\b.*\b${GATED_VERB}`,
  "i",
);
const BARE_CONSENT = /^(approve|approved|confirm|confirmed|allow|allow it|authori[sz]e)\b[.!]?$/i;

/** Whether a chip would read as consent to send, pay, sign or delete. */
export function isConsentChoice(label: string): boolean {
  const text = label.trim();
  return STARTS_WITH_GATED.test(text) || CONSENT_TO_GATED.test(text) || BARE_CONSENT.test(text);
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (text === "") return undefined;
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/** Reads `show_choices` arguments: strings or `{ label, message? }`, distinct, consent-shaped ones dropped. */
export function readChoices(args: Record<string, unknown> | undefined): ChoiceSet {
  const raw = Array.isArray(args?.choices)
    ? args.choices
    : Array.isArray(args?.options)
      ? args.options
      : Array.isArray(args?.replies)
        ? args.replies
        : [];
  const seen = new Set<string>();
  const choices: Choice[] = [];
  for (const entry of raw) {
    const label =
      typeof entry === "string"
        ? clean(entry)
        : entry && typeof entry === "object"
          ? clean((entry as Record<string, unknown>).label ?? (entry as Record<string, unknown>).title)
          : undefined;
    if (!label || isConsentChoice(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const message =
      entry && typeof entry === "object"
        ? (clean((entry as Record<string, unknown>).message ?? (entry as Record<string, unknown>).value) ??
          label)
        : label;
    choices.push({ label, message: isConsentChoice(message) ? label : message });
    if (choices.length >= MAX_CHOICES) break;
  }
  const question = clean(args?.question ?? args?.prompt ?? args?.title);
  return question ? { question, choices } : { choices };
}
