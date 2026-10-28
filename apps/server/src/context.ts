import type { DirectoryClient } from "@steward/bots";
import type { Db } from "@steward/db";
import type { PhoneProfile } from "@steward/phone";
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
import type { BotService } from "./bots/service.ts";
import type { ServerConfig } from "./config.ts";
import type { DeviceApi } from "./device/api.ts";
import type { InstallStore } from "./device/installs.ts";
import type { PhoneSettings } from "./device/phone.ts";
import type { DeviceStore } from "./device/store.ts";
import type { SecurityOptions } from "./http/security.ts";
import type { RemoteBridge } from "./remote/bridge.ts";
import type { AgentHost } from "./runtime/agents.ts";
import type { NodeSqliteAgentRunner } from "./runtime/runner.ts";
import type { ServerRuns } from "./runtime/server-runs.ts";
import type { SetupService } from "./setup/checks.ts";
import type { InstalledBotStore } from "./store/bots.ts";
import type { DelegationStore } from "./store/delegations.ts";
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
  /** The bot directory (`STEWARD_DIRECTORY_URL`), the bots installed from it, and the work between. */
  directory: DirectoryClient;
  installedBots: InstalledBotStore;
  bots: BotService;
  /** Tasks one agent handed to another, and the conversations they run in. */
  delegations: DelegationStore;
  security: SecurityOptions;
  /** Paired phones, the phone address, and the device API both listeners and the bridge call. */
  devices: DeviceStore;
  phone: PhoneSettings;
  deviceApi: DeviceApi;
  /** The device listener's port once it listens (null when switched off). */
  phoneListener: { port: number | null; running: boolean };
  /** The person's profile as the phone catalogue reads it, made fresh on each call. */
  phoneProfile: () => PhoneProfile;
  /** One-time shortcut downloads, in memory. */
  installs: InstallStore;
  /** The bridge to the phone app's relay, when STEWARD_RELAY_URL is set. */
  remote?: RemoteBridge;
  /** Single-user mode: every action is the one local person's. */
  actorId: string;
  defaultAgentId: string;
  hasAgent(agentId: string): boolean;
}
