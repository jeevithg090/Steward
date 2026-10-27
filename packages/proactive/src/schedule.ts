/*
 * Adapted from OpenDuet/openbot/server/src/routines/schedule.ts (MIT, CopilotKit).
 * Steward uses croner instead of cron-parser and keeps the same rules: five fields only, a known
 * IANA timezone, a floor checked from a fixed start, and a describer that falls back to the cron.
 */

import { ROUTINE_LIMITS } from "@steward/shared";
import { Cron } from "croner";
import { ProactiveError } from "./errors.ts";
import { isKnownTimeZone } from "./time.ts";

export const MIN_INTERVAL_MS = ROUTINE_LIMITS.minIntervalMinutes * 60_000;

export const SCHEDULE_MESSAGES = {
  unreadable:
    "That schedule could not be read. Use five fields: minute hour day month weekday, like 0 8 * * 1-5.",
  unknownTimezone: "That is not a timezone I know. Use a name like Europe/London or America/New_York.",
  neverRuns: "That schedule never runs. Check the day and month.",
  tooOften: `Routines may run at most every ${ROUTINE_LIMITS.minIntervalMinutes} minutes.`,
} as const;

/**
 * Where the floor scan starts. Fixed, so whether a schedule is accepted is a property of the
 * schedule, not of the clock when somebody asked: `45,55 8 * * *` asked about at 08:50 sees 08:55 and
 * then tomorrow's 08:45, a gap of almost a day, and a check sampled from "now" would let it through.
 * A leap year, so a schedule pinned to 29 February is scanned on a day it fires.
 */
const FLOOR_SCAN_START = new Date("2024-01-01T00:00:00Z");

/**
 * Firings the floor scan walks. Every day a schedule fires has the same pattern of minutes and
 * hours, so the first firing day shows every gap within a day; the densest day the floor allows is
 * 96 firings, and 200 covers that day plus the wrap into the next one. (About 50 would do for most
 * shapes; the extra cost is a few hundred microseconds, paid once per schedule.)
 */
const FLOOR_SCAN_FIRINGS = 200;

const floorVerdicts = new Map<string, string | null>();

function normalise(schedule: string): string {
  return schedule.trim().split(/\s+/).join(" ");
}

function cronFor(schedule: string, timezone: string): Cron {
  return new Cron(schedule, { timezone, mode: "5-part", paused: true });
}

/**
 * Checks a schedule and returns it with single spaces. Throws a `ProactiveError` with a sentence
 * a person can act on when it is unreadable, in an unknown timezone, never fires, or can fire more
 * often than the floor.
 */
export function checkSchedule(schedule: string, timezone: string): string {
  const cron = normalise(typeof schedule === "string" ? schedule : "");
  // croner also takes nicknames and six or seven fields; the contract is five fields, nothing else.
  if (cron.split(" ").length !== 5 || cron.includes("@")) {
    throw new ProactiveError("invalid", SCHEDULE_MESSAGES.unreadable);
  }
  if (!isKnownTimeZone(timezone)) throw new ProactiveError("invalid", SCHEDULE_MESSAGES.unknownTimezone);

  const key = `${timezone}\u0000${cron}`;
  let verdict = floorVerdicts.get(key);
  if (verdict === undefined) {
    verdict = scan(cron, timezone);
    if (floorVerdicts.size > 1000) floorVerdicts.clear();
    floorVerdicts.set(key, verdict);
  }
  if (verdict !== null) throw new ProactiveError("invalid", verdict);
  return cron;
}

/** The refusal for a schedule, or null when it is fine. */
function scan(cron: string, timezone: string): string | null {
  let firings: Date[];
  try {
    firings = cronFor(cron, timezone).nextRuns(FLOOR_SCAN_FIRINGS, FLOOR_SCAN_START);
  } catch {
    return SCHEDULE_MESSAGES.unreadable;
  }
  if (firings.length === 0) return SCHEDULE_MESSAGES.neverRuns;
  for (let i = 1; i < firings.length; i++) {
    const gap = firings[i]!.getTime() - firings[i - 1]!.getTime();
    if (gap < MIN_INTERVAL_MS) return SCHEDULE_MESSAGES.tooOften;
  }
  return null;
}

/**
 * The first firing strictly after `after`, in the schedule's timezone, or undefined when it never
 * fires again. When `previous` is given, a firing closer than the floor to it is skipped: the scan
 * above cannot see every daylight-saving squeeze, and this is the backstop at run time.
 */
export function nextRun(schedule: string, timezone: string, after: Date, previous?: Date): Date | undefined {
  try {
    const cron = cronFor(normalise(schedule), timezone);
    let next = cron.nextRun(after) ?? undefined;
    for (
      let guard = 0;
      next && previous && next.getTime() - previous.getTime() < MIN_INTERVAL_MS && guard < 100;
      guard++
    ) {
      next = cron.nextRun(next) ?? undefined;
    }
    return next;
  } catch {
    return undefined;
  }
}

