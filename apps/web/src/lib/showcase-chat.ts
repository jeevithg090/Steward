// The chat door in showcase mode (plan.md §3, §4.1): a faithful TypeScript port of the Gateway's
// intent router (packages/tempo_core/src/tempo_core/intent.py), answering from the recorded
// missions. Both are checked against fixtures/chat/intents.json. The router is code, not a model:
// rules classify, regexes pull the facts out, and nothing here invents a number.
// `state` is the ShowcaseGateway, so a reply can start, answer or stop a recorded mission.
import type { ChatAction, ChatNeed, ChatReply, ChatTurn, Intent, LedgerTotals, MemoryCardData, MemoryItem, MissionView, SweepResult } from "./api";
import { fullStop, sweepSentence } from "./connectors";
import { type Language, SAMPLES, recordedVerdict, translatedSay } from "./shield";
import catalogJson from "@/showcase/catalog.json";
import sweepJson from "@/showcase/connectors-sweep.json";

export type Slots = Record<string, string | null>;

export interface ShowcaseChatState {
  missions(): Promise<MissionView[]>;
  start(body: Record<string, string>): Promise<MissionView>;
  startOfcom(body: Record<string, string>): Promise<MissionView>;
  answer(requestId: string, approved: boolean): Promise<MissionView>;
  stop(id: string): Promise<MissionView>;
  ledger(): Promise<LedgerTotals>;
  memories(userId: string): Promise<MemoryCardData>;
  /** The connectors' sweep (plan.md §14.2); the recorded one when the state has none. */
  sweep?(userId: string): Promise<SweepResult>;
}

const SIMULATED = ["company", "rail data", "jurors", "vision"];

/** Every recording was taken on this night; the showcase keeps its clock there so "yesterday" means the same thing every day. */
export const SHOWCASE_TODAY = "2026-10-25";

export const RAIL_FIELDS = ["origin_crs", "destination_crs", "travel_date", "departure", "fare_gbp"] as const;
export const VISIT_FIELDS = ["operator", "event_date"] as const;

/** The one question for each missing fact, in the Gateway's words (tempo_core.intent.QUESTIONS). */
export const QUESTIONS: Record<string, string> = {
  origin_crs: "Which station did you leave from?",
  destination_crs: "Where were you going?",
  travel_date: "What day was it?",
  departure: "What time did the train leave?",
  fare_gbp: "What did the ticket cost?",
  operator: "Which company was it?",
  event_date: "What day was the visit?",
};

// --- the station table (tempo_core.intent.STATIONS and ALIASES) ---------------------------------

export const STATIONS: Record<string, string> = {
  Oxford: "OXF", Paddington: "PAD", Reading: "RDG", Didcot: "DID", Banbury: "BAN",
  Slough: "SLO", Swindon: "SWI", "Bristol Temple Meads": "BRI", Cardiff: "CDF",
  "Birmingham New Street": "BHM", "Manchester Piccadilly": "MAN", Leeds: "LDS",
  Edinburgh: "EDB", "King's Cross": "KGX", Euston: "EUS", Waterloo: "WAT",
  Victoria: "VIC", "Liverpool Street": "LST", Marylebone: "MYB", "Bath Spa": "BTH",
}; // prettier-ignore

export const ALIASES: Record<string, string> = {
  "London Paddington": "PAD", "Didcot Parkway": "DID", Bristol: "BRI",
  "Cardiff Central": "CDF", Birmingham: "BHM", Manchester: "MAN",
  "Edinburgh Waverley": "EDB", "Kings Cross": "KGX", "London King's Cross": "KGX",
  "London Kings Cross": "KGX", "London Euston": "EUS", "London Waterloo": "WAT",
  "London Victoria": "VIC", "London Liverpool Street": "LST", "London Marylebone": "MYB",
  Bath: "BTH",
}; // prettier-ignore

const NAMES: Record<string, string> = Object.fromEntries(Object.entries({ ...STATIONS, ...ALIASES }).map(([k, v]) => [k.toLowerCase(), v]));
const CODES = new Set(Object.values(STATIONS));
// Also ordinary words: only a capital letter, "from/to" in front, or a very short text makes them a station.
const AMBIGUOUS = new Set(["reading", "bath", "victoria"]);

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STATION_RE = new RegExp(
  `\\b(${Object.keys(NAMES)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})\\b`,
  "gi",
);
const CRS_RE = new RegExp(`\\b(${[...CODES].sort().join("|")})\\b`, "g");

export function stationName(crs: string | null | undefined): string {
  if (!crs) return "";
  const code = crs.toUpperCase();
  return Object.entries(STATIONS).find(([, c]) => c === code)?.[0] ?? code;
}

// Providers whose engineers miss visits. Short names are case-sensitive so "ee" and "now" stay words.
const PROVIDERS: [string, RegExp][] = [
  ["Broadbandly", /\bbroadbandly\b/i],
  ["Virgin Media", /\bvirgin(?:\s+media)?\b/i],
  ["TalkTalk", /\btalk\s?talk\b/i],
  ["Vodafone", /\bvodafone\b/i],
  ["Plusnet", /\bplus\.?net\b/i],
  ["Openreach", /\bopenreach\b/i],
  ["BT", /\bBT\b|\b[Bb][Tt]\b(?=\s+(?:[Ee]ngineer|[Bb]roadband|[Aa]ppointment|[Vv]isit))/],
  ["EE", /\bEE\b/],
  ["Sky", /\bSky\b/],
  ["Now", /\bnow\s+(?:broadband|tv)\b/i],
];

// --- the words each rule looks for ----------------------------------------------------------------

