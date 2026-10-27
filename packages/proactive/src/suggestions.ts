import type { Brief, Task, TaskStore, TriageItem } from "@steward/shared";
import { TASK_STATES } from "./tasks.ts";

/** At most this many suggestions come out of one brief. */
export const MAX_SUGGESTIONS_PER_BRIEF = 5;
/** "Hide has to mean hide": a hidden suggestion is not offered again for this long. */
export const HIDDEN_FOR_DAYS = 14;

const SUBJECT_MAX = 100;

/** Senders nobody can reply to. Their mail still gets a suggestion, worded as looking into it. */
const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|notifications?)([+@.-]|$)/i;

function cleanSubject(subject: string): string {
  const bare = subject
    .replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return bare.length > SUBJECT_MAX ? `${bare.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : bare;
}

function senderName(item: TriageItem): string {
  return item.from.name?.trim() || item.from.email;
}

/** "Reply to Ana Pereira about Friday ship date", or "Look into …" when the sender takes no replies. */
export function suggestionTitle(item: TriageItem): string {
  const sender = senderName(item);
  const subject = cleanSubject(item.subject);
  if (NO_REPLY.test(item.from.email)) {
    return subject ? `Look into “${subject}” from ${sender}` : `Look into the email from ${sender}`;
  }
  return subject ? `Reply to ${sender} about ${subject}` : `Reply to ${sender}`;
}

/** Ignores case, spacing and trailing punctuation, so near-identical titles count as one. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.!?…]+$/, "")
    .trim();
}

/**
 * Turns the brief's needs-you mail into up to five suggested tasks, each with Start and Hide on
 * the Tasks page. Only mail the model sorted is suggested: "couldn't sort this one" might be spam,
 * and offering to reply to it would be a guess.
 *
 * Never duplicates: a message or title that already has a task is skipped, whatever state that
 * task is in, except a task hidden more than 14 days ago, which may be offered again.
 */
export function suggestFromBrief(brief: Brief, deps: { tasks: TaskStore; now: () => Date }): Task[] {
  const cutoff = deps.now().getTime() - HIDDEN_FOR_DAYS * 24 * 3600_000;
  const takenEmails = new Set<string>();
  const takenTitles = new Set<string>();
  for (const task of deps.tasks.list({ state: [...TASK_STATES], limit: 5000 })) {
    if (task.state === "hidden" && Date.parse(task.updatedAt) < cutoff) continue;
    if (task.emailId) takenEmails.add(task.emailId);
    takenTitles.add(normaliseTitle(task.title));
  }

  const created: Task[] = [];
  for (const item of brief.needsYou) {
    if (created.length >= MAX_SUGGESTIONS_PER_BRIEF) break;
    if (item.by !== "model") continue;
    const title = suggestionTitle(item);
    const key = normaliseTitle(title);
    if (takenEmails.has(item.emailId) || takenTitles.has(key)) continue;
    const noReply = NO_REPLY.test(item.from.email);
    created.push(
      deps.tasks.create({
        title,
        detail: item.reason,
        source: "suggestion",
        state: "suggested",
        emailId: item.emailId,
        nextStep: noReply
          ? "Start it and Steward looks into it. Nothing is sent or paid until you allow it."
          : "Start it and Steward drafts a reply. Nothing is sent until you allow it.",
      }),
    );
    takenEmails.add(item.emailId);
    takenTitles.add(key);
  }
  return created;
}
