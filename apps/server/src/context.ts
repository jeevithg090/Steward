import type { Db } from "@steward/db";
import type {
  BriefService,
  ComputerManager,
  EventBus,
  GatewayServices,
  MailCalendar,
  McpManager,
  MemoryStore,
  NotificationStore,
  RoutineStore,
  SkillStore,
  TaskStore,
  TenantPackage,
  Triage,
  WebTools,
} from "@steward/shared";
import type { ServerConfig } from "./config.ts";
import type { SecurityOptions } from "./http/security.ts";
import type { AgentHost } from "./runtime/agents.ts";
import type { NodeSqliteAgentRunner } from "./runtime/runner.ts";
import type { ServerRuns } from "./runtime/server-runs.ts";
import type { SetupService } from "./setup/checks.ts";
import type { SettingsStore } from "./store/settings.ts";
import type { ThreadStore } from "./store/threads.ts";
import type { ResumeSweep } from "./workers/resume-sweep.ts";
import type { Workers } from "./workers/workers.ts";

/** What `createProactive(...)` returns (PLAN §5.1). */
export interface ProactiveServices {
  tasks: TaskStore;
  memory: MemoryStore;
  skills: SkillStore;
  routines: RoutineStore;
  triage: Triage;
  brief: BriefService;
  notifications: NotificationStore;
}

/** Everything the routes and workers use, wired once in `bootstrap.ts`. */
export interface StewardServices {
  config: ServerConfig;
  version: string;
  db: Db;
  bus: EventBus;
  tenant: TenantPackage;
  gateway: GatewayServices;
  computers: ComputerManager;
  mcp: McpManager;
  web: WebTools;
  mail: () => MailCalendar | undefined;
  proactive: ProactiveServices;
  models: AgentHost;
  runner: NodeSqliteAgentRunner;
  runs: ServerRuns;
  sweep: ResumeSweep;
  workers: Workers;
  threads: ThreadStore;
  settings: SettingsStore;
  setup: SetupService;
  security: SecurityOptions;
  /** Single-user mode: every action is the one local person's. */
  actorId: string;
  defaultAgentId: string;
  hasAgent(agentId: string): boolean;
}
