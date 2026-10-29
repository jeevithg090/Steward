import { z } from "zod";
import type { ActivityItem, ComputerStatus, WorkspaceFile } from "./computer.ts";
import type {
  AgentProfile,
  Brand,
  Brief,
  CalendarEvent,
  EmailSummary,
  HarnessProfile,
  MemoryFact,
  Routine,
  SetupCheck,
  Skill,
  Task,
  TaskState,
  ThreadSummary,
  TriageItem,
} from "./domain.ts";
import type {
  AppNotification,
  Approval,
  ApprovalAnswer,
  AuditEvent,
  ChainCheck,
  Decision,
  Rule,
} from "./governance.ts";

/**
 * The REST surface between the web app and the server. Every route is under `/api`.
 * Request bodies are validated with the zod schemas here; responses use the types.
 * The CopilotKit runtime is mounted at `/api/copilotkit` and is not described here.
 */

export const DEFAULT_SERVER_PORT = 8787;
export const COPILOTKIT_PATH = "/api/copilotkit";

// ── Request bodies ─────────────────────────────────────────────────────────────────────────────

export const ApprovalDecisionBody = z.object({
  answer: z.enum(["once", "always", "refuse"]),
  /** Optional words from the person, passed to the agent with a refusal. */
  note: z.string().max(500).optional(),
});

export const RuleBody = z.object({
  name: z.string().min(1).max(120),
  effect: z.enum(["allow", "ask", "deny"]),
  when: z.string().min(1).max(2000),
  description: z.string().max(500).default(""),
  enabled: z.boolean().default(true),
});

export const DryRunBody = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  tainted: z.boolean().default(false),
  initiator: z.enum(["person", "routine", "task", "device"]).default("person"),
});

export const TaskPatchBody = z.object({
  state: z
    .enum([
      "needs_you",
      "suggested",
      "working",
      "ready_for_review",
      "needs_input",
      "resolved",
      "failed",
      "hidden",
    ])
    .optional(),
  title: z.string().min(1).max(200).optional(),
});

export const TaskStartBody = z.object({
  /** Extra words from the person to start the task with. */
  note: z.string().max(2000).optional(),
});

export const RoutineBody = z.object({
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(4000),
  schedule: z.string().min(1).max(120),
  timezone: z.string().default("UTC"),
  enabled: z.boolean().default(true),
});

export const MemoryBody = z.object({ text: z.string().min(1).max(1000) });

export const SkillBody = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  description: z.string().min(1).max(300),
  instructions: z.string().min(1).max(8000),
  tools: z.array(z.string()).default([]),
});

export const McpServerBody = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  name: z.string().min(1).max(120),
  transport: z.enum(["stdio", "http"]),
  /** For stdio: the command and args. */
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  /** For http: the endpoint. */
  url: z.string().url().optional(),
  /** Tools to grant to the default agent. Empty grants none. */
  granted: z.array(z.string()).default([]),
  /** Tools the person marked as reads. Everything else is treated as a write. */
  reads: z.array(z.string()).default([]),
});

export const SettingsBody = z.object({
  model: z
    .object({
      provider: z.enum([
        "openrouter",
        "openai",
        "anthropic",
        "nvidia",
        "gemini",
        "xai",
        "ollama",
        "openai-compatible",
        "scripted",
      ]),
      model: z.string().min(1),
      baseUrl: z.string().url().optional(),
    })
    .optional(),
  plainLanguage: z.boolean().optional(),
  briefTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  timezone: z.string().optional(),
  approvalExpiryHours: z.number().int().min(1).max(168).optional(),
});

export const ThreadCreateBody = z.object({
  title: z.string().max(200).optional(),
  /** Defaults to the tenant's first agent. */
  agentId: z.string().min(1).max(64).optional(),
});

// ── Responses ──────────────────────────────────────────────────────────────────────────────────

export interface AppInfo {
  brand: Brand;
  agents: AgentProfile[];
  starters: string[];
  model: { provider: string; model: string; scripted: boolean };
  mail: { connected: boolean; label: string; isDemo: boolean };
  version: string;
  singleUser: boolean;
}

