/**
 * Domain contracts: mail, calendar, triage, the brief, tasks, routines, memory, skills, agents,
 * tenants and setup. Implemented by `@steward/connectors` and `@steward/proactive`; rendered by the
 * web app.
 */

// ── Mail and calendar ──────────────────────────────────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
  labels: string[];
}

export interface Email extends EmailSummary {
  cc: EmailAddress[];
  body: string;
}

export interface EmailDraft {
  to: EmailAddress[];
  cc?: EmailAddress[];
  subject: string;
  body: string;
  /** The message this replies to, when it is a reply. */
  inReplyTo?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  attendees: EmailAddress[];
  description?: string;
  /** Video call link, when there is one. */
  meetingUrl?: string;
}

/** The mail and calendar a connector gives Steward. Demo Google and real Google both implement it. */
export interface MailCalendar {
  readonly id: string;
  /** "Demo inbox" or the account's address. Shown on screen so demo data never passes for real. */
  readonly label: string;
  readonly isDemo: boolean;
  listEmails(opts?: { query?: string; limit?: number; unreadOnly?: boolean }): Promise<EmailSummary[]>;
  getEmail(id: string): Promise<Email | undefined>;
  sendEmail(draft: EmailDraft): Promise<{ id: string }>;
  listEvents(opts: { from: string; to: string }): Promise<CalendarEvent[]>;
  createEvent(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent>;
}

// ── Triage and the brief ───────────────────────────────────────────────────────────────────────

export type TriageVerdict = "needs_you" | "can_wait";

export interface TriageItem {
  emailId: string;
  subject: string;
  from: EmailAddress;
  verdict: TriageVerdict;
  /** One line, plain words: "Asks you to confirm Thursday's delivery by noon." */
  reason: string;
  /** 0..1. */
  confidence: number;
  /** `model` or `rules` (the fallback when no model answers). */
  by: "model" | "rules";
}

export interface Brief {
  id: string;
  /** Local date the brief is for, `YYYY-MM-DD`. */
  date: string;
  /** Two or three sentences, plain words. */
  summary: string;
  needsYou: TriageItem[];
  canWait: TriageItem[];
  calendar: CalendarEvent[];
  /** Tasks Steward is working on or that need review. */
  tasks: Task[];
  /** What it could not check, and why: "Calendar: not connected". */
  couldNotCheck: string[];
  createdAt: string;
}

// ── Tasks ──────────────────────────────────────────────────────────────────────────────────────

export type TaskState =
  | "needs_you"
  | "suggested"
  | "working"
  | "ready_for_review"
  | "needs_input"
  | "resolved"
  | "failed"
  | "hidden";

export interface Task {
  id: string;
  title: string;
  /** One or two sentences on what and why. */
  detail: string;
  state: TaskState;
  source: "triage" | "suggestion" | "chat" | "routine" | "approval" | "person";
  /** The conversation where the work happens, once started. */
  threadId?: string;
  approvalId?: string;
  emailId?: string;
  /** What Steward will do next, or what it needs from you. */
  nextStep?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Routines ───────────────────────────────────────────────────────────────────────────────────

export interface Routine {
  id: string;
  title: string;
  /** What Steward is asked to do each time, in the person's words. */
  prompt: string;
  /** A five-field cron expression. The scheduler refuses anything more often than every 15 minutes. */
  schedule: string;
  /** Plain words for the schedule: "Weekdays at 08:00". */
  scheduleText: string;
  timezone: string;
  enabled: boolean;
  agentId: string;
  threadId: string;
  consecutiveFailures: number;
  lastRunAt?: string;
  lastStatus?: "ok" | "failed" | "refused";
  lastError?: string;
  nextRunAt?: string;
  createdAt: string;
}

export const ROUTINE_LIMITS = {
  /** No routine may run more often than this. */
  minIntervalMinutes: 15,
  /** At most this many enabled routines. */
  maxEnabled: 20,
  /** This many failures in a row switches a routine off. */
  maxConsecutiveFailures: 10,
} as const;

// ── Memory, skills, agents, tenants ────────────────────────────────────────────────────────────

export interface MemoryFact {
  id: string;
  text: string;
  /** `you` when the person told Steward; `learned` when Steward noticed it. */
  source: "you" | "learned";
  createdAt: string;
}

export interface Skill {
  id: string;
  /** Called with `/name` in the composer. */
  name: string;
  description: string;
  instructions: string;
  /** Tool names the skill needs. */
  tools: string[];
  source: "tenant" | "person";
}

export interface AgentProfile {
  id: string;
  name: string;
  title: string;
  /** The standing instructions, appended to Steward's base prompt. */
  instructions: string;
  skills: string[];
  /** Tool names granted. `*` grants every built-in tool. */
  tools: string[];
  /** Overrides the tenant's default model. */
  model?: string;
}

export interface Brand {
  name: string;
  tagline: string;
  /** CSS colour used for the accent. */
  accent: string;
  /** How the agent speaks of itself. */
  voice: string;
}

export interface ModelConfig {
  provider: "openrouter" | "openai" | "anthropic" | "nvidia" | "gemini" | "ollama" | "openai-compatible" | "scripted";
  model: string;
  baseUrl?: string;
  /** Name of the env var holding the key. Never the key itself. */
  apiKeyEnv?: string;
}

export interface TenantPackage {
  id: string;
  brand: Brand;
  agents: AgentProfile[];
  skills: Skill[];
  /** Extra rules layered on the presets. */
  rules: { name: string; effect: "allow" | "ask" | "deny"; when: string; description: string }[];
  model: ModelConfig;
  /** Starter suggestions shown on an empty Today page. */
  starters: string[];
}

// ── Setup checklist ────────────────────────────────────────────────────────────────────────────

export interface SetupCheck {
  id: "model" | "mail" | "calendar" | "computer" | "notifications" | "voice" | "mcp";
  label: string;
  status: "ready" | "not_checked" | "needs_setup";
  detail: string;
  /** What to do, in plain words, when it needs setup. */
  fix?: string;
  href?: string;
  optional: boolean;
}

// ── Threads ────────────────────────────────────────────────────────────────────────────────────

export interface ThreadSummary {
  id: string;
  title: string;
  agentId: string;
  /** `chat`, `routine`, `task`. */
  kind: "chat" | "routine" | "task";
  updatedAt: string;
  /** True while a run is in progress on it. */
  running: boolean;
  lastMessagePreview?: string;
}
