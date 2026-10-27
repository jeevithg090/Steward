/**
 * Local-time helpers built on `Intl` alone. The brief is about the person's day, not the server's:
 * a UTC "today" posts New York's brief at 8 pm the evening before, and a UTC midnight cuts off the
 * evening's events. Everything here takes the configured IANA timezone explicitly.
 */

const knownZones = new Map<string, boolean>();

/** True when `Intl` can format in this IANA zone. Memoised because the sweep asks often. */
export function isKnownTimeZone(timeZone: string): boolean {
  const cached = knownZones.get(timeZone);
  if (cached !== undefined) return cached;
  let known = false;
  if (timeZone.trim() !== "") {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone });
      known = true;
    } catch {
      known = false;
    }
  }
  if (knownZones.size > 500) knownZones.clear();
  knownZones.set(timeZone, known);
  return known;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(at: Date, timeZone: string): ZonedParts {
  let format = partFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(timeZone, format);
  }
  const out: Record<string, number> = {};
  for (const part of format.formatToParts(at)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The calendar date (`YYYY-MM-DD`) of an instant in a timezone. */
export function localDate(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${String(p.year).padStart(4, "0")}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** True for a real `YYYY-MM-DD` date (not 2026-02-30). */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Milliseconds to add to UTC to get local wall time in `timeZone` at `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant local midnight begins `date` in `timeZone`. Two passes, so a date whose offset
 * differs from the offset at UTC midnight (a DST change that day) still lands on the right hour.
 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

/** The day after `date`, as `YYYY-MM-DD`. */
export function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** `[start, end)` of a local day, as instants. */
export function localDayBounds(date: string, timeZone: string): { from: Date; to: Date } {
  return { from: startOfLocalDay(date, timeZone), to: startOfLocalDay(nextDate(date), timeZone) };
}

/** `HH:MM` on a 24-hour clock in `timeZone`, or undefined when the time cannot be read. */
export function localTime(iso: string, timeZone: string): string | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  const p = zonedParts(at, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "Tuesday" for a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