// ── Plain words for a schedule ────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_ALIASES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_ALIASES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function plainInt(field: string, min: number, max: number): number | undefined {
  if (!/^\d{1,2}$/.test(field)) return undefined;
  const value = Number(field);
  return value >= min && value <= max ? value : undefined;
}

/** "A", "A and B", "A, B and C". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

/** The days a weekday field names (0 = Sunday; 7 is Sunday too), or undefined when it is stranger. */
function weekdays(field: string): number[] | undefined {
  const days = new Set<number>();
  for (const part of field.toLowerCase().split(",")) {
    const range = /^([a-z]{3}|\d)(?:-([a-z]{3}|\d))?$/.exec(part);
    if (!range) return undefined;
    const from = dayNumber(range[1]!);
    const to = range[2] === undefined ? from : dayNumber(range[2]);
    if (from === undefined || to === undefined) return undefined;
    // Sunday closing a range counts as 7, so FRI-SUN is Friday to Sunday.
    const end = range[2] !== undefined && to === 0 && from > 0 ? 7 : to;
    if (end < from) return undefined;
    for (let day = from; day <= end; day++) days.add(day % 7);
  }
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first, Sunday last
}

/** 0–7 for digits (7 is Sunday, kept as 7 so 0-7 reads as the whole week), 0–6 for names. */
function dayNumber(token: string): number | undefined {
  if (/^\d$/.test(token)) {
    const value = Number(token);
    return value <= 7 ? value : undefined;
  }
  return DAY_ALIASES[token];
}

function monthNumber(field: string): number | undefined {
  return plainInt(field, 1, 12) ?? MONTH_ALIASES[field.toLowerCase()];
}

function dayWords(days: number[]): string {
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "6,0") return "Weekends";
  if (days.length === 7) return "Every day";
  return joinWords(days.map((day) => `${DAY_NAMES[day]}s`));
}

/**
 * Plain words for a schedule: "Every day at 08:00", "Weekdays at 08:00", "Mondays at 09:30",
 * "Every hour", "Every 15 minutes". Shapes it does not know come back as the cron itself, never an
 * error: a describer that throws would take a page down over a schedule nobody could read anyway.
 */
export function describeSchedule(schedule: string): string {
  const cron = typeof schedule === "string" ? normalise(schedule) : "";
  try {
    const fields = cron.split(" ");
    if (fields.length !== 5) return cron;
    const [minuteField, hourField, domField, monthField, dowField] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    const everyDay = domField === "*" && monthField === "*" && dowField === "*";

    // */N * * * * — only when N divides the hour, or the gaps are not all N.
    const minuteStep = /^\*\/(\d{1,2})$/.exec(minuteField);
    if (everyDay && hourField === "*" && minuteStep) {
      const step = Number(minuteStep[1]);
      if (step > 1 && 60 % step === 0) return `Every ${step} minutes`;
      return cron;
    }

    const minute = plainInt(minuteField, 0, 59);

    // M * * * * and M */N * * *
    if (everyDay && minute !== undefined) {
      if (hourField === "*") return minute === 0 ? "Every hour" : `Every hour at ${minute} minutes past`;
      const hourStep = /^\*\/(\d{1,2})$/.exec(hourField);
      if (hourStep) {
        const step = Number(hourStep[1]);
        if (step > 1 && 24 % step === 0) {
          return minute === 0 ? `Every ${step} hours` : `Every ${step} hours at ${minute} minutes past`;
        }
        return cron;
      }
    }

    // Times of day: one minute with one or more hours, or several minutes in one hour.
    let times: string[] | undefined;
    if (minute !== undefined && /^\d{1,2}(,\d{1,2})*$/.test(hourField)) {
      const hours = hourField.split(",").map((h) => plainInt(h, 0, 23));
      if (hours.every((h): h is number => h !== undefined)) {
        times = [...new Set(hours)].sort((a, b) => a - b).map((h) => `${pad2(h)}:${pad2(minute)}`);
      }
    } else if (/^\d{1,2}(,\d{1,2})+$/.test(minuteField)) {
      const hour = plainInt(hourField, 0, 23);
      const minutes = minuteField.split(",").map((m) => plainInt(m, 0, 59));
      if (hour !== undefined && minutes.every((m): m is number => m !== undefined)) {
        times = [...new Set(minutes)].sort((a, b) => a - b).map((m) => `${pad2(hour)}:${pad2(m)}`);
      }
    }
    if (!times) return cron;
    const at = `at ${joinWords(times)}`;

    if (domField === "*" && monthField === "*") {
      if (dowField === "*") return `Every day ${at}`;
      const days = weekdays(dowField);
      return days && days.length > 0 ? `${dayWords(days)} ${at}` : cron;
    }

    const dom = plainInt(domField, 1, 31);
    if (dom !== undefined && dowField === "*") {
      if (monthField === "*") return `On the ${ordinal(dom)} of every month ${at}`;
      const month = monthNumber(monthField);
      if (month !== undefined) return `Every year on ${dom} ${MONTH_NAMES[month - 1]} ${at}`;
    }
    return cron;
  } catch {
    return cron;
  }
}
