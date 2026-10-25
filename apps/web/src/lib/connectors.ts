// Connectors in plain words (plan.md §14): where a finding came from, what a sweep read, and the
// sentence the chat door says after a sweep. Shared by the Connectors page, the chat's finding
// cards and the showcase's port of the chat door, so all three say the same thing.
import type { Finding, SweepResult } from "./api";

/** Where something was found: "from your email". Unknown connectors fall back to their id. */
const FROM_WORDS: Record<string, string> = {
  mail: "your email",
  email: "your email",
  calendar: "your calendar",
  bank: "your bank statement",
  rail: "the rail records",
};

/** What one item is called on each connector, singular and plural. */
const ITEM_WORDS: Record<string, [string, string]> = {
  mail: ["email", "emails"],
  email: ["email", "emails"],
  calendar: ["appointment", "appointments"],
  bank: ["payment", "payments"],
  rail: ["train looked up", "trains looked up"],
};

/** The order connectors are listed in when a sentence names them. */
const ORDER = ["mail", "email", "calendar", "bank", "rail"];

export function fromWords(connector: string): string {
  return FROM_WORDS[connector] ?? connector.replaceAll("_", " ");
}

/** "14 emails", "1 train looked up". */
export function itemsRead(connector: string, count: number): string {
  const [one, many] = ITEM_WORDS[connector] ?? ["item", "items"];
  return `${count} ${count === 1 ? one : many}`;
}

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function ordered(read: Record<string, number>): [string, number][] {
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return Object.entries(read).sort(([a], [b]) => rank(a) - rank(b));
}

/** "14 emails, 9 appointments, 31 payments and 1 train looked up". */
export function readSentence(read: Record<string, number>): string {
  return joinAnd(ordered(read).map(([id, n]) => itemsRead(id, n)));
}

// An item that names its own kind ("Email: HMRC: you are due…") would say it twice after "from your email".
const SELF_NAMED = /^(?:e-?mail|calendar|event|bank|payment|statement)\s*:\s*/i;

/** "from your email: Trainline e-ticket, 23 October". */
export function sourceLine(finding: Finding): string {
  return `from ${fromWords(finding.source.connector)}: ${finding.source.item.replace(SELF_NAMED, "")}`;
}

/** Where a sweep looked, as chat.py names it (tempo_gateway.connectors.PLACE): the rail records are not a place of hers. */
const PLACE: Record<string, string> = { mail: "email", email: "email", calendar: "calendar", bank: "bank" };
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** The places a sweep looked, in the config's order: email, calendar, bank. */
export function places(read: Record<string, number>): string[] {
  return [...new Set(ordered(read).flatMap(([id]) => (PLACE[id] ? [PLACE[id]] : [])))];
}

/** What the chat door says after a sweep (chat.py `sweep_sentence` and CANNED["sweep_nothing_on"]). */
export function sweepSentence(result: SweepResult): string {
  const where = places(result.read);
  if (where.length === 0) return "Nothing is connected, so I had nothing to read. Turn one on, on the Connectors page.";
  const joined = joinAnd(where);
  const count = result.findings.length;
  if (count === 0) return `I looked in your ${joined} and found nothing to do. I kept none of what I read.`;
  const spoken = COUNT_WORDS[count] ?? String(count);
  return `I found ${spoken} ${count === 1 ? "thing" : "things"} worth a look in your ${joined}. I kept none of what I read.`;
}

/** chat.py `_full_stop`: a title read aloud ends a sentence. */
export function fullStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
