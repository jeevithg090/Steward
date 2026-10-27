/**
 * Dates in the person's own timezone. "Today" is always their today, never the server's: a brief
 * built on UTC would post New York's morning at eight the evening before.
 */

/** The timezone if the runtime knows it, else UTC. */
export function safeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function parts(date: Date, timeZone: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** `YYYY-MM-DD` for the given instant in the given timezone. */
export function localDate(timeZone: string, now: Date = new Date()): string {
  const p = parts(now, safeTimeZone(timeZone));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes the timezone is ahead of UTC at that instant. */
export function offsetMinutes(at: Date, timeZone: string): number {
  const p = parts(at, safeTimeZone(timeZone));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a local wall-clock time happens in a timezone. */
function localToInstant(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  // A second pass settles days where the offset changes (daylight saving).
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** Local midnight to the next local midnight, as ISO instants. */
export function dayBounds(date: string, timeZone: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Not a date: ${date}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const tz = safeTimeZone(timeZone);
  const from = localToInstant(y, m, d, tz);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const to = localToInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** "Tuesday 27 October 2026, 20:15", in the person's timezone. */
export function describeNow(timeZone: string, now: Date = new Date()): string {
  const tz = safeTimeZone(timeZone);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `${day.replace(",", "")}, ${time}`;
}
