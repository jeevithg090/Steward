import { ROUTINE_LIMITS } from "@steward/shared";

/**
 * A small five-field cron reader for the routine form: it describes a schedule in plain words and
 * warns before the server refuses one that runs too often. The server stays the judge; this only
 * saves a round trip.
 */

export interface CronCheck {
  ok: boolean;
  /** Plain words: "Weekdays at 08:00". */
  text: string;
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

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Common schedules, offered as one-tap choices beside the cron field. */
export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Weekdays at 08:00", cron: "0 8 * * 1-5" },
  { label: "Every day at 07:30", cron: "30 7 * * *" },
  { label: "Every day at 18:00", cron: "0 18 * * *" },
  { label: "Mondays at 09:00", cron: "0 9 * * 1" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
];

function expand(field: string, min: number, max: number): number[] | undefined {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return undefined;
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = (range ?? "").split("-");
      lo = Number(a);
      hi = b === undefined ? (stepText === undefined ? lo : max) : Number(b);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || a === "" || lo < min || hi > max || lo > hi) {
        return undefined;
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

function parse(cron: string): Fields | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const minutes = expand(m, 0, 59);
  const hours = expand(h, 0, 23);
  const days = expand(dom, 1, 31);
  const months = expand(mon, 1, 12);
  const weekdaysRaw = expand(dow, 0, 7);
  if (!minutes || !hours || !days || !months || !weekdaysRaw) return undefined;
  const weekdays = [...new Set(weekdaysRaw.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);
  return { minutes, hours, days, months, weekdays };
}

/**
 * The shortest gap between two runs, in minutes. Times within a day are exact; across midnight it
 * assumes the next day may also match, which can only make the answer stricter.
 */
function shortestGap(f: Fields): number {
  const times = f.hours.flatMap((h) => f.minutes.map((m) => h * 60 + m)).sort((a, b) => a - b);
  if (times.length === 0) return Number.POSITIVE_INFINITY;
  let gap = times[0]! + 24 * 60 - times[times.length - 1]!;
  for (let i = 1; i < times.length; i++) gap = Math.min(gap, times[i]! - times[i - 1]!);
  return gap;
}

const pad = (n: number) => String(n).padStart(2, "0");

function describe(cron: string, f: Fields): string {
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/) as [string, string, string, string, string];
  const everyDay = dom === "*" && mon === "*";
  const step = /^\*\/(\d+)$/.exec(m);
  if (step && h === "*" && everyDay && dow === "*") return `Every ${step[1]} minutes`;
  if (f.minutes.length === 1 && h === "*" && everyDay && dow === "*") {
    return f.minutes[0] === 0 ? "Every hour, on the hour" : `Every hour at ${pad(f.minutes[0]!)} past`;
  }
  if (f.minutes.length !== 1 || f.hours.length !== 1) return `Custom schedule (${cron.trim()})`;
  const at = `${pad(f.hours[0]!)}:${pad(f.minutes[0]!)}`;
  if (everyDay && dow === "*") return `Every day at ${at}`;
  if (everyDay && f.weekdays.join(",") === "1,2,3,4,5") return `Weekdays at ${at}`;
  if (everyDay && f.weekdays.join(",") === "0,6") return `Weekends at ${at}`;
  if (everyDay) return `${f.weekdays.map((d) => `${DAY_NAMES[d]}s`).join(", ")} at ${at}`;
  if (dow === "*" && mon === "*" && f.days.length === 1) return `On day ${f.days[0]} of each month at ${at}`;
  return `Custom schedule (${cron.trim()})`;
}

/** Reads a cron expression and says whether Steward will accept it. */
export function checkCron(cron: string): CronCheck {
  if (!cron.trim()) return { ok: false, text: "", error: "Choose when it runs." };
  const fields = parse(cron);
  if (!fields) {
    return {
      ok: false,
      text: "",
      error: "That schedule could not be read. It needs five parts: minute, hour, day, month, weekday.",
    };
  }
  const text = describe(cron, fields);
  if (shortestGap(fields) < ROUTINE_LIMITS.minIntervalMinutes) {
    return {
      ok: false,
      text,
      error: `Routines may run at most every ${ROUTINE_LIMITS.minIntervalMinutes} minutes.`,
    };
  }
  return { ok: true, text };
}
