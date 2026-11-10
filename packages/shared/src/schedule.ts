/*
 * Plain words for a five-field cron, shared by the server (each routine's `scheduleText`) and the
 * routine form in the web app, so the two never describe one schedule differently. Pure: no cron
 * library, no clock. Adapted from OpenDuet/openbot/server/src/routines/schedule.ts (MIT, CopilotKit).
 */

function normalise(schedule: string): string {
  return schedule.trim().split(/\s+/).join(" ");
}

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
export const CRON_DAY_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
export const CRON_MONTH_ALIASES: Record<string, number> = {
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
  return CRON_DAY_ALIASES[token];
}

function monthNumber(field: string): number | undefined {
  return plainInt(field, 1, 12) ?? CRON_MONTH_ALIASES[field.toLowerCase()];
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
