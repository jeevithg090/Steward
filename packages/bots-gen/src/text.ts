/** Small text helpers shared by the generator, the judge and the converters. */

/** A directory id: lowercase letters, digits and single hyphens, at most `max` characters. */
export function slugify(text: string, max = 64): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const cut = slug.slice(0, max);
  return cut.replace(/-+$/g, "") || "bot";
}

/** First letter up, the rest left alone, ending in a full stop. */
export function sentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const capped = flat[0]!.toUpperCase() + flat.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** Words a small model writes in lowercase that a listing should show as people write them. */
const NAME_WORDS: Record<string, string> = {
  api: "API",
  cc: "CC",
  cv: "CV",
  dm: "DM",
  ira: "IRA",
  json: "JSON",
  nhs: "NHS",
  pdf: "PDF",
  seo: "SEO",
  sql: "SQL",
  uk: "UK",
  wifi: "Wi-Fi",
};

/**
 * A listing name in sentence case: "cc flagger" → "CC flagger", "wifi security" → "Wi-Fi security".
 * Only the first letter and the known short forms change, so "iPhone helper" and "Rent scout" stay.
 */
export function displayName(text: string): string {
  const flat = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]+\b/g, (word) => NAME_WORDS[word] ?? word);
  if (!flat || !/^[a-z]/.test(flat) || /^[a-z]+[A-Z]/.test(flat)) return flat;
  return flat[0]!.toUpperCase() + flat.slice(1);
}

/** Cuts at a sentence end when one fits, else at a word, so a pitch never ends mid-word. */
export function truncateAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (lastStop > max * 0.5) return head.slice(0, lastStop + 1);
  const lastSpace = head.lastIndexOf(" ");
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).replace(/[,;:]$/, "")}…`;
}

export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(?:\s|$)/.exec(flat);
  return match?.[1] ?? flat;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "with",
  "that",
  "this",
  "from",
  "into",
  "what",
  "can",
  "who",
  "are",
  "not",
  "one",
  "each",
  "them",
  "they",
  "its",
  "have",
  "has",
  "will",
  "when",
  "then",
  "than",
  "out",
  "all",
  "any",
  "about",
  "before",
  "after",
  "over",
  "under",
  "bot",
  "helps",
  "help",
  "person",
]);

/** Lowercase word tokens of three or more letters, stopwords removed. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && !STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

/** The overlap coefficient: shared tokens over the smaller set. 1 when one is inside the other. */
export function overlap(a: Set<string>, b: Set<string>): number {
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / smaller;
}

/** True when the text is mostly Latin script, so a prompt written in another language is skipped. */
export function isMostlyLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return true;
  const other = letters.filter((ch) => !/[\p{Script=Latin}]/u.test(ch)).length;
  return other / letters.length < 0.2;
}

const VERB_TO_ROLE: Record<string, string> = {
  find: "finder",
  chase: "chaser",
  plan: "planner",
  track: "tracker",
  write: "writer",
  draft: "drafter",
  check: "checker",
  compare: "comparer",
  book: "booker",
  review: "reviewer",
  sort: "sorter",
  watch: "watcher",
  remind: "reminder",
  summarise: "summariser",
  summarize: "summariser",
  research: "researcher",
  translate: "translator",
  organise: "organiser",
  organize: "organiser",
  teach: "tutor",
  explain: "explainer",
  monitor: "monitor",
  prepare: "prep",
  build: "builder",
  make: "maker",
  keep: "keeper",
  turn: "converter",
  fill: "form filler",
  run: "runner",
  pick: "picker",
  help: "helper",
  tell: "briefer",
  go: "reviewer",
  work: "calculator",
  set: "setup",
  read: "reader",
  clean: "cleaner",
  put: "assembler",
  log: "logger",
  practise: "coach",
  practice: "coach",
  play: "game host",
  invent: "inventor",
  suggest: "suggester",
  unsubscribe: "unsubscriber",
  reply: "replier",
  clear: "clearer",
  block: "blocker",
  scale: "scaler",
  convert: "converter",
  profile: "profiler",
  test: "tester",
  look: "lookout",
  be: "host",
  give: "briefer",
  decide: "decider",
  rebalance: "rebalancer",
  spot: "spotter",
};

const FILLERS = new Set([
  "me",
  "my",
  "a",
  "an",
  "the",
  "please",
  "up",
  "out",
  "for",
  "to",
  "of",
  "and",
  "with",
  "our",
  "us",
  "some",
  "any",
  "this",
  "these",
  "that",
  "it",
  "in",
  "on",
  "at",
  "by",
  "from",
  "into",
  "through",
  "all",
  "every",
  "each",
  "i",
  "we",
  "its",
]);

const CUTOFFS = new Set([
  "i",
  "that",
  "which",
  "who",
  "when",
  "where",
  "so",
  "before",
  "after",
  "if",
  "and",
  "but",
  "without",
  "while",
]);

/**
 * A short name from a job sentence: "find me a flat I can afford" → "Flat finder", "chase the
 * invoice that is 30 days late" → "Invoice chaser". Deterministic; the person can rename it.
 */
export function nameFromJob(job: string): string {
  const words = job
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const verbAt = words.findIndex((w) => VERB_TO_ROLE[w] !== undefined);
  const verb = verbAt >= 0 ? (words[verbAt] as string) : undefined;
  const rest = verbAt >= 0 ? words.slice(verbAt + 1) : words;
  const object: string[] = [];
  for (const word of rest) {
    if (CUTOFFS.has(word) && object.length > 0) break;
    if (FILLERS.has(word) || CUTOFFS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    object.push(word);
    if (object.length === 2) break;
  }
  const role = verb ? VERB_TO_ROLE[verb] : undefined;
  const parts = role ? [...object, role] : object.length > 0 ? object : ["helper"];
  const name = parts.join(" ");
  return (name[0]!.toUpperCase() + name.slice(1)).slice(0, 40).trim();
}
