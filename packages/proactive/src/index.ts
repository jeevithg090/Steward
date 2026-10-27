/**
 * @steward/proactive: the part of Steward that works before you ask. Tasks, memory, skills,
 * routines, mail triage, the morning brief, suggestions and notifications, on one SQLite file.
 *
 * `apps/server` builds it once with `createProactive(...)` and hands the stores to the agent and the
 * REST routes. Everything it needs from elsewhere arrives through `@steward/shared` interfaces.
 */
import type { Db } from "@steward/db";
import type {
  Approval,
  BriefService,
  EventBus,
  MailCalendar,
  MemoryStore,
  NotificationStore,
  RoutineStore,
  Skill,
  SkillStore,
  TaskStore,
  TextModel,
} from "@steward/shared";
import { createBriefService } from "./brief.ts";
import { createMemoryStore } from "./memory.ts";
import { migrations } from "./migrations.ts";
import { createNotificationStore } from "./notifications.ts";
import { createRoutineStore } from "./routines.ts";
import { createSkillStore } from "./skills.ts";
import { createTaskStore } from "./tasks.ts";
import { createTriageCache } from "./triage.ts";
import { createTriageService, type TriageService } from "./triage-service.ts";

export interface ProactiveOptions {
  db: Db;
  bus?: EventBus;
  /** The mail and calendar connector, read on every use so it can be connected while running. */
  mail: () => MailCalendar | undefined;
  /** The model for triage and the brief summary. Without one, both fall back to plain rules. */
  model: () => TextModel | undefined;
  /** The person's IANA timezone: the brief's "today" and its calendar are in it. */
  timezone: () => string;
  /** Skills from the tenant package. Seeded on start, read only. */
  tenantSkills?: Skill[];
  /**
   * The gateway's approvals. Optional, and worth passing: with it a task waiting on an approval
   * reads as `needs_you` even after a restart. Without it the store relies on bus events.
   */
  approvals?: { get(id: string): Pick<Approval, "status"> | undefined };
  /** The clock. Tests pass a fixed one. */
  now?: () => Date;
}

export interface Proactive {
  tasks: TaskStore;
  memory: MemoryStore;
  skills: SkillStore;
  routines: RoutineStore;
  /** Also has `run(emails)`, which returns the counts the brief uses. */
  triage: TriageService;
  brief: BriefService;
  notifications: NotificationStore;
}

/** Builds every proactive store on one database. Applies this package's migrations (safe to repeat). */
export function createProactive(opts: ProactiveOptions): Proactive {
  const now = opts.now ?? (() => new Date());
  const { db, bus } = opts;
  db.migrate(migrations);

  const notifications = createNotificationStore({ db, now, ...(bus ? { bus } : {}) });
  const tasks = createTaskStore({
    db,
    now,
    ...(bus ? { bus } : {}),
    ...(opts.approvals ? { approvals: opts.approvals } : {}),
  });
  const memory = createMemoryStore({ db, now });
  const skills = createSkillStore({
    db,
    now,
    ...(opts.tenantSkills ? { tenantSkills: opts.tenantSkills } : {}),
  });
  const routines = createRoutineStore({ db, now, notifications, ...(bus ? { bus } : {}) });
  const triage = createTriageService({
    model: opts.model,
    mail: opts.mail,
    memory,
    cache: createTriageCache(db, now),
    now,
  });
  const brief = createBriefService({
    db,
    mail: opts.mail,
    model: opts.model,
    timezone: opts.timezone,
    now,
    triage,
    tasks,
    notifications,
    ...(bus ? { bus } : {}),
  });

  return { tasks, memory, skills, routines, triage, brief, notifications };
}

export { BRIEF_MAIL_CAP, cleanSummary, plainSummary, SUMMARY_SYSTEM, summaryPrompt } from "./brief.ts";
export { isProactiveError, ProactiveError, type ProactiveErrorCode } from "./errors.ts";
export { ROUTINE_MESSAGES } from "./routines.ts";
export { checkSchedule, describeSchedule, nextRun, SCHEDULE_MESSAGES } from "./schedule.ts";
export {
  HIDDEN_FOR_DAYS,
  MAX_SUGGESTIONS_PER_BRIEF,
  suggestFromBrief,
  suggestionTitle,
} from "./suggestions.ts";
export { TASK_STATES } from "./tasks.ts";
export { isKnownTimeZone, localDate, localDayBounds } from "./time.ts";
export {
  CONFIDENCE,
  inboxOwner,
  parseTriageAnswer,
  ruleVerdict,
  TRIAGE_CONCURRENCY,
  TRIAGE_SYSTEM,
  TriageAnswerError,
  type TriageEmail,
  type TriageRun,
  triageEmails,
  triagePrompt,
  UNSORTED_REASON,
} from "./triage.ts";
export type { TriageService } from "./triage-service.ts";
export { migrations };
