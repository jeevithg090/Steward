/**
 * Wall-clock maths in a named time zone with nothing but `Intl`. The demo lives in Europe/London, so
 * "today at 09:30" has to mean 09:30 in London whether the server runs in UTC, in BST or in Tokyo,
 * and on both sides of a clock change.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// biome-ignore format: a compact table reads better than one entry per line
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: Math.max(0, short.indexOf(parts.weekday ?? "")),
  };
}

/** Minutes the zone is ahead of UTC at this instant (London: 0 in winter, 60 in summer). */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** `YYYY-MM-DD` of this instant in the zone. */
export function dateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Adds whole days to a `YYYY-MM-DD` key. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The instant a wall-clock time on a date happens in the zone. `time` is `HH:MM`. */
export function zonedTime(key: string, time: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMinutes(new Date(guess), timeZone);
  let t = guess - first * 60_000;
  const second = offsetMinutes(new Date(t), timeZone);
  if (second !== first) t = guess - second * 60_000;
  return new Date(t);
}

/** RFC 3339 in the zone's offset, as Google Calendar writes it: `2026-10-27T09:30:00Z`, `...+01:00`. */
export function rfc3339InZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const local = `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
  return local + offsetSuffix(offsetMinutes(date, timeZone));
}

/** RFC 2822 date for a mail `Date:` header: `Tue, 27 Oct 2026 09:14:00 +0000`. */
export function rfc2822Date(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const day = WEEKDAYS[p.weekday]?.slice(0, 3) ?? "Mon";
  const month = MONTHS[p.month - 1]?.slice(0, 3) ?? "Jan";
  const offset = offsetMinutes(date, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${day}, ${p.day} ${month} ${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** "Wednesday 28 October" for a date key. */
export function longDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

export function weekdayName(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "Monday";
}

export function monthName(month: number): string {
  return MONTHS[(((month - 1) % 12) + 12) % 12] ?? "January";
}

/** `HH:MM` of an instant in the zone. */
export function clock(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** `Z` for UTC, otherwise `+01:00` style. */
function offsetSuffix(offset: number): string {
  if (offset === 0) return "Z";
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