const STOP = /^(?:please\s+|tempo,?\s+)?stop\b|\bstop\s+(?:everything|all|it|now|please|this|tempo)\b|\bcancel\s+everything\b/i;
const YES_CORE = new Set(["yes", "yeah", "yep", "yup", "ok", "okay", "approve", "approved", "sure", "ahead"]);
const YES_FILL = new Set(["go", "do", "it", "please", "thanks", "thank", "you", "tempo", "fine", "that's", "thats"]);
const NO_CORE = new Set(["no", "nope", "nah", "decline", "declined", "don't", "dont", "cancel", "not"]);
const NO_FILL = new Set(["thanks", "thank", "you", "please", "do", "leave", "it", "now", "tempo"]);
const YES_START = /^(?:yes|yeah|yep|yup|ok|okay|sure|approve|go ahead)\b/i;
const NO_START = /^(?:no|nope|nah|don't|do not|decline|not now|leave it|cancel)\b/i;
const WORD = /[a-z']+/g;

const URL =
  /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}\/\S+|\b(?:bit\.ly|rb\.gy|t\.co|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|cutt\.ly)\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|co\.uk|org\.uk|gov\.uk|uk|net|org|info|biz|xyz|top|click|link|online|site|live|shop)\b/i;
const SCAM_ASK =
  /\bscams?\b|\bscammers?\b|\bfraud\b|\bphishing\b|\bsuspicious\b|\bdodgy\b|\blegit\b|is (?:this|it|that) (?:real|genuine|true|right|safe|legit)|(?:got|received|had|sent|have) (?:a|an|this|another) (?:text|message|sms|email|e-mail|call|whatsapp|voicemail)|someone (?:texted|rang|called|phoned|emailed|messaged)|(?:this|the|a) (?:text|message|email) (?:says|said|saying)|\bcheck (?:this|that|the|my|a) (?:text|message|sms|email|link|number)/i;
// A pasted message: one strong pressure phrase, or two weak ones, is enough to check it.
const PRESSURE_STRONG =
  /safe account|one[- ]time (?:code|passcode|password)|\botp\b|\bpasscode\b|tax refund|you have won|\bprize\b|account (?:will be|has been|is|is being) (?:locked|suspended|closed|frozen|blocked)|verify your|confirm your (?:details|identity|account)|update your (?:details|account|payment)|legal action|\barrest\b|move your (?:money|savings|funds)|send (?:us|me) the code|read (?:me|out) the code/i;
const PRESSURE_WEAK =
  /\burgent(?:ly)?\b|\bimmediately\b|act now|within 24 hours|\bparcel\b|redeliver|click (?:here|the link|below)|unusual activity|suspicious activity|\bunpaid\b|outstanding (?:fee|payment|balance)|final (?:notice|warning)|congratulations|dear customer|\bexpires? (?:today|soon)|\bfee\b/gi;
const FORGET_WORD = /\b(?:forget|erase|delete)\b/i;
const FORGET = /\b(?:forget|erase|delete|remove)\b\s*(?:about\s+|that\s+|what you (?:know|remember) about\s+|the memory (?:about|of)\s+|everything about\s+)?([\s\S]*?)\s*[.!?]*$/i;
const RECALL = /\bremember\b|\bmemory\b|\bmemories\b|what do you know about me|what have you got on me|what do you have on me/i;
const LEDGER =
  /\bledger\b|how much (?:have|has|did) (?:you|tempo)\b.*\b(?:back|recovered|saved|won|got|made)\b|how much\b.*\bback\b|\bhours? (?:back|returned|saved)\b|\btotals?\b|\btally\b|what have you (?:got|won|saved)(?: me)? back|how (?:much|many)\b.*\b(?:saved|returned|recovered)\b/i;
const LETTER = /\bletters?\b|\bread (?:this|it|that|me)\b|read it to me|what does (?:this|it) say|\bphoto\b|\bcamera\b|\bscan\b|brown envelope|council tax|\bdwp\b|pip decision/i;
const VISIT_STRONG = /\bengineers?\b|missed (?:visit|appointment)|\bappointments?\b|\bvisit\b|\binstallation\b|no-show/i;
// "never came" is a visit unless a train is in the sentence
const VISIT_WEAK = /(?:didn't|did not|never|failed to|hasn't|has not) (?:turn(?:ed)? up|show(?:ed)?(?: up)?|come|came|arrive|arrived)|(?:no one|nobody|no-one) (?:came|turned up|showed up|arrived)/i;
const RAIL_STRONG = /\btrains?\b|\brail\b|\brailway\b|delay repay|\bplatform\b|\bcarriage\b/i;
const RAIL = /\btrains?\b|\blate\b|\bdelay(?:ed|s)?\b|\bcancell?ed\b|delay repay|\brail\b|\brailway\b|\bplatform\b|\bcarriage\b/i;
const ENTITLEMENT =
  /\bowed\b|\bbenefits?\b|pension credit|attendance allowance|\bentitled\b|\bentitlements?\b|universal credit|council tax (?:reduction|support)|winter fuel|\bpip\b|carer'?s allowance|housing benefit|what (?:can|could) i claim|am i (?:due|owed|missing)/i;