/**
 * One agent as `GET /api/agents` lists it: the profile, the provider and model it runs on, and
 * whether it can answer now. An agent whose provider has no key is listed but `available: false`,
 * with a `reason` a person can act on; the picker greys it out and says why.
 */
export interface AgentInfo extends AgentProfile {
  available: boolean;
  /** The model id it runs on, e.g. `grok-4.7` or `anthropic/claude-sonnet-5.5`. */
  model: string;
  /** The provider id, e.g. `xai`, `openrouter`, `scripted`. */
  provider: string;
  /**
   * How the run is paid for: a key in .env, nothing (the scripted demo model), or the person's own
   * login inside an external agent's tool (`vendor-tool`).
   */
  signIn: "api-key" | "scripted" | "vendor-tool";
  /** Why it cannot answer, when `available` is false. */
  reason?: string;
}

export interface AgentsResponse {
  agents: AgentInfo[];
}

/** One harness profile as `GET /api/harnesses` lists it: what it runs, and whether it is installed. */
export interface HarnessInfo extends HarnessProfile {
  /** The program was found (on PATH, or at its absolute path). */
  available: boolean;
  /** Where it was found. */
  path?: string;
  /** Why it is not available. */
  reason?: string;
}

export interface Settings {
  model: { provider: string; model: string; baseUrl?: string };
  plainLanguage: boolean;
  briefTime: string;
  timezone: string;
  approvalExpiryHours: number;
}

export interface McpServerInfo {
  id: string;
  name: string;
  transport: "stdio" | "http";
  status: "connected" | "connecting" | "error" | "disabled";
  error?: string;
  /** The saved configuration, so the Connections page can edit it. None of it is secret. */
  command?: string;
  args?: string[];
  url?: string;
  tools: { name: string; description: string; granted: boolean; kind: "read" | "write" }[];
}

export interface ConnectionsInfo {
  mail: { connected: boolean; label: string; isDemo: boolean };
  mcp: McpServerInfo[];
  builtin: { name: string; description: string; kind: string; surface: string }[];
}

export interface AuditPage {
  events: AuditEvent[];
  /** Pass as `before` for the next page. */
  nextBefore?: number;
  total: number;
}

/** One row of `GET /api/inbox`: the email and, when it has been sorted, its triage. */
export type InboxEmail = EmailSummary & { triage?: TriageItem };

export interface TasksResponse {
  tasks: Task[];
  counts: Record<TaskState, number>;
}

/**
 * Every route, for the client and the server to agree on. `:id` segments are replaced by callers.
 * GET unless noted.
 */
