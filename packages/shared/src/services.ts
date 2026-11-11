/**
 * Service interfaces between packages. Each package implements its own and depends only on these,
 * so tracks can be built in parallel and wired together in `apps/server`.
 */
import type { McpServerInfo } from "./api.ts";
import type {
  ActivityItem,
  Computer,
  ComputerClientMessage,
  ComputerServerMessage,
  ComputerStatus,
} from "./computer.ts";
import type {
  Brief,
  EmailSummary,
  InboxWatch,
  MemoryFact,
  Routine,
  Skill,
  Task,
  TaskState,
  TriageItem,
} from "./domain.ts";
import type {
  AppNotification,
  Approval,
  ApprovalAnswer,
  ApprovalDecider,
  AuditEvent,
  AuditType,
  ChainCheck,
  ChainCheckOptions,
  Decision,
  Effect,
  GateCall,
  Governance,
  LiveEvent,
  Rule,
} from "./governance.ts";

/** A tiny typed event bus. The server fans these out over SSE. */
export interface EventBus {
  emit(event: LiveEvent): void;
  subscribe(listener: (event: LiveEvent) => void): () => void;
}

// ── @steward/gateway ───────────────────────────────────────────────────────────────────────────

export interface RuleStore {
  list(): Rule[];
  presets(): Rule[];
  get(id: string): Rule | undefined;
  create(input: {
    name: string;
    effect: Effect;
    when: string;
    description: string;
    enabled: boolean;
    source: Rule["source"];
  }): Rule;
  update(
    id: string,
    patch: Partial<Pick<Rule, "name" | "effect" | "when" | "description" | "enabled">>,
  ): Rule;
  remove(id: string): void;
  /** Throws a readable error when the CEL expression does not compile. */
  validate(when: string): void;
}

export interface ApprovalStore {
  list(filter?: { status?: Approval["status"]; threadId?: string; limit?: number }): Approval[];
  get(id: string): Approval | undefined;
  byToolCall(toolCallId: string): Approval | undefined;
  /**
   * Records the person's answer. `always` also writes a standing rule in the same transaction. With
   * `by`, the answer came from a paired device: the device presets may refuse it, and the record
   * says which device answered.
   */
  decide(id: string, answer: ApprovalAnswer, actorId: string, note?: string, by?: ApprovalDecider): Approval;
  /** Marks pending approvals past their expiry as expired. Returns how many. */
  expireDue(now?: Date): number;
}

export interface AuditLog {
  append(event: {
    type: AuditType;
    actorId: string;
    agentId?: string;
    threadId?: string;
    runId?: string;
    toolCallId?: string;
    tool?: GateCall["tool"];
    target?: GateCall["target"];
    effect?: Effect;
    rule?: Decision["rule"];
    detail?: Record<string, unknown>;
  }): AuditEvent;
  page(opts: { before?: number; limit?: number; type?: string; effect?: string; q?: string }): {
    events: AuditEvent[];
    nextBefore?: number;
    total: number;
  };
  verify(): ChainCheck;
}

/** The record as the gateway keeps it: checked without holding up the server, and exported whole. */
export interface RecordLog extends AuditLog {
  /** Hashes every entry again, all at once. For tests and small records; the server uses `check`. */
  verify(opts?: Pick<ChainCheckOptions, "anchor">): ChainCheck;
  /**
   * Checks the chain a page at a time, giving way to other work between pages. Without `full` or
   * an anchor, only the entries added since the last full check are hashed again.
   */
  check(opts?: ChainCheckOptions): Promise<ChainCheck>;
  /** Every entry as stored, oldest first, a page at a time: for downloading the record. */
  exportPages(pageSize?: number): Generator<AuditEvent[], void>;
}

/** Everything the gateway package exposes once constructed by `createGateway(...)`. */
export interface GatewayServices {
  governance: Governance;
  rules: RuleStore;
  approvals: ApprovalStore;
  audit: RecordLog;
}

// ── @steward/computer ──────────────────────────────────────────────────────────────────────────

export interface ComputerManager {
  /** Starts the agent's computer on first use. */
  get(agentId: string): Promise<Computer>;
  status(agentId: string): ComputerStatus;
  activity(agentId: string, limit?: number): ActivityItem[];
  /** One listener per open WebSocket. Frames start when the first listener arrives and stop with the last. */
  subscribe(agentId: string, listener: (msg: ComputerServerMessage) => void): () => void;
  /** Input from the person's screen. Ignored unless they hold control. */
  handle(agentId: string, msg: ComputerClientMessage): Promise<void>;
  reset(agentId: string): Promise<ComputerStatus>;
  closeAll(): Promise<void>;
}

// ── @steward/connectors ────────────────────────────────────────────────────────────────────────

export interface McpToolDefinition {
  /** `mcp__<server>__<tool>`. */
  name: string;
  server: string;
  tool: string;
  description: string;
  /** JSON Schema, always `{ type: "object", ... }`. */
  parameters: Record<string, unknown>;
  kind: "read" | "write";
}