const PROFILES = /\bprofiles?\b|who (?:do|are) you work(?:ing)? for/i;
const HELP = /\bhelp\b|what can you do|how does this work|what do you do|what are you\b|what is tempo/i;
// The connectors' sweep (plan.md §14.2, intent.py _SWEEP). Checked before Scam Shield, so "check my
// email" is a sweep unless the text carries a link, pressure or a question about one message ("I got
// an email…"); "Am I owed anything?" stays an entitlement question unless her email, inbox or bank is named.
const SWEEP =
  /\bsweep\b|\b(?:check|look (?:through|at|in)|go through|search|scan) my (?:e-?mails?|inbox|mail(?:box)?|calendar|bank statements?)\b|\bfind (?:what|money|anything|everything)\b[\w\s']*\bowed\b/i;
const SWEEP_ALL = new RegExp(SWEEP.source, "gi");
const SWEEP_PLACE = /\b(?:e-?mails?|inbox|mailbox|bank)\b/i;
const OWED = /\bowed\b/i;

// --- the facts ------------------------------------------------------------------------------------

const TIME = /\b(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?![\d/])/gi;
const CLOCK = /\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/gi;
const THE_TIME = /\bthe\s+$/i;
const TIME_AFTER = /^\s*(?:train|service|from|to|out of|departure)\b/i;
const MONEY = "(\\d{1,4}(?:\\.\\d{1,2})?)";
const FARES: RegExp[] = [
  new RegExp(`£\\s?${MONEY}`, "g"),
  new RegExp(`${MONEY}\\s?(?:pounds?|quid|gbp)\\b`, "gi"),
  new RegExp(`(?:cost|costs|fare|paid|price|ticket was)\\s+(?:me\\s+)?(?:about\\s+|around\\s+)?(?:£\\s?)?${MONEY}\\b`, "gi"),
];
const NUMBER_WORDS: Record<string, number> = { an: 1, a: 1, one: 1, two: 2, three: 3, four: 4, "1": 1, "2": 2, "3": 3, "4": 4 };
const DELAY_MINUTES: RegExp[] = [
  /(\d{1,3})\s*(?:minutes?|mins?)\s*(?:late|delay(?:ed)?|behind)/i,
  /(?:late|delayed|delay)\s*(?:by|of)?\s*(?:about|around|nearly|over|almost)?\s*(\d{1,3})\s*(?:minutes?|mins?)\b/i,
];
const HOURS_LATE =
  /(an|a|one|two|three|four|[1-4])\s+hours?(\s+and\s+a\s+half)?\s+(?:late|delay)|(?:late|delayed|delay)\s*(?:by|of)?\s*(?:about|nearly|almost|over)?\s*(an|a|one|two|three|four|[1-4])\s+hours?(\s+and\s+a\s+half)?/i;
const HALF_HOUR_LATE = /half an hour\s+(?:late|delay)|(?:late|delayed|delay)\s*(?:by|of)?\s*half an hour/i;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+(\\d{4})\\b)?`, "i");
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, "i");
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/;
const WEEKDAY = /\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const RELATIVE: [RegExp, number][] = [
  [/day before yesterday/i, 2],
  [/\byesterday\b|last night/i, 1],
  [/\btoday\b|this (?:morning|afternoon|evening)|\btonight\b/i, 0],
];
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS: Record<string, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const NOTICE: RegExp[] = [/(\d{1,3})\s*hours?'?\s*(?:of\s+)?(?:notice|warning)/i, /(?:gave|given|with|got)\s+(?:me\s+|us\s+)?(?:only\s+)?(\d{1,3})\s*hours?\b/i];
const NO_NOTICE = /\bno (?:notice|warning)\b|without (?:any )?(?:notice|warning)|didn't (?:tell|warn|call|ring)|never (?:told|warned|called|rang)/i;
const ACCOUNT = /\b(?:account|ref(?:erence)?|customer)\s*(?:number|no\.?|ref(?:erence)?)?\s*(?:is|:|was)?\s*#?([A-Za-z]{1,4}-?\d{3,10}|\d{6,12})\b/i;
const FROM = /\b(?:from|leaving|left|out of)\s+$/i;
const TO = /\b(?:to|into|towards|for|reach(?:ing)?)\s+$/i;
const JOINERS = new Set(["to", "-", "–", "—", "→", "->"]);

// --- classification -------------------------------------------------------------------------------

function normalise(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/ /g, " ").split(/\s+/).filter(Boolean).join(" ");
}

function yesOrNo(text: string, pending: boolean): Intent | null {
  const words = new Set(text.toLowerCase().match(WORD) ?? []);
  const subset = (set: Set<string>, fill: Set<string>) => words.size > 0 && [...words].every((w) => set.has(w) || fill.has(w)) && [...words].some((w) => set.has(w));
  if (subset(YES_CORE, YES_FILL)) return "approve";
  if (subset(NO_CORE, NO_FILL)) return "decline";
  if (pending) {
    if (YES_START.test(text)) return "approve";
    if (NO_START.test(text)) return "decline";
  }
  return null;
}

function pressured(text: string): boolean {
  return PRESSURE_STRONG.test(text) || (text.match(PRESSURE_WEAK) ?? []).length >= 2;
}

/** intent.py `_sweep_like`: the sweep's words, or "owed" with her email, inbox or bank named; never a link, pressure or one message. */
function sweepLike(text: string): boolean {
  if (URL.test(text) || pressured(text) || SCAM_ASK.test(text.replace(SWEEP_ALL, " "))) return false;
  return SWEEP.test(text) || (OWED.test(text) && SWEEP_PLACE.test(text));
}

function visitLike(text: string): boolean {
  if (provider(text) !== null || VISIT_STRONG.test(text)) return true;
  return VISIT_WEAK.test(text) && !RAIL_STRONG.test(text);
}

/** Which door this sentence is for. `pending` is true when a consent ask is waiting, so "yes, go ahead" is an answer. */
export function classify(raw: string, pending = false): Intent {
  const text = normalise(raw);
  if (!text) return "help";
  if (STOP.test(text)) return "stop";
  const answer = yesOrNo(text, pending);
  if (answer) return answer;
  if (sweepLike(text)) return "sweep";
  if (URL.test(text) || SCAM_ASK.test(text) || pressured(text)) return "scam_check";
  if (FORGET_WORD.test(text)) return "memory_forget";
  if (RECALL.test(text)) return "memory_recall";
  if (LEDGER.test(text)) return "ledger";
  if (LETTER.test(text)) return "letter";
  if (visitLike(text)) return "missed_visit";
  const { masked } = fares(text);
  if (RAIL.test(text) || stationHits(text).length > 0 || time(masked, text) !== null) return "rail_delay";
  if (ENTITLEMENT.test(text)) return "entitlement";
  if (PROFILES.test(text)) return "profiles";
  if (HELP.test(text)) return "help";
  return "smalltalk";
}

// --- extraction -----------------------------------------------------------------------------------

type Hit = { start: number; end: number; crs: string };

function stationHits(text: string): Hit[] {
  const hits: Hit[] = [];
  const short = text.split(" ").length <= 3;
  STATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATION_RE.exec(text))) {
    const name = m[1]!;
    if (AMBIGUOUS.has(name.toLowerCase()) && name[0] !== name[0]!.toUpperCase() && !short) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      if (!(FROM.test(before) || TO.test(before))) continue;
    }
    hits.push({ start: m.index, end: m.index + name.length, crs: NAMES[name.toLowerCase()]! });
  }
  CRS_RE.lastIndex = 0;
  while ((m = CRS_RE.exec(text))) {
    const at = m.index;
    if (!hits.some((h) => h.start <= at && at < h.end)) hits.push({ start: at, end: at + m[1]!.length, crs: m[1]! });
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Origin and destination: "X to Y" first, then "from X" / "to Y", then order of mention. */
export function extractStations(raw: string): { origin: string | null; destination: string | null } {
  const text = normalise(raw);
  let hits = stationHits(text);
  let origin: string | null = null;
  let destination: string | null = null;
  for (let i = 0; i + 1 < hits.length; i++) {
    const a = hits[i]!;
    const b = hits[i + 1]!;
    if (JOINERS.has(text.slice(a.end, b.start).trim().toLowerCase())) {
      origin = a.crs;
      destination = b.crs;
      hits = hits.filter((h) => h !== a && h !== b);
      break;
    }
  }
  for (const h of hits) {
    const before = text.slice(Math.max(0, h.start - 12), h.start);
    if (origin === null && FROM.test(before)) origin = h.crs;
    else if (destination === null && TO.test(before)) destination = h.crs;
  }
  for (const h of hits) {
    if (h.crs === origin || h.crs === destination) continue;
    if (origin === null) origin = h.crs;
    else if (destination === null) destination = h.crs;
  }
  return { origin, destination };
}

function meridiem(hour: number, suffix: string | undefined): number | null {
  if (!suffix) return hour;
  if (hour < 1 || hour > 12) return null;
  const pm = suffix.toLowerCase().startsWith("p");
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The departure: HH:MM, 8.12, 8am or 8:12pm. `masked` has the fares blanked out, so £14.20 is never a quarter past two. */
function time(masked: string, text: string): string | null {
  const found: { start: number; end: number; value: string }[] = [];
  TIME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIME.exec(masked))) {
    const hour = meridiem(Number(m[1]), m[3]);
    const minute = Number(m[2]);
    if (hour !== null && hour <= 23 && minute <= 59) found.push({ start: m.index, end: m.index + m[0].length, value: `${pad(hour)}:${pad(minute)}` });
  }
  CLOCK.lastIndex = 0;
  while ((m = CLOCK.exec(masked))) {
    const hour = meridiem(Number(m[1]), m[2]);
    const at = m.index;
    if (hour !== null && !found.some((f) => f.start <= at && at < f.end)) found.push({ start: at, end: at + m[0].length, value: `${pad(hour)}:00` });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.start - b.start);
  for (const f of found) if (THE_TIME.test(text.slice(0, f.start)) || TIME_AFTER.test(text.slice(f.end))) return f.value;
  return found[0]!.value;
}

export function extractTime(raw: string): string | null {
  const text = normalise(raw);
  return time(fares(text).masked, text);
}

function money(raw: string): string {
  return Number(raw).toFixed(2);
}

/** Every fare said, first by position, and the text with those spans blanked out. */
function fares(text: string): { fares: string[]; masked: string } {
  const spans: { at: number; value: string }[] = [];
  let masked = text;
  for (const pattern of FARES) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      const at = m.index + m[0].lastIndexOf(m[1]!);
      if (spans.some((s) => s.at === at)) continue;
      spans.push({ at, value: money(m[1]!) });
      masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length);
    }
  }
  return { fares: spans.sort((a, b) => a.at - b.at).map((s) => s.value), masked };
}

/** "£28.40" → "28.40"; "28 pounds" → "28.00"; "cost me 6.50" → "6.50". The text's own figure, never a guess. */
export function extractFare(raw: string): string | null {
  return fares(normalise(raw)).fares[0] ?? null;
}

export function extractDelay(raw: string): string | null {
  const text = normalise(raw);
  for (const pattern of DELAY_MINUTES) {
    const m = pattern.exec(text);
    if (m) return String(Number(m[1]));
  }
  if (HALF_HOUR_LATE.test(text)) return "30";
  const m = HOURS_LATE.exec(text);
  if (m) {
    const word = (m[1] ?? m[3] ?? "").toLowerCase();
    const half = Boolean(m[2] ?? m[4]);
    const hours = NUMBER_WORDS[word];
    if (hours !== undefined) return String(hours * 60 + (half ? 30 : 0));
  }
  return null;
}

function valid(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** A day and month without a year is the most recent one: this year, unless that is still to come. */
function past(today: string, day: number, month: number, year: string | undefined): string | null {
  if (year !== undefined) return valid(Number(year), month, day);
  const thisYear = Number(today.slice(0, 4));
  const found = valid(thisYear, month, day);
  if (found !== null && found > today) return valid(thisYear - 1, month, day);
  return found;
}

function shift(today: string, days: number): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** A date in the text: ISO, today, yesterday, "on 23 October", "October 21", "23/10", "last Friday". */
export function extractDate(raw: string, today: string): string | null {
  const text = normalise(raw);
  let m = ISO_DATE.exec(text);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const [pattern, days] of RELATIVE) if (pattern.test(text)) return shift(today, days);
  m = DAY_MONTH.exec(text);
  if (m) return past(today, Number(m[1]), MONTHS[m[2]!.toLowerCase()]!, m[3]);
  m = MONTH_DAY.exec(text);
  if (m) return past(today, Number(m[2]), MONTHS[m[1]!.toLowerCase()]!, m[3]);
  m = SLASH_DATE.exec(text);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
    return past(today, Number(m[1]), Number(m[2]), year);
  }
  m = WEEKDAY.exec(text);
  if (m) {
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0, as Python counts
    let back = (weekday - WEEKDAYS[m[2]!.toLowerCase()]!) % 7;
    if (back < 0) back += 7;
    if (back === 0 && m[1]) back = 7;
    return shift(today, back);
  }
  return null;
}

function provider(text: string): string | null {
  for (const [name, pattern] of PROVIDERS) if (pattern.test(text)) return name;
  return null;
}

export function extractProvider(raw: string): string | null {
  return provider(normalise(raw));
}

function notice(text: string): string | null {
  for (const pattern of NOTICE) {
    const m = pattern.exec(text);
    if (m) return String(Number(m[1]));
  }
  return NO_NOTICE.test(text) ? "0" : null;
}

function account(text: string): string | null {
  const m = ACCOUNT.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

function forgetTarget(text: string): string | null {
  const m = FORGET.exec(text);
  if (!m) return null;
  const target = m[1]!.replace(/^[\s,;:]+|[\s,;:]+$/g, "");
  return target || null;
}

/** The facts for an intent (tempo_core.intent.extract then _only): every kept key present, null where the text did not say. */
export function extract(raw: string, intent: Intent, today = SHOWCASE_TODAY): Slots {
  const text = normalise(raw);
  const { fares: found, masked } = fares(text);
  const when = extractDate(text, today);
  const visit = intent === "missed_visit";
  const { origin, destination } = extractStations(text);
  const all: Slots = {
    origin_crs: origin,
    destination_crs: destination,
    travel_date: visit ? null : when,
    departure: time(masked, text),
    fare_gbp: found[0] ?? null,
    delay_minutes: extractDelay(text),
    operator: provider(text),
    event_date: visit ? when : null,
    notice_hours: notice(text),
    account_ref: account(text),
    forget_target: forgetTarget(text),
  };
  let keep: readonly string[] = [];
  if (intent === "rail_delay") keep = [...RAIL_FIELDS, "delay_minutes"];
  else if (intent === "missed_visit") keep = [...VISIT_FIELDS, "notice_hours", "account_ref"];
  else if (intent === "memory_forget") keep = ["forget_target"];
  return Object.fromEntries(keep.map((k) => [k, all[k] ?? null]));
}

/** Earlier turns' facts, with what this turn said on top (the server does the same with the echoed slots). */
export function mergeSlots(previous: Slots | undefined, fresh: Slots): Slots {
  const merged: Slots = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(fresh)) {
    if (value !== null && value !== undefined && value !== "") merged[key] = value;
    else if (!(key in merged)) merged[key] = null;
  }
  return merged;
}

/** The facts still needed for this door, each with its plain question, in the order to ask. */
export function missing(intent: Intent, slots: Slots): ChatNeed[] {
  const fields: readonly string[] = intent === "rail_delay" ? RAIL_FIELDS : intent === "missed_visit" ? VISIT_FIELDS : [];
  return fields.filter((f) => !slots[f]).map((f) => ({ field: f, question: QUESTIONS[f]! }));
}

export function firstMissing(intent: Intent, slots: Slots): ChatNeed | null {
  return missing(intent, slots)[0] ?? null;
}

// --- answering (mirrors apps/gateway/src/tempo_gateway/chat.py) --------------------------------

/** Every fixed sentence the chat can say, the Gateway's own words (chat.py CANNED; Flesch ≥ 60 there). */
export const CANNED = {
  nothing_waiting: "Nothing is waiting for your answer.",
  stopped: "Stopped. Nothing more will be sent.",
  nothing_running: "Nothing was running, so nothing was sent.",
  forget_what: "What should I forget? Say it in a few words.",
  ledger_empty: "Nothing yet. When a claim is paid, it shows here.",
  entitlement: "I can check what you might be owed. Answer ten quick questions and I'll show what is worth claiming, with the official page for each.",
  profiles_pick: "Pick one on the Profiles page, and I'll work that way for you.",
  letter: "Show me the letter: tap the camera button and I'll read it to you.",
  help: "I'm Tempo. I win back money and time you're owed. Tell me about a late train and I'll claim for you. Tell me about an engineer who never came. Paste a text you're not sure of and I'll check it. Show me a letter and I'll read it. Ask what I remember, or say forget. Ask how much I've got back. Say stop at any time.",
  smalltalk: "I'm Tempo. I win back money and time you're owed. Tell me about a late train, a missed engineer visit, or a text you're unsure of.",
  late_train: "Sorry about the train.",
  missed_visit: "Sorry they didn't come.",
  started: "I've started on it.",
  showcase_scam: "There's no Gateway in the showcase, so I can only check the sample messages. Run Tempo locally to check your own.",
  showcase_forget: "In the showcase I can't forget anything for good: that needs a Gateway. The Memory page shows how Forget and Correct work.",
  demo_journeys: "This showcase only has the 08:12 from 23 October.",
} as const;

// --- suggestions and profile refusals (plan.md §12.2, chat.py SUGGESTIONS and profiles.refusal) --

/** chat.py LATE_TRAIN: the journey the replay recordings hold, in plain sentences. */
export const LATE_TRAIN = "My 08:12 train from Oxford to Paddington was 38 minutes late on 23 October. It cost £28.40.";
/** chat.py MISSED_VISIT. */
export const MISSED_VISIT = "The Broadbandly engineer did not come on 19 October. No one rang.";
/** chat.py SCAM_SAMPLE: a pasted message, quoted as it arrived. */
export const SCAM_SAMPLE = `Is this a scam? ${SAMPLES[0].text}`;

/** What the chat door suggests next (ChatReply.suggestions: ≤ 4, each ≤ 120 chars), as chat.py SUGGESTIONS. */
export const SUGGESTIONS = {
  /** After help and small talk: the doors. */
  doors: [LATE_TRAIN, MISSED_VISIT, SCAM_SAMPLE, "Am I owed anything?"],
  /** After a journey the recordings don't have. */
  demo_journey: [LATE_TRAIN],
  /** The fare question, for the recorded demo journey only. */
  demo_fare: ["£28.40"],
  /** After a profile refused to start a claim. */
  profiles: ["Show me my profiles"],
  /** After a claim that is paid. */
  paid: ["How much have you got back for me?", "What do you remember about me?"],
  /** After the ledger. */
  ledger: ["What do you remember about me?", "Am I owed anything?"],
} as const satisfies Record<string, readonly string[]>;

/** chat.py DEMO_JOURNEY: the recorded journey whose fare is offered as a chip. */
const DEMO_JOURNEY: Record<string, string> = { origin_crs: "OXF", destination_crs: "PAD", travel_date: "2026-10-23", departure: "08:12" };
const TRAIN_NOT_FOUND = "I couldn't find that train"; // how the rail workflow's Intake step declines
const SHOW_PROFILES = { label: "Show my profiles", href: "#/profiles" };

/** How a refusal names each capability (tempo_core.capabilities.IN_PLAIN_WORDS). */
export const IN_PLAIN_WORDS: Record<string, string> = {
  claim: "file a claim",
  call: "phone the company",
  accept_cash: "accept cash",
  accept_voucher: "accept vouchers",
  discuss_other_accounts: "talk about your other accounts",
  change_contract: "change your contract",
  share_personal_data: "share your details",
  escalate: "take this further",
};

/** The skill behind each claim door, as the catalogue names it (skills/<id>/skill.yaml). */
const CLAIM_SKILL: Partial<Record<Intent, string>> = { rail_delay: "clawback-uk-rail", missed_visit: "clawback-ofcom" };

interface CatalogProfile {
  id: string;
  name: string;
  may?: string[];
  limits?: { max_gbp_per_claim?: string };
  share?: { public?: boolean };
}

interface CatalogSkill {
  id: string;
  needs?: string[];
}

const CATALOG = catalogJson as unknown as { profiles: CatalogProfile[]; skills: CatalogSkill[] };

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/**
 * The profile refusal (plan.md §12.2, tempo_core.profiles.refusal): when the person's profile may
 * not do what this door's skill needs, nothing starts and the chat says why in plain words. Null
 * when the profile allows it (or there is no profile, or the catalogue does not know it).
 */
export function profileRefusal(profileId: string | null | undefined, intent: Intent): string | null {
  const skillId = CLAIM_SKILL[intent];
  if (!profileId || !skillId) return null;
  const profile = CATALOG.profiles.find((p) => p.id === profileId);
  const skill = CATALOG.skills.find((s) => s.id === skillId);
  if (!profile || !skill) return null;
  const may = new Set(profile.may ?? []);
  const lacking = (skill.needs ?? []).filter((need) => !may.has(need)).map((w) => IN_PLAIN_WORDS[w] ?? w.replaceAll("_", " "));
  if (lacking.length === 0) return null;
  const name = profile.name.replace(/[?!. ]+$/, ""); // "Am I Owed Anything?" reads as a name mid-sentence
  return `Your profile, ${name}, doesn't let me ${joinWords(lacking)}, so I haven't started. Choose another profile if you want me to ${lacking[0]}.`;
}

/**
 * The sentence an ask gains when the claim is above the profile's limit (tempo_harness.claims_guard
 * ask_note): Tempo still asks, and says why it is asking. Null within the limit or with no profile.
 */
export function limitNote(profileId: string | null | undefined, amountGbp: string | null | undefined): string | null {
  const cap = profileId ? CATALOG.profiles.find((p) => p.id === profileId)?.limits?.max_gbp_per_claim : undefined;
  if (cap === undefined || amountGbp === null || amountGbp === undefined) return null;
  return Number(amountGbp) > Number(cap) ? `This is above your profile's limit of £${cap}, so I'm asking you first.` : null;
}

const SLOT_FIELDS = ["origin_crs", "destination_crs", "travel_date", "departure", "fare_gbp", "delay_minutes", "operator", "event_date", "notice_hours", "account_ref", "forget_target"] as const;
const BARE_NUMBER = /^£?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:pounds?|quid|gbp)?\.?$/i;
const CHECK_PREFIX = /^\s*check\s*[:-]?\s+/i;
const MISSIONS_ACTION = { label: "Open Mission Control", href: "#/missions" };
const MEMORY_ACTION = { label: "Open the Memory Card", href: "#/memory" };
const CONNECTORS_ACTION = { label: "Open Connectors", href: "#/connectors" };
// tempo_memory.provider.SPOKEN_BY: where a memory came from, in plain words.
const SPOKEN_BY: Record<string, string> = { user_voice: "you said, by voice", user_sms: "you texted", user_web: "you entered online", official_api: "official data" };
const TERMINAL = new Set(["declined", "failed_safe", "verified", "completed"]);

/** What the client echoed, as the full slot dict the Gateway returns (unknown keys dropped, missing ones null). */
function knownSlots(echoed: Slots | undefined): Slots {
  return Object.fromEntries(SLOT_FIELDS.map((f) => [f, echoed?.[f] ?? null]));
}

function hasAny(slots: Slots, fields: readonly string[]): boolean {
  return fields.some((f) => Boolean(slots[f]));
}

/** An answer to the one question has no door words of its own ("28.40", "19 October"): the echoed slots say which flow it continues. */
function continued(known: Slots, text: string, today: string): Intent | null {
  if (hasAny(known, RAIL_FIELDS)) {
    const found = extract(text, "rail_delay", today);
    if (Object.values(found).some(Boolean) || BARE_NUMBER.test(text.trim())) return "rail_delay";
  }
  if (hasAny(known, VISIT_FIELDS)) {
    const found = extract(text, "missed_visit", today);
    if (Object.values(found).some(Boolean)) return "missed_visit";
  }
  return null;
}

/** A lone station after the origin is known is the destination; a bare number when the fare is missing is the fare. */
function aimed(known: Slots, found: Slots, text: string, intent: Intent): Slots {
  if (intent !== "rail_delay") return found;
  const updates: Slots = {};
  if (found.origin_crs && !found.destination_crs && known.origin_crs && !known.destination_crs) {
    updates.origin_crs = null;
    updates.destination_crs = found.origin_crs;
  }
  if (!found.fare_gbp && !known.fare_gbp) {
    const bare = BARE_NUMBER.exec(text.trim());
    if (bare) updates.fare_gbp = money(bare[1]!);
  }
  return { ...found, ...updates };
}

function spokenDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** What Tempo has so far, read back before the one question, so a slip is caught early. */
export function understood(intent: Intent, slots: Slots): string {
  if (intent === "missed_visit") {
    if (slots.operator && slots.event_date) return `The ${slots.operator} visit on ${spokenDate(slots.event_date)}.`;
    if (slots.operator) return `The ${slots.operator} visit.`;
    if (slots.event_date) return `The visit on ${spokenDate(slots.event_date)}.`;
    return CANNED.missed_visit;
  }
  const parts = [slots.departure ? `Your ${slots.departure}` : "Your train"];
  if (slots.origin_crs) parts.push(`from ${stationName(slots.origin_crs)}`);
  if (slots.destination_crs) parts.push(`to ${stationName(slots.destination_crs)}`);
  if (slots.travel_date) parts.push(`on ${spokenDate(slots.travel_date)}`);
  if (parts.length === 1 && !slots.departure) return CANNED.late_train;
  return `${parts.join(" ")}.`;
}

function ledgerSentence(ledger: LedgerTotals): string {
  const gbp = Number(ledger.gbp_recovered);
  const minutes = Number(ledger.minutes_returned);
  if (!gbp && !minutes) return CANNED.ledger_empty;
  const shown = Number.isInteger(minutes) ? String(minutes) : ledger.minutes_returned;
  return `So far Tempo has got back £${ledger.gbp_recovered} and ${shown} minutes of your time.`;
}

/** tempo_memory.service.Recalled: what the chat door returns for "what do you remember". */
interface Recalled {
  kind: "memory" | "fact";
  id: string;
  text: string;
  source: string;
  when: string;
}

function recall(card: MemoryCardData, limit = 5): Recalled[] {
  const memories: Recalled[] = Object.values(card.memories)
    .flat()
    .map((e) => e.item)
    .map((i) => ({ kind: "memory", id: i.id, text: i.text, source: SPOKEN_BY[i.source] ?? i.source, when: i.observed_at }));
  const now = Date.now();
  const facts: Recalled[] = card.timeline
    .filter((f) => Date.parse(f.valid_from) <= now && (!f.valid_to || Date.parse(f.valid_to) > now))
    .map((f) => ({ kind: "fact", id: f.id, text: `${f.subject} ${f.predicate.replaceAll("_", " ")} ${f.object}`, source: "Tempo's records", when: f.valid_from }));
  return [...memories, ...facts].sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).slice(0, limit);
}

function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** tempo_memory.service.say_recalled: one line each, with where it came from and the day. */
export function sayRecalled(recalled: Recalled[]): string {
  if (recalled.length === 0) return "I don't remember anything about you yet.";
  return `Here's what I remember: ${recalled.map((r) => `${r.text} (${r.source}, ${shortDay(r.when)})`).join("; ")}.`;
}

