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
}

/** Per-call facts a tool needs: who it acts for, and the signal that stops it. */
export interface ToolContext {
  agentId: string;
  threadId: string;
  runId: string;
  toolCallId: string;
  signal: AbortSignal;
  services: ToolServices;
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
