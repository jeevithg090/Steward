// The amount each mission asked about, remembered after the ask is answered. A waiting rail
// mission's view carries no amount (its ask is gone, its message is "Claim filed…", the court's
// verdicts have none), so the list would show nothing; the last ask this browser saw fills it in.
// Kept per browser under `tempo.amounts.v1`, at most 200 missions.
import type { MissionView } from "@/lib/api";

const KEY = "tempo.amounts.v1";
const MAX = 200;
let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(all: Record<string, string>): void {
  const entries = Object.entries(all);
  const kept = entries.length > MAX ? Object.fromEntries(entries.slice(-MAX)) : all;
  cache = kept;
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* storage unavailable: remembered for this page only */
  }
}

/** Remember the amount a mission's ask named. */
export function rememberAmount(missionId: string, amountGbp: string | null | undefined): void {
  if (!amountGbp) return;
  const all = load();
  if (all[missionId] === amountGbp) return;
  const next = { ...all };
  delete next[missionId]; // re-inserted last, so the newest survive the cap
  next[missionId] = amountGbp;
  save(next);
}

/** Remember every ask in a list of missions (Mission Control's list, the chat's sync). */
export function rememberAsks(missions: Iterable<Pick<MissionView, "id" | "ask">>): void {
  for (const m of missions) if (m.ask) rememberAmount(m.id, m.ask.amount_gbp);
}

/** The amount this browser last saw asked for this mission, if any. */
export function rememberedAmount(missionId: string): string | null {
  return load()[missionId] ?? null;
}

/** For tests. */
export function forgetAmounts(): void {
  cache = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