function reply(partial: Partial<ChatReply> & { intent: Intent; reply: string; slots: Slots }): ChatReply {
  return {
    say: partial.reply,
    needs: null,
    mission: null,
    ask: null,
    verdict: null,
    memories: null,
    ledger: null,
    flags: null,
    actions: null,
    suggestions: null,
    simulated: SIMULATED,
    ...partial,
  };
}

function missionAction(view: MissionView): ChatAction {
  return { label: "Open Mission Control", href: `#/missions/${view.id}` };
}

const RECORDED_VISIT = { operator: "broadbandly", event_date: "2026-10-19" };

/** The earlier claim for the same recorded journey or visit, still live or paid (chat.py `_existing`). */
async function existingClaim(intent: Intent, slots: Slots, userId: string, state: ShowcaseChatState): Promise<ChatReply | null> {
  const recorded =
    intent === "rail_delay"
      ? Object.entries(DEMO_JOURNEY).every(([k, v]) => k === "fare_gbp" || slots[k] === v)
      : (slots.operator ?? "").replace(/\s+/g, "").toLowerCase() === RECORDED_VISIT.operator && slots.event_date === RECORDED_VISIT.event_date;
  if (!recorded) return null;
  const kind = intent === "rail_delay" ? "rail" : "ofcom";
  const mine = (await state.missions()).filter((m) => (!m.user_id || m.user_id === userId) && (m.skill_id ?? "").includes(kind));
  const view = mine.find((m) => m.state !== "declined" && m.state !== "failed_safe");
  if (!view) return null;
  const outcome = (view.outcome as { message?: string } | null)?.message ?? view.message ?? "";
  const words =
    view.state === "awaiting_consent"
      ? "I'm already on this one. It needs your OK."
      : view.state === "verified"
        ? `I already claimed this one. ${outcome}`.trim()
        : view.state === "completed"
          ? `I've already dealt with this one. ${outcome}`.trim()
          : "I'm already on this one. I'm waiting for the money.";
  return reply({
    intent, reply: words, slots: {}, mission: view, ask: view.ask ?? null, actions: [missionAction(view)],
    ...(view.state === "verified" ? { suggestions: ["How much have you got back for me?"] } : {}),
  });
}

