import { CRON_DAY_ALIASES, CRON_MONTH_ALIASES, describeSchedule, ROUTINE_LIMITS } from "@steward/shared";

/**
 * A small five-field cron reader for the routine form: it describes a schedule in the same words the
 * server uses (one describer, in @steward/shared) and warns before the server refuses one that runs
 * too often. The server stays the judge; this only saves a round trip, so anything it cannot model
 * is let through to be checked on save rather than blocked here.
 */

export interface CronCheck {
  ok: boolean;
  /** Plain words: "Weekdays at 08:00". Empty when there are none to give. */
  text: string;
  /** For the form, when there are no plain words: the server will judge it on save. */
  note?: string;
  /** Why it will be refused, in plain words. */
  error?: string;
}

interface Fields {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
}

/** Common schedules, offered as one-tap choices beside the cron field. */
export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Weekdays at 08:00", cron: "0 8 * * 1-5" },
  { label: "Every day at 07:30", cron: "30 7 * * *" },
  { label: "Every day at 18:00", cron: "0 18 * * *" },
  { label: "Mondays at 09:00", cron: "0 9 * * 1" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
];

/** Shown for cron features this reader does not model (`L`, `W`, `#`, `?`): the server decides. */
export const CHECKED_ON_SAVE = "Steward will check this when you save.";

/**
 * True when a day or month field uses `L` (last), `W` (nearest weekday), `#` (nth weekday) or `?`
 * (any): the server's cron reads them, this one does not. Names are taken out first, since `jul`
 * and `wed` are not `L` and `W`.
 */
function serverOnly(field: string, names?: Record<string, number>): boolean {
  let rest = field.toLowerCase();
  for (const name of Object.keys(names ?? {})) rest = rest.replaceAll(name, "");
  return /[lw#?]/.test(rest);
}

function value(token: string, names: Record<string, number> | undefined): number {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  return names?.[token.toLowerCase()] ?? Number.NaN;
}

function expand(
  field: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): number[] | undefined {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined) return undefined;
    const step = stepText === undefined ? 1 : /^\d{1,2}$/.test(stepText) ? Number(stepText) : Number.NaN;
    if (!Number.isInteger(step) || step < 1) return undefined;
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a = "", b, more] = (range ?? "").split("-");
      if (more !== undefined) return undefined;
      lo = value(a, names);
      hi = b === undefined ? (stepText === undefined ? lo : max) : value(b, names);
      // Sunday closing a range by name counts as 7, so FRI-SUN is Friday to Sunday.
      if (names === CRON_DAY_ALIASES && b !== undefined && hi === 0 && lo > 0) hi = 7;
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
        return undefined;
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

function parse(parts: [string, string, string, string, string]): Fields | undefined {
  const [m, h, dom, mon, dow] = parts;
  const minutes = expand(m, 0, 59);
  const hours = expand(h, 0, 23);
  const days = expand(dom, 1, 31);
  const months = expand(mon, 1, 12, CRON_MONTH_ALIASES);
  const weekdaysRaw = expand(dow, 0, 7, CRON_DAY_ALIASES);
  if (!minutes || !hours || !days || !months || !weekdaysRaw) return undefined;
  const weekdays = [...new Set(weekdaysRaw.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);
  return { minutes, hours, days, months, weekdays };
}

/**
 * The shortest gap between two runs, in minutes. Times within a day are exact; across midnight it
 * assumes the next day may also match, which can only make the answer stricter.
 */
function shortestGap(minutes: number[], hours: number[]): number {
  const times = hours.flatMap((h) => minutes.map((m) => h * 60 + m)).sort((a, b) => a - b);
  if (times.length === 0) return Number.POSITIVE_INFINITY;
  let gap = times[0]! + 24 * 60 - times[times.length - 1]!;
  for (let i = 1; i < times.length; i++) gap = Math.min(gap, times[i]! - times[i - 1]!);
  return gap;
}

/** The server's words for a schedule, or "Custom schedule (…)" where it would show the cron itself. */
function describe(cron: string): string {
  const words = describeSchedule(cron);
  return words === cron ? `Custom schedule (${cron})` : words;
}

/** Reads a cron expression and says whether Steward will accept it. */
export function checkCron(input: string): CronCheck {
  const cron = input.trim().split(/\s+/).join(" ");
  if (!cron) return { ok: false, text: "", error: "Choose when it runs." };
  const parts = cron.split(" ");
  const unreadable: CronCheck = {
    ok: false,
    text: "",
    error: "That schedule could not be read. It needs five parts: minute, hour, day, month, weekday.",
  };
  if (parts.length !== 5 || cron.includes("@")) return unreadable;
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const fields = parse([m, h, dom, mon, dow]);
  const minutes = fields?.minutes ?? expand(m, 0, 59);
  const hours = fields?.hours ?? expand(h, 0, 23);
  if (!minutes || !hours) return unreadable;
  // Days the server's cron understands but this reader does not: the times still have to keep to
  // the floor, and the server judges the rest when it is saved.
  const checkedOnSave =
    !fields && (serverOnly(dom) || serverOnly(mon, CRON_MONTH_ALIASES) || serverOnly(dow, CRON_DAY_ALIASES));
  if (!fields && !checkedOnSave) return unreadable;
  const text = fields ? describe(cron) : "";
  if (shortestGap(minutes, hours) < ROUTINE_LIMITS.minIntervalMinutes) {
    return {
      ok: false,
      text,
      error: `Routines may run at most every ${ROUTINE_LIMITS.minIntervalMinutes} minutes.`,
    };
  }
  return fields ? { ok: true, text } : { ok: true, text, note: CHECKED_ON_SAVE };
}
