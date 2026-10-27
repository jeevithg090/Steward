import { memoryDb } from "@steward/db";
import type {
  CalendarEvent,
  EmailSummary,
  EventBus,
  LiveEvent,
  MailCalendar,
  TextModel,
} from "@steward/shared";
import { createProactive, type ProactiveOptions } from "../src/index.ts";
import type { TriageEmail } from "../src/triage.ts";

export interface RecordingBus extends EventBus {
  events: LiveEvent[];
  of<T extends LiveEvent["type"]>(type: T): Extract<LiveEvent, { type: T }>[];
}

export function recordingBus(): RecordingBus {
  const listeners = new Set<(event: LiveEvent) => void>();
  const events: LiveEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    of(type) {
      return events.filter((event) => event.type === type) as never;
    },
  };
}

export interface Clock {
  now: () => Date;
  set(iso: string): void;
  advance(ms: number): void;
}

export function clock(iso: string): Clock {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next);
    },
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
}

export interface FakeModel extends TextModel {
  calls: { system: string; prompt: string }[];
}

/** A `TextModel` that answers with `answer(prompt)`, or throws what it throws. */
export function fakeModel(
  answer: (call: { system: string; prompt: string }) => string | Promise<string>,
  label = "fake-model",
): FakeModel {
  const calls: { system: string; prompt: string }[] = [];
  return {
    label,
    calls,
    async complete({ system, prompt }) {
      calls.push({ system, prompt });
      return answer({ system, prompt });
    },
  };
}

/** Answers triage prompts by subject: subjects containing "!" need you, the rest can wait. */
export function subjectModel(): FakeModel {
  return fakeModel(({ prompt, system }) => {
    if (system.includes("morning brief")) return "Two things need you today. Most of the rest can wait.";
    const subject = /Subject: (.*)/.exec(prompt)?.[1] ?? "";
    return subject.includes("!")
      ? `{"verdict":"needs_you","reason":"Asks you to answer ${subject.replace(/"/g, "")} today."}`
      : '{"verdict":"can_wait","reason":"Nothing to do here."}';
  });
}

export interface FakeMail extends MailCalendar {
  eventQueries: { from: string; to: string }[];
  emailQueries: { query?: string; limit?: number }[];
}

export function fakeMail(
  opts: {
    emails?: TriageEmail[];
    events?: CalendarEvent[];
    failEmails?: boolean;
    failEvents?: boolean;
    isDemo?: boolean;
    label?: string;
    /** When true, a query returns nothing, like a connector that searches the query as text. */
    ignoresQuery?: boolean;
  } = {},
): FakeMail {
  const eventQueries: { from: string; to: string }[] = [];
  const emailQueries: { query?: string; limit?: number }[] = [];
  return {
    id: "fake",
    label: opts.label ?? "Demo inbox",
    isDemo: opts.isDemo ?? false,
    eventQueries,
    emailQueries,
    async listEmails(query = {}) {
      emailQueries.push(query);
      if (opts.failEmails) throw new Error("mail is down, token=abc123");
      if (opts.ignoresQuery && query.query) return [];
      return (opts.emails ?? []).slice(0, query.limit ?? 100);
    },
    async getEmail() {
      return undefined;
    },
    async sendEmail() {
      throw new Error("not in tests");
    },
    async listEvents(range) {
      eventQueries.push(range);
      if (opts.failEvents) throw new Error("calendar is down, Authorization: Bearer xyz");
      return opts.events ?? [];
    },
    async createEvent() {
      throw new Error("not in tests");
    },
  };
}

let counter = 0;

export function email(partial: Partial<TriageEmail> & { subject: string }): TriageEmail {
  counter += 1;
  return {
    id: `msg_${counter}`,
    threadId: `thread_${counter}`,
    from: { name: "Ana Pereira", email: "ana@hearthandco.example" },
    to: [{ email: "owner@studio.example" }],
    snippet: "Can you confirm by end of day?",
    receivedAt: "2026-10-22T07:00:00Z",
    unread: true,
    labels: ["INBOX"],
    ...partial,
  };
}

export function event(
  partial: Partial<CalendarEvent> & { title: string; start: string; end: string },
): CalendarEvent {
  counter += 1;
  return { id: `evt_${counter}`, allDay: false, attendees: [], ...partial };
}

export function setup(overrides: Partial<ProactiveOptions> & { at?: string } = {}) {
  const bus = recordingBus();
  const time = clock(overrides.at ?? "2026-10-22T08:00:00Z");
  const db = memoryDb();
  const { at: _at, ...rest } = overrides;
  const proactive = createProactive({
    db,
    bus,
    mail: () => undefined,
    model: () => undefined,
    timezone: () => "UTC",
    now: time.now,
    ...rest,
  });
  return { ...proactive, bus, clock: time, db };
}

export type { EmailSummary };