/** A late train or a missed visit: start it when every fact is in, else ask one question (chat.py `_claim`). */
async function claim(intent: Intent, turn: ChatTurn, known: Slots, state: ShowcaseChatState, today: string): Promise<ChatReply> {
  const found = extract(turn.text, intent, today);
  const slots = mergeSlots(known, aimed(known, found, turn.text, intent));
  // A profile that can't run this skill is refused first, so no question is wasted on it; the facts stay.
  const refused = profileRefusal(turn.profile_id, intent);
  if (refused) return reply({ intent, reply: refused, slots, actions: [SHOW_PROFILES], suggestions: [...SUGGESTIONS.profiles] });
  const need = firstMissing(intent, slots);
  if (need) {
    const said = `${understood(intent, slots)} ${need.question}`;
    const demoFare = need.field === "fare_gbp" && Object.entries(DEMO_JOURNEY).every(([k, v]) => slots[k] === v);
    return reply({ intent, reply: said, slots, needs: [need], ...(demoFare ? { suggestions: [...SUGGESTIONS.demo_fare] } : {}) });
  }
  // chat.py: never the same claim twice. The recordings hold one journey and one visit, so a live or
  // paid mission of the same kind for the recorded facts is the same claim: answer with it.
  const same = await existingClaim(intent, slots, turn.user_id, state);
  if (same) return same;
  const person = { user_id: turn.user_id, display_name: turn.display_name ?? "Friend", time_value_gbp_h: "18", ...(turn.profile_id ? { profile_id: turn.profile_id } : {}) };
  const view =
    intent === "rail_delay"
      ? await state.start({ ...person, origin_crs: slots.origin_crs!, destination_crs: slots.destination_crs!, travel_date: slots.travel_date!, departure: slots.departure!, fare_gbp: slots.fare_gbp! })
      : await state.startOfcom({
          ...person,
          operator: slots.operator!,
          event_date: slots.event_date!,
          ...(slots.notice_hours ? { notice_hours: slots.notice_hours } : {}),
          ...(slots.account_ref ? { account_ref: slots.account_ref } : {}),
        });
  if (intent === "rail_delay" && (view.state === "declined" || view.state === "failed_safe") && (view.message ?? "").startsWith(TRAIN_NOT_FOUND)) {
    // chat.py _not_found: say which journey, from the person's own facts; the slots stay so a corrected date starts again.
    const said = `I couldn't find the ${slots.departure} from ${stationName(slots.origin_crs)} to ${stationName(slots.destination_crs)} on ${spokenDate(slots.travel_date ?? "")} in the rail records. ${CANNED.demo_journeys}`;
    return reply({ intent, reply: said, slots, mission: view, actions: [missionAction(view)], suggestions: [...SUGGESTIONS.demo_journey] });
  }
  const note = view.ask ? limitNote(turn.profile_id, view.ask.amount_gbp) : null;
  if (note && view.ask) {
    view.ask = { ...view.ask, summary: `${view.ask.summary} ${note}` };
    view.message = view.ask.summary;
  }
  const said = view.ask?.summary ?? view.message ?? CANNED.started;
  return reply({ intent, reply: said, slots: {}, mission: view, ask: view.ask, actions: [missionAction(view)], ...(view.state === "verified" ? { suggestions: [...SUGGESTIONS.paid] } : {}) });
}