export const ROUTES = {
  info: "/api/info", // AppInfo
  agents: "/api/agents", // AgentsResponse: every agent with its model and whether it can answer
  harnesses: "/api/harnesses", // HarnessInfo[]: the external coding agents and whether each is installed
  health: "/api/health", // { ok: true }
  settings: "/api/settings", // GET Settings · PUT SettingsBody → Settings
  setup: "/api/setup", // SetupCheck[]
  setupCheck: "/api/setup/check", // POST → SetupCheck[] (runs the checks again)
  events: "/api/events", // SSE stream of LiveEvent

  threads: "/api/threads", // ThreadSummary[] · POST ThreadCreateBody → ThreadSummary
  thread: "/api/threads/:id", // ThreadSummary · DELETE

  approvals: "/api/approvals", // ?status=pending → Approval[]
  approval: "/api/approvals/:id", // Approval
  approvalDecide: "/api/approvals/:id/decision", // POST ApprovalDecisionBody → Approval

  rules: "/api/rules", // Rule[] · POST RuleBody → Rule
  rule: "/api/rules/:id", // PUT RuleBody → Rule · DELETE
  rulesDryRun: "/api/rules/dry-run", // POST DryRunBody → Decision
  rulesPresets: "/api/rules/presets", // Rule[] (the shipped presets, read only)

  audit: "/api/audit", // ?before=&limit=&type=&effect=&q= → AuditPage
  auditVerify: "/api/audit/verify", // ChainCheck

  tasks: "/api/tasks", // ?state= → TasksResponse
  task: "/api/tasks/:id", // PATCH TaskPatchBody → Task
  taskStart: "/api/tasks/:id/start", // POST TaskStartBody → { task: Task; threadId: string }

  brief: "/api/brief", // ?date=YYYY-MM-DD → Brief | null
  briefGenerate: "/api/brief/generate", // POST → Brief

  inbox: "/api/inbox", // EmailSummary[] with triage
  calendar: "/api/calendar", // ?from=&to= → CalendarEvent[]

  routines: "/api/routines", // Routine[] · POST RoutineBody → Routine
  routine: "/api/routines/:id", // PATCH Partial<RoutineBody> → Routine · DELETE
  routineRun: "/api/routines/:id/run", // POST → { threadId: string }

  memory: "/api/memory", // MemoryFact[] · POST MemoryBody → MemoryFact
  memoryItem: "/api/memory/:id", // DELETE

  skills: "/api/skills", // Skill[] · POST SkillBody → Skill
  skill: "/api/skills/:id", // PUT SkillBody → Skill · DELETE

  connections: "/api/connections", // ConnectionsInfo
  mcpServers: "/api/connections/mcp", // POST McpServerBody → McpServerInfo
  mcpServer: "/api/connections/mcp/:id", // PUT McpServerBody · DELETE

  computer: "/api/computer/:agentId", // ComputerStatus
  computerActivity: "/api/computer/:agentId/activity", // ActivityItem[]
  computerFiles: "/api/computer/:agentId/files", // ?dir= → WorkspaceFile[]
  computerReset: "/api/computer/:agentId/reset", // POST → ComputerStatus
  computerWs: "/ws/computer/:agentId", // WebSocket, see computer.ts

  notifications: "/api/notifications", // AppNotification[]
  notificationsReadAll: "/api/notifications/read-all", // POST → 204

  bots: "/api/bots", // ?q=&category=&sort=&limit=&offset= → { bots: BotListing[]; total: number; categories }
  botsInstalled: "/api/bots/installed", // InstalledBot[]
  botInstalled: "/api/bots/installed/:id", // DELETE · POST /api/bots/installed/:id/update
  botsPreview: "/api/bots/preview", // POST BotPreviewBody → BotPreview
  botsInstall: "/api/bots/install", // POST BotInstallBody → InstalledBot
  botsMake: "/api/bots/make", // POST BotMakeBody → BotPack (not installed)

  devices: "/api/devices", // Device[] (paired, not revoked)
  devicesPairing: "/api/devices/pairing", // POST PairingBody → PairingOffer
  remotePairing: "/api/devices/remote-pairing", // POST → RemotePairing (the phone app, through the relay)
  remotePairingState: "/api/devices/remote-pairing/:id", // GET → RemotePairingState
  remotePairingConfirm: "/api/devices/remote-pairing/:id/confirm", // POST → Device (codes matched)
  remotePairingRefuse: "/api/devices/remote-pairing/:id/refuse", // POST → { ok: true }
  device: "/api/devices/:id", // PATCH DevicePatchBody → Device · DELETE (revoke)
  phone: "/api/phone", // GET PhoneInfo · PUT PhoneSettingsBody → PhoneInfo
  phoneCatalogue: "/api/phone/catalogue", // PhoneCatalogue
  phoneShortcutInstall: "/api/phone/shortcuts/:id/install", // POST → ShortcutInstall (one-time link)
  botsExport: "/api/bots/export", // POST { pack, handle? } → application/zip: the pack folder to submit
} as const;

export function route(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([a-zA-Z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? `:${k}`));
}

/** Re-exported so callers can type responses without importing three modules. */
export type {
  ActivityItem,
  AppNotification,
  Approval,
  ApprovalAnswer,
  AuditEvent,
  Brief,
  CalendarEvent,
  ChainCheck,
  ComputerStatus,
  Decision,
  EmailSummary,
  MemoryFact,
  Routine,
  Rule,
  SetupCheck,
  Skill,
  Task,
  ThreadSummary,
  WorkspaceFile,
};
