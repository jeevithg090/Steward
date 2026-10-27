import type { MailCalendar, MemoryStore, TextModel, Triage } from "@steward/shared";
import { inboxOwner, type TriageCache, type TriageEmail, type TriageRun, triageEmails } from "./triage.ts";

/** At most this much of what the person told Steward about themselves goes into the triage prompt. */
const ABOUT_MAX = 600;

export interface TriageService extends Triage {
  /** The same sort, with the counts the brief needs to say what it could not check. */
  run(emails: readonly TriageEmail[], opts?: { signal?: AbortSignal }): Promise<TriageRun>;
}

/**
 * The `Triage` the agent and the inbox route use. It reads the model and the mail connector on every
 * call (either can be connected or swapped while the server runs), works out whose inbox it is, and
 * gives the model what the person has told Steward about themselves, which is how "a customer" and
 * "my accountant" are told apart without ever naming the person.
 */
export function createTriageService(opts: {
  model: () => TextModel | undefined;
  mail: () => MailCalendar | undefined;
  memory: MemoryStore;
  cache: TriageCache;
  now: () => Date;
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
    const ownerEmail = inboxOwner(emails, opts.mail()?.label);
    const facts = about();
    return triageEmails(emails, {
      now: opts.now(),
      cache: opts.cache,
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