/** The showcase's chat door: the Gateway's rules, answered from the recordings (chat.py `Chat.turn`). */
export async function showcaseChat(turn: ChatTurn, state: ShowcaseChatState): Promise<ChatReply> {
  const text = turn.text;
  const language = (turn.language ?? "en") as Language;
  const today = SHOWCASE_TODAY;
  const missions = (await state.missions()).filter((m) => !m.user_id || m.user_id === turn.user_id);
  const pending = missions.filter((m) => m.ask);
  const known = knownSlots(turn.slots);
  let intent = classify(text, pending.length > 0);
  if (intent === "smalltalk") intent = continued(known, text, today) ?? intent;
  const plain = (said: string, extra: Partial<ChatReply> = {}) => reply({ intent, reply: said, slots: known, ...extra });

  switch (intent) {
    case "rail_delay":
    case "missed_visit":
      return claim(intent, turn, known, state, today);
    case "approve":
    case "decline": {
      // GET /missions lists newest first, so the newest pending ask is the first one (chat.py takes the last of an oldest-first list).
      const newest = pending[0];
      if (!newest?.ask) return plain(CANNED.nothing_waiting);
      const view = await state.answer(newest.ask.request_id, intent === "approve");
      return plain(view.message ?? CANNED.started, { mission: view, ask: view.ask, actions: [missionAction(view)], ...(view.state === "verified" ? { suggestions: [...SUGGESTIONS.paid] } : {}) });
    }
    case "stop": {
      if (missions.length === 0) return plain(CANNED.nothing_running);
      let view: MissionView | null = null;
      for (const m of missions) view = TERMINAL.has(m.state) ? m : await state.stop(m.id);
      return plain(CANNED.stopped, { mission: view, actions: [MISSIONS_ACTION] });
    }
    case "scam_check": {
      const message = text.replace(CHECK_PREFIX, "") || text;
      // A sweep's scam finding quotes the email without the "HMRC:" its text message starts with (tempo_core.findings.scam_say).
      const sample = SAMPLES.find((s) => message.trim() === s.text || message.includes(s.text) || message.includes(s.text.replace(/^[A-Z]{2,10}:\s*/, "")));
      if (!sample) return plain(CANNED.showcase_scam, { actions: [{ label: "Open Scam Shield", href: "#/shield" }] });
      const verdict = recordedVerdict(sample.id);
      if (language !== "en") verdict.say = translatedSay(verdict, language);
      verdict.language = language;
      return plain(verdict.say, { verdict: verdict as unknown as Record<string, unknown>, actions: [{ label: "Open Scam Shield", href: "#/shield" }] });
    }
    case "memory_recall": {
      const recalled = recall(await state.memories(turn.user_id));
      return plain(sayRecalled(recalled), { memories: recalled as unknown as MemoryItem[], actions: [MEMORY_ACTION] });
    }
    case "memory_forget": {
      const target = extract(text, intent, today).forget_target;
      if (!target) return plain(CANNED.forget_what);
      return plain(CANNED.showcase_forget, { actions: [MEMORY_ACTION] });
    }
    case "ledger": {
      const totals = await state.ledger();
      return plain(ledgerSentence(totals), { ledger: totals, actions: [MISSIONS_ACTION], suggestions: [...SUGGESTIONS.ledger] });
    }
    case "entitlement":
      return plain(CANNED.entitlement, { actions: [{ label: "Answer ten questions", href: "#/owed" }] });
    case "profiles": {
      const names = CATALOG.profiles.filter((p) => p.share?.public).map((p) => p.name);
      const said = names.length ? `Tempo can work as: ${names.join(", ")}. ${CANNED.profiles_pick}` : "No profiles are installed yet.";
      return plain(said, { actions: [{ label: "Open Profiles", href: "#/profiles" }] });
    }
    case "letter":
      return plain(CANNED.letter, { actions: [{ label: "Read a letter", href: "#/read" }] });
    case "sweep": {
      // chat.py `_sweep`: the sweep reads the connected places and lists what it found; nothing is started.
      const result = state.sweep ? await state.sweep(turn.user_id) : (structuredClone(sweepJson) as unknown as SweepResult);
      const said = sweepSentence(result);
      const spoken = [said, ...result.findings.map((f) => fullStop(f.title))].join(" ");
      return plain(said, {
        say: spoken,
        findings: result.findings,
        actions: [CONNECTORS_ACTION],
        suggestions: result.findings.length ? result.findings.map((f) => f.say).slice(0, 4) : null,
      });
    }
    case "help":
      return plain(CANNED.help, { actions: [MISSIONS_ACTION], suggestions: [...SUGGESTIONS.doors] });
    default:
      return plain(CANNED.smalltalk, { suggestions: [...SUGGESTIONS.doors] });
  }
}
