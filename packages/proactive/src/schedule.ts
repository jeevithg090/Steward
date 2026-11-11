/*
 * Adapted from OpenDuet/openbot/server/src/routines/schedule.ts (MIT, CopilotKit).
 * Steward uses croner instead of cron-parser and keeps the same rules: five fields only, a known
 * IANA timezone, a floor checked from a fixed start, and a describer that falls back to the cron.
 */

import { ROUTINE_LIMITS } from "@steward/shared";
import { Cron } from "croner";

// The describer lives in @steward/shared so the routine form in the web app reads a schedule in the
// same words as the server.
export { describeSchedule } from "@steward/shared";

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

/**
 * The newest firing at or before `at`, and never before `from` (a firing already known to be due).
 * A server that slept through five hourly slots is late only for the last one, not the first.
 */
export function latestRun(schedule: string, timezone: string, from: Date, at: Date): Date {
  try {
    // croner looks strictly before its reference, to the second.
    const [latest] = cronFor(normalise(schedule), timezone).previousRuns(1, new Date(at.getTime() + 1000));
    if (latest && latest.getTime() <= at.getTime() && latest.getTime() > from.getTime()) return latest;
  } catch {
    // An unreadable schedule never got this far; `from` is the honest answer if it did.
  }
  return from;
}
