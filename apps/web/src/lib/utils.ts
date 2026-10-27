import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's default scale. Steward's own sizes, radii and shadows are
 * registered here, or `cn("text-ink", "text-body")` would treat `text-body` as a colour and drop
 * the ink.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "body", "sub", "caption"],
      radius: ["card", "field", "tile"],
      shadow: ["card", "raised", "float"],
      spacing: ["target"],
    },
  },
});

/** Joins class names and lets later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "just now", "5 minutes ago", "in 3 hours", "yesterday". Empty for a missing or bad date. */
export function relativeTime(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(Math.round(seconds / 60), "minute");
}

/** "09:30" in the person's own clock. */
export function formatTime(iso: string | undefined, timeZone?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone });
}

/** "Tuesday 27 October". */
export function formatDay(iso: string | Date, timeZone?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone });
}

/** "27 Oct 2026, 09:30". */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Today's date where the person is, `YYYY-MM-DD`. Never UTC: a UTC "today" is wrong every evening in
 * America. With a time zone, the date there (the Settings zone is the one the server keeps days in);
 * an unknown zone falls back to this browser's.
 */
export function localDate(d: Date = new Date(), timeZone?: string): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(d);
      const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    } catch {
      // An unknown zone: use this browser's.
    }
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "2.1 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** `plural(1, "task")` → "1 task"; `plural(3, "email")` → "3 emails"; irregulars take a third argument. */
export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Just the word: `pluralWord(2, "thing")` → "things". */
export function pluralWord(count: number, one: string, many: string = `${one}s`): string {
  return count === 1 ? one : many;
}

/** "Ana, Ben and Chloe" / "Ana, Ben, Chloe and 4 more". */
export function listNames(names: string[], max = 3): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  const shown = unique.slice(0, max);
  const rest = unique.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** "Good morning" / "Good afternoon" / "Good evening". Never a name: Steward does not invent one. */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Hi";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Reads and writes localStorage without ever throwing (private mode, blocked storage, tests). */
export const storage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage is a convenience; the app works without it.
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // As above.
    }
  },
};

/** Pretty JSON for detail panes. Falls back to String() for values JSON cannot hold. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The browser's IANA time zone, or UTC when it will not say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** True when a key event came from somewhere the person is typing. Shortcuts never fire there. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  return (target as HTMLElement).isContentEditable === true;
}
