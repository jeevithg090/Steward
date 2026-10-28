import type {
  BotListing,
  BotsQuery,
  BriefService,
  ComputerManager,
  GateCall,
  MailCalendar,
  McpManager,
  MemoryStore,
  RoutineStore,
  SkillStore,
  Target,
  TaskStore,
  ToolKind,
  ToolSurface,
  Triage,
  WebTools,
} from "@steward/shared";
import type { z } from "zod";

/** The bot directory, as `directory_find` sees it: `DirectoryClient` from `@steward/bots` fits. */
export interface DirectoryService {
  list(query: z.infer<typeof BotsQuery>): Promise<{ bots: BotListing[]; total: number }>;
  /** A listing's `packUrl` as an absolute URL or path, so an Add button points at the real pack. */
  resolvePackUrl(packUrl: string): string;
}

/** A JSON Schema object. Tool parameters always have `type: "object"` at the root. */
export type JsonSchema = Record<string, unknown>;

export interface ObjectSchema extends JsonSchema {
  type: "object";
  properties: Record<string, JsonSchema>;
  required?: string[];
}

/** The arguments a model sent, parsed from JSON. */
export type ToolArgs = Record<string, unknown>;

/** Everything a tool may touch. A subset of `AgentDeps`, so tools can be tested without an agent. */
export interface ToolServices {
  computers: ComputerManager;
  mail: () => MailCalendar | undefined;
  web: WebTools;
  mcp: McpManager;
  stores: {
    tasks: TaskStore;
    memory: MemoryStore;
    skills: SkillStore;
    routines: RoutineStore;
    brief: BriefService;
    triage: Triage;
  };
  settings: () => { plainLanguage: boolean; timezone: string };
  /** The bot directory, when one is configured. Without it `directory_find` finds nothing. */
  directory?: DirectoryService;
  /** Other agents to hand tasks to. Without it `delegate_task` is not offered. */
  delegation?: DelegationService;
}

/** Per-call facts a tool needs: who it acts for, and the signal that stops it. */
export interface ToolContext {
  agentId: string;
  threadId: string;
  runId: string;
  toolCallId: string;
  signal: AbortSignal;
  services: ToolServices;
  /** Who started the run, as the gateway sees it. */
  initiator?: import("@steward/shared").Initiator;
  /** How many hand-offs deep this run is: 0 for a run nobody handed on. */
  delegationDepth?: number;
}

/** What only the tool knows about a call: what it touches and what text would leave Steward. */
export type GateFacts = Pick<GateCall, "target" | "outbound">;

/**
 * One tool the model can call. Steward tools never run on their own: the governed middleware
 * builds the gateway's view with `toGateCall`, and only the gateway calls `execute`.
 */
export interface StewardTool {
  readonly name: string;
  /** Written for the model: when to use it, and what comes back. */
  readonly description: string;
  readonly parameters: ObjectSchema;
  readonly kind: ToolKind;
  readonly surface: ToolSurface;
  /** `builtin` or `mcp:<server>`. */
  readonly source: string;
  /** True when the result carries content Steward does not trust (pages, mail, MCP output). */
  readonly taints: boolean;
  /** Resolves the target before any decision. Must not act. */
  toGateCall(args: ToolArgs, ctx: ToolContext): Promise<GateFacts>;
  /** Acts. Called only by the gateway once the call is allowed. */
  execute(args: ToolArgs, ctx: ToolContext): Promise<unknown>;
}

/** The empty target, for tools that touch nothing outside Steward. */
export const NO_TARGET: Target = {};

/** An agent another agent may hand a task to, as `delegate_task` lists it. */
export interface DelegateTarget {
  id: string;
  name: string;
  title: string;
}

/** How a handed-on task ended, as the parent's tool result reports it. */
export interface DelegationResult {
  outcome: "success" | "interrupt" | "cancelled" | "error";
  /** The child's last words. */
  text: string;
  error?: string;
  /** For `interrupt`: the child's own interrupts, which the parent's run ends with. */
  interrupts: import("@ag-ui/client").Interrupt[];
}

/**
 * One handed-on task in flight: the child's run, its live AG-UI events, and how it ends. Only the
 * public fields are data (the record previews them); the rest lives on the prototype.
 */
export interface DelegationRun {
  readonly subagentRunId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly task: string;
  /** The child's events as they happen, replayed from the start for a late subscriber. */
  events(): import("rxjs").Observable<import("@ag-ui/client").BaseEvent>;
  /** Settles when the child's run has ended and been stored. Never rejects. */
  done(): Promise<DelegationResult>;
  /** Stops the child's run. */
  stop(): Promise<void>;
}

/**
 * Handing tasks to other agents, implemented by the server: each task runs on the target agent in
 * a conversation of its own, through the same runner as every other run (plan §5).
 */
export interface DelegationService {
  /** How deep a chain of hand-offs may go: 1 means a task can be handed on once. */
  readonly maxDepth: number;
  /** The agents `fromAgentId` may hand a task to: every available agent but itself. */
  targets(fromAgentId: string): DelegateTarget[];
  /** Starts the task. Throws a plain sentence when it cannot (unknown agent, too many at once). */
  start(request: {
    parent: { threadId: string; runId: string; agentId: string; toolCallId: string };
    agentId: string;
    task: string;
    depth: number;
    initiator: import("@steward/shared").Initiator;
  }): Promise<DelegationRun>;
  /** The delegation an interrupt belongs to, when a child raised it. */
  ownerOf(interruptId: string): string | undefined;
  /** Continues a child that ended waiting on the person, with the answers to its interrupts. */
  resume(
    subagentRunId: string,
    entries: import("@ag-ui/client").ResumeEntry[],
    initiator: import("@steward/shared").Initiator,
  ): Promise<DelegationRun>;
  /** The parent's tool call a delegation answers. */
  parentCallOf(subagentRunId: string): string | undefined;
}