export interface McpManager {
  list(): McpServerInfo[];
  /** Tools granted to the agent, ready to offer to the model. */
  grantedTools(agentId: string): McpToolDefinition[];
  call(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal },
  ): Promise<unknown>;
  upsert(config: {
    id: string;
    name: string;
    transport: "stdio" | "http";
    command?: string;
    args: string[];
    url?: string;
    granted: string[];
    reads: string[];
  }): Promise<McpServerInfo>;
  remove(id: string): Promise<void>;
  closeAll(): Promise<void>;
}

export interface WebTools {
  /** Fetches a public page as readable text. Refuses private and metadata addresses. */
  fetch(
    url: string,
    opts?: { signal?: AbortSignal; maxChars?: number },
  ): Promise<{ url: string; title: string; text: string; truncated: boolean }>;
  search(
    query: string,
    opts?: { signal?: AbortSignal; limit?: number },
  ): Promise<{ title: string; url: string; snippet: string }[]>;
}

// ── @steward/proactive ─────────────────────────────────────────────────────────────────────────

export interface TaskStore {
  list(filter?: { state?: TaskState | TaskState[]; limit?: number }): Task[];
  counts(): Record<TaskState, number>;
  get(id: string): Task | undefined;
  create(
    input: Pick<Task, "title" | "detail" | "source"> &
      Partial<Pick<Task, "state" | "threadId" | "approvalId" | "emailId" | "nextStep">>,
  ): Task;
  update(
    id: string,
    patch: Partial<
      Pick<Task, "title" | "detail" | "state" | "threadId" | "nextStep" | "error" | "approvalId">
    >,
  ): Task;
  /** The task whose conversation this is, if any. */
  byThread(threadId: string): Task | undefined;
}

export interface MemoryStore {
  list(): MemoryFact[];
  add(text: string, source: MemoryFact["source"]): MemoryFact;
  remove(id: string): void;
}

export interface SkillStore {
  list(): Skill[];
  get(idOrName: string): Skill | undefined;
  create(input: Omit<Skill, "id" | "source">): Skill;
  update(id: string, input: Omit<Skill, "id" | "source">): Skill;
  remove(id: string): void;
}

export interface Triage {
  /** Sorts mail into needs you / can wait. Rules first, then the model; never guesses silently. */
  triage(emails: EmailSummary[], opts?: { signal?: AbortSignal }): Promise<TriageItem[]>;
}

export interface BriefService {
  get(date: string): Brief | undefined;
  latest(): Brief | undefined;
  /** Builds today's brief from mail, calendar and tasks, and stores it. Idempotent per date unless `force`. */
  generate(opts?: { date?: string; force?: boolean; signal?: AbortSignal }): Promise<Brief>;
}

export interface RoutineStore {
  list(): Routine[];
  get(id: string): Routine | undefined;
  /** Refuses schedules more often than every 15 minutes, and more than 20 enabled routines. */
  create(input: {
    title: string;
    prompt: string;
    schedule: string;
    timezone: string;
    enabled: boolean;
    agentId: string;
  }): Routine;
  update(
    id: string,
    patch: Partial<Pick<Routine, "title" | "prompt" | "schedule" | "timezone" | "enabled">>,
  ): Routine;
  remove(id: string): void;
  /** Records one run. Ten failures in a row switch the routine off. */
  recordRun(id: string, status: "ok" | "failed" | "refused" | "skipped", error?: string): Routine;
  /**
   * Claims what is due. A slot missed by more than its grace (while Steward wasn't running) is not
   * run late: it is marked `missed` and the person is told once.
   */
  due(now?: Date): Routine[];
  /**
   * Called once at start: any run still marked as running died with the last server, so it is
   * recorded as failed and the routine is scheduled again from now. Returns how many there were.
   */
  recover(): number;
}

/**
 * The inbox watch (`InboxWatch` in domain.ts). Off until the person switches it on; it only reads
 * mail and adds suggestions, and never acts.
 */
export interface InboxWatchService {
  /** Whether it is on, and when it last looked. */
  status(): InboxWatch;
  setEnabled(enabled: boolean): InboxWatch;
  /**
   * Looks once, if it is on: reads new mail, sorts it, and suggests what needs the person. It calls
   * no tools: the only things it writes are suggestions, one notification and its own status.
   */
  check(opts?: { signal?: AbortSignal }): Promise<InboxWatch>;
}

/**
 * Asks a model for a short structured answer. The proactive package uses it for triage and the
 * brief summary; the agent package supplies it from the configured model.
 */
export interface TextModel {
  readonly label: string;
  /** Returns the model's raw text. Callers parse JSON themselves and treat failure as "could not". */
  complete(opts: {
    system: string;
    prompt: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<string>;
}

export interface NotificationStore {
  list(opts?: { unreadOnly?: boolean; limit?: number }): AppNotification[];
  add(input: Omit<AppNotification, "id" | "createdAt" | "readAt">): AppNotification;
  readAll(): void;
}
