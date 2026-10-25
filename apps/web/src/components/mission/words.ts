// Plain words for the mission shapes (plan.md §2): skills, states, amounts, times.
import type { BadgeTone } from "@/components/ui";
import type { MissionState, MissionView } from "@/lib/api";

export const SKILL_WORDS: Record<string, string> = {
  "clawback.uk-rail-delay-repay": "Delay Repay",
  "clawback.ofcom-missed-appointment": "Missed engineer visit",
};

export function skillWords(skillId: string | null | undefined): string {
  if (!skillId) return "Claim";
  return SKILL_WORDS[skillId] ?? skillId.replace(/^clawback\./, "").replaceAll("-", " ");
}

/** The colour a state takes everywhere (plan.md §4.7's accents). */
export function stateTone(state: MissionState): BadgeTone {
  if (state === "verified") return "emerald";
  if (state === "waiting" || state === "awaiting_consent" || state === "checkpoint") return "amber";
  if (state === "failed_safe" || state === "declined") return "rose";
  if (state === "running") return "indigo";
  return "slate";
}

export const TERMINAL_STATES: ReadonlySet<MissionState> = new Set<MissionState>(["declined", "failed_safe", "verified", "completed"]);

export function isRunning(state: MissionState | null | undefined): boolean {
  return state === "running" || state === "waiting" || state === "checkpoint";
}

/** £14.20, from a Decimal string the Gateway sent. */
export function gbp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "£0.00";
  const n = Number(value);
  return Number.isFinite(n) ? `£${n.toFixed(2)}` : `£${value}`;
}

/** The amount a mission is about: the ask, the outcome, or the plan's resolved value. */
export function missionAmount(m: MissionView): string | null {
  const resolved = (m.plan?.assumptions as Record<string, unknown> | undefined)?.resolved_value_gbp;
  return m.outcome?.amount_gbp ?? m.ask?.amount_gbp ?? (typeof resolved === "string" ? resolved : null);
}

/** "25 Oct, 00:30" from an ISO timestamp. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "19 November" from YYYY-MM-DD. */
export function dayWords(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/** 4 → "4 ms", 2300 → "2.3 s", 90000 → "2 min". */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

/** The person a mission belongs to, from the id the Gateway uses. */
export function personWords(userId: string | null | undefined): string {
  if (!userId) return "Someone";
  const name = userId.replace(/^u_/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** When a mission started, from its first timeline entry. */
export function startedAt(m: MissionView): string | null {
  return m.timeline[0]?.at ?? null;
}

/** Plain words for a Gateway error (fetch failures, HTTP codes) so the chat never shows a stack. */
export function plainError(err: unknown, context = "the Gateway"): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED|showcase:\/\//i.test(message)) {
    return `I can't reach ${context}. Check the address in Settings.`;
  }
  if (/HTTP 401|HTTP 403/.test(message)) return "The Gateway refused the token. Check Settings.";
  if (/\/chat: HTTP 404/.test(message)) return "This Gateway has no chat door yet (POST /chat is missing).";
  if (/HTTP 404/.test(message)) return "The Gateway could not find that.";
  if (/HTTP 5\d\d/.test(message)) return "The Gateway hit a problem. Try again in a moment.";
  return message.replace(/^(GET|POST|DELETE) \S+: /, "");
}
