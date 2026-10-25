// Plain words for the mission shapes (plan.md §2): skills, states, amounts, times.
import type { BadgeTone } from "@/components/ui";
import type { MissionState, MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import { rememberedAmount } from "./amounts";

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

// "Shall I claim £14.20", "has paid you £14.20": an amount the sentence says is the claim's, never a fare.
const CLAIM_IN_WORDS = /\b(?:claim(?:ed)?|paid you|pay you|compensation of)\s+£(\d{1,5}(?:\.\d{2})?)/i;

/**
 * The amount a mission is about: the outcome, the ask (or its Proof Trace), the plan's resolved
 * value, the last ask this browser saw for it, or a "claim £X" in its message. Null rather than a
 * guess when none of them says.
 */
export function missionAmount(m: MissionView): string | null {
  const resolved = (m.plan?.assumptions as Record<string, unknown> | undefined)?.resolved_value_gbp;
  return (
    m.outcome?.amount_gbp ??
    m.ask?.amount_gbp ??
    m.amount_gbp ??
    m.ask?.proof_trace?.amount_gbp ??
    (typeof resolved === "string" ? resolved : null) ??
    rememberedAmount(m.id) ??
    (m.message ? (CLAIM_IN_WORDS.exec(m.message)?.[1] ?? null) : null)
  );
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

const UNREACHABLE = /Failed to fetch|NetworkError|Load failed|ECONNREFUSED|showcase:\/\//i;

/** The Gateway did not answer at all (as opposed to answering with an error). */
export function isUnreachable(err: unknown): boolean {
  return UNREACHABLE.test(err instanceof Error ? err.message : String(err));
}

/** What the person reads when the Gateway does not answer (plan.md §12.4: say what to do next). */
export const UNREACHABLE_WORDS = "I can't reach Tempo's Gateway. Check Settings, or switch to the showcase.";

/** Plain words for a Gateway error (fetch failures, HTTP codes) so the chat never shows a stack. */
export function plainError(err: unknown, context = "Tempo's Gateway"): string {
  const message = err instanceof Error ? err.message : String(err);
  if (UNREACHABLE.test(message)) {
    return context === "Tempo's Gateway" ? UNREACHABLE_WORDS : `I can't reach ${context}. Check Settings, or switch to the showcase.`;
  }
  if (/HTTP 401|HTTP 403/.test(message)) return "The Gateway refused the token. Check Settings.";
  if (/\/chat: HTTP 404/.test(message)) return "This Gateway has no chat door yet (POST /chat is missing).";
  if (/HTTP 404/.test(message)) return "The Gateway could not find that.";
  if (/HTTP 5\d\d/.test(message)) return "The Gateway hit a problem. Try again in a moment.";
  return message.replace(/^(GET|POST|DELETE) \S+: /, "");
}

// A message that still carries a Python value (a tuple, a datetime) is not for a person to read.
const PYTHON_REPR = /datetime\.\w+\(|Decimal\(|\(\s*'[^']*'\s*,\s*'|<\w[\w.]* object at 0x|\bNone\)/;

/** The words to show for a mission's message: the Gateway's own, unless they leak code. */
export function plainMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return PYTHON_REPR.test(message) ? "Stopped safely: Tempo couldn't confirm the journey." : message;
}

/** Still moving: not declined, stopped, paid or closed. */
export function isLive(state: MissionState | null | undefined): boolean {
  return Boolean(state) && !TERMINAL_STATES.has(state as MissionState);
}

/** The first sentence of a message ("Complaint made. I'll check…" → "Complaint made."). */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(?:\s|$)/.exec(text.trim());
  return m ? m[1]! : text.trim();
}

/**
 * What to tell the person after they said yes, worded from what actually happened (plan.md §12.4):
 * waiting on purpose, a claim filed, the money already here, or the mission's own first sentence.
 */
export function afterYes(view: MissionView): { tone: "success" | "info"; text: string } {
  if (view.state === "verified") {
    const amount = view.outcome?.amount_gbp;
    return { tone: "success", text: amount ? `Money arrived: ${gbp(amount)}.` : "Money arrived." };
  }
  if (isLive(view.state) && view.plan?.action_today === "wait") {
    const until = view.plan.next_decision_on ? ` until ${dayWords(view.plan.next_decision_on)}` : "";
    return { tone: "success", text: `Saved. Tempo will wait on purpose${until}.` };
  }
  if (view.state === "waiting" && !view.plan) return { tone: "success", text: "Claim filed. Tempo will check for the money." };
  const said = plainMessage(view.message);
  return { tone: "info", text: said ? firstSentence(said) : `${STATE_LABELS[view.state] ?? view.state}.` };
}

/** When the mission reached a state, from its timeline (the newest entry for it). */
export function reachedAt(m: Pick<MissionView, "timeline">, state: MissionState): string | null {
  for (let i = m.timeline.length - 1; i >= 0; i--) if (m.timeline[i]!.to === state) return m.timeline[i]!.at;
  return null;
}
