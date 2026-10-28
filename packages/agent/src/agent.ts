import type { Middleware, RunAgentInput, RunAgentParameters } from "@ag-ui/client";
import { BuiltInAgent, type BuiltInAgentClassicConfig } from "@copilotkit/runtime/v2";
import type {
  AgentProfile,
  BriefService,
  ComputerManager,
  EventBus,
  Governance,
  MailCalendar,
  McpManager,
  MemoryStore,
  RoutineStore,
  SkillStore,
  TaskStore,
  TenantPackage,
  Triage,
  WebTools,
} from "@steward/shared";
import type { LanguageModel } from "ai";
import { buildRunContext } from "./context.ts";
import { GovernedToolsMiddleware, linkStopSignal } from "./middleware.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { buildToolCatalogue } from "./tools/catalogue.ts";
import type { DirectoryService, ToolServices } from "./tools/types.ts";

/** Everything one Steward agent needs. Built by `apps/server`; see PLAN §5.1. */
export interface AgentDeps {
  profile: AgentProfile;
  tenant: TenantPackage;
  model: LanguageModel;
  governance: Governance;
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
  bus?: EventBus;
  settings: () => { plainLanguage: boolean; timezone: string };
  /** The bot directory, when `STEWARD_DIRECTORY_URL` points at one. */
  directory?: DirectoryService;
  /** `local` in single-user mode. */
  actorId: string;
  /** Random per boot. A run whose forwarded props carry it may name its initiator (routine, task, resume). */
  serverRunToken: string;
  /** How many model calls one run may make. Defaults to 24. */
  maxSegments?: number;
  /**
   * The most a single model reply may write. Without it some providers reserve their own maximum
   * (65k tokens on OpenRouter for Sonnet) and refuse accounts with a small balance. Default 4096.
   */
  maxOutputTokens?: number;
  /** Where unexpected errors go. Defaults to a one-line console.error without stack or arguments. */
  onError?: (error: unknown, where: string) => void;
}

type WithMiddlewares = { middlewares: (Middleware | ((...args: never[]) => unknown))[] };

/**
 * A BuiltInAgent that survives cloning. The runtime clones the registered agent for every request,
 * and `BuiltInAgent.clone()` returns a plain BuiltInAgent, which would drop this class and anything
 * it adds. It also links each run to a stop signal, so Stop reaches a tool that is mid-flight.
 */
export class StewardAgent extends BuiltInAgent {
  private stopController?: AbortController;

  constructor(private readonly stewardConfig: BuiltInAgentClassicConfig) {
    super(stewardConfig);
  }

  override clone(): StewardAgent {
    const copy = new StewardAgent(this.stewardConfig);
    (copy as unknown as WithMiddlewares).middlewares = [...(this as unknown as WithMiddlewares).middlewares];
    if (this.agentId !== undefined) copy.agentId = this.agentId;
    copy.description = this.description;
    return copy;
  }

  protected override prepareRunAgentInput(parameters?: RunAgentParameters): RunAgentInput {
    const input = super.prepareRunAgentInput(parameters);
    const controller = new AbortController();
    this.stopController = controller;
    linkStopSignal(input, controller.signal);
    return input;
  }

  override abortRun(): void {
    this.stopController?.abort();
    super.abortRun();
  }
}

/** The services a tool may touch, cut from the agent's dependencies. */
export function toolServices(deps: AgentDeps): ToolServices {
  return {
    computers: deps.computers,
    mail: deps.mail,
    web: deps.web,
    mcp: deps.mcp,
    stores: deps.stores,
    settings: deps.settings,
    ...(deps.directory ? { directory: deps.directory } : {}),
  };
}

/**
 * One Steward agent: a CopilotKit BuiltInAgent with the governed middleware. The agent itself holds
 * no tools (`maxSteps: 1`, nothing in `tools`): every Steward tool is offered and run by the
 * middleware, through the gateway, so nothing can act ungoverned.
 */
export function createStewardAgent(deps: AgentDeps): StewardAgent {
  const services = toolServices(deps);
  const agent = new StewardAgent({
    model: deps.model,
    prompt: buildSystemPrompt({ tenant: deps.tenant, profile: deps.profile }),
    maxSteps: 1,
    maxOutputTokens: deps.maxOutputTokens ?? 4096,
  });
  agent.agentId = deps.profile.id;
  agent.description = deps.profile.title;
  const report = deps.onError;
  agent.use(
    new GovernedToolsMiddleware({
      agentId: deps.profile.id,
      actorId: deps.actorId,
      serverRunToken: deps.serverRunToken,
      governance: deps.governance,
      services,
      maxSegments: deps.maxSegments ?? 24,
      ...(report ? { onError: report } : {}),
      tools: () =>
        buildToolCatalogue({
          agentId: deps.profile.id,
          granted: deps.profile.tools,
          mcp: deps.mcp,
          ...(report ? { onError: (error: unknown) => report(error, "mcp tools") } : {}),
        }),
      context: (messages, initiator) =>
        buildRunContext({ services, messages, initiator, tenantSkills: deps.tenant.skills }),
    }),
  );
  return agent;
}
