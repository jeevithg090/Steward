/** Wall-clock parts of an instant in a time zone. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function zonedParts(at: Date, tz: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local date (`YYYY-MM-DD`) of an instant in a time zone. "Today" is always the person's today. */
export function localDate(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight. */
export function localMinutes(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  return p.hour * 60 + p.minute;
}

/** `"08:30"` → 510. Returns `undefined` for anything else. */
export function parseClock(value: string): number | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** How far the zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(ms: number, tz: string): number {
  const p = zonedParts(new Date(ms), tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The instant a local wall-clock time happens in a zone (the earlier one across a DST overlap). */
export function zonedInstant(date: string, tz: string, minutes = 0): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = offsetAt(guess, tz);
  let t = guess - first;
  const second = offsetAt(t, tz);
  if (second !== first) t = guess - second;
  return new Date(t);
}

/** `[from, to)` covering one local day in a zone, as ISO instants. */
export function zonedDayRange(date: string, tz: string): { from: string; to: string } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDate = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  return { from: zonedInstant(date, tz).toISOString(), to: zonedInstant(nextDate, tz).toISOString() };
}
