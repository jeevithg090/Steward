import type { MailCalendar, MemoryStore, TextModel, Triage } from "@steward/shared";
import { inboxOwner, type TriageCache, type TriageEmail, type TriageRun, triageEmails } from "./triage.ts";

/** At most this much of what the person told Steward about themselves goes into the triage prompt. */
const ABOUT_MAX = 600;
/** How long reading one whole message may take before the summary is used instead. */
const FULL_EMAIL_TIMEOUT_MS = 5_000;

/**
 * Reads each message whole for the model: a summary carries a 200-character snippet and, from some
 * connectors, no Cc, so "you are copied" and the ask at the end of a long message go unseen. The
 * summary's own fields stay; only the body, Cc and headers are added. Any failure, or no answer in
 * time, keeps the summary, and the rest of that run uses summaries too: reading less is better than
 * a brief that waits on a mail server that has stopped answering.
 */
function wholeMessages(mail: MailCalendar, timeoutMs: number): (email: TriageEmail) => Promise<TriageEmail> {
  let failing = false;
  return async (email) => {
    if (failing || email.body?.trim()) return email;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const full = await Promise.race([
        mail.getEmail(email.id),
        new Promise<"late">((resolve) => {
          timer = setTimeout(resolve, timeoutMs, "late");
        }),
      ]);
      if (full === "late") failing = true;
      if (!full || full === "late" || full.id !== email.id) return email;
      return {
        ...email,
        body: full.body,
        cc: full.cc.length > 0 ? full.cc : (email.cc ?? []),
        headers: { ...full.headers, ...email.headers },
      };
    } catch {
      failing = true;
      return email;
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface TriageService extends Triage {
  /** The same sort, with the counts the brief needs to say what it could not check. */
  run(emails: readonly TriageEmail[], opts?: { signal?: AbortSignal }): Promise<TriageRun>;
}

/**
 * The `Triage` the agent and the inbox route use. It reads the model and the mail connector on every
 * call (either can be connected or swapped while the server runs), works out whose inbox it is, and
 * gives the model what the person has told Steward about themselves, which is how "a customer" and
 * "my accountant" are told apart without ever naming the person. The model reads each message
 * whole (body and Cc), as the eval does, not the summary a mail list carries.
 */
export function createTriageService(opts: {
  model: () => TextModel | undefined;
  mail: () => MailCalendar | undefined;
  memory: MemoryStore;
  cache: TriageCache;
  now: () => Date;
  /** For tests. Default 5 seconds. */
  fullEmailTimeoutMs?: number;
}): TriageService {
  function about(): string | undefined {
    const facts = opts.memory
      .list()
      .filter((fact) => fact.source === "you")
      .map((fact) => fact.text);
    let text = "";
    for (const fact of facts) {
      const next = text ? `${text}; ${fact}` : fact;
      if (next.length > ABOUT_MAX) break;
      text = next;
    }
    return text || undefined;
  }

  async function run(
    emails: readonly TriageEmail[],
    runOpts: { signal?: AbortSignal } = {},
  ): Promise<TriageRun> {
    const model = opts.model();
    const mail = opts.mail();
    const ownerEmail = inboxOwner(emails, mail?.label);
    const facts = about();
    const timeoutMs = opts.fullEmailTimeoutMs ?? FULL_EMAIL_TIMEOUT_MS;
    return triageEmails(emails, {
      now: opts.now(),
      cache: opts.cache,
      ...(mail ? { complete: wholeMessages(mail, timeoutMs) } : {}),
      ...(model ? { model } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
      ...(facts ? { about: facts } : {}),
      ...(runOpts.signal ? { signal: runOpts.signal } : {}),
    });
  }

  return {
    run,
    async triage(emails, triageOpts) {
      return (await run(emails, triageOpts)).items;
    },
  };
}
