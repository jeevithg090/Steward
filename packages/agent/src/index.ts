/**
 * @steward/agent: the model, the tools, the prompt and the governed AG-UI agent.
 * What `apps/server` uses is listed in PLAN §5.1; the rest is exported for tests and tools.
 */
export { type AgentDeps, createStewardAgent, StewardAgent, toolServices } from "./agent.ts";
export { buildRunContext, CONTEXT_PREFIX, skillCalled } from "./context.ts";
export { isTainted, sanitizeHistory } from "./history.ts";
export {
  CANCELLED_BY_PERSON,
  envelopeFor,
  GATE_UNAVAILABLE,
  GovernedToolsMiddleware,
  type GovernedToolsOptions,
  linkStopSignal,
  modelErrorMessage,
  NO_LONGER_GRANTED,
  normaliseUsage,
  TOO_MANY_STEPS,
} from "./middleware.ts";
export {
  COMPATIBLE_KEY_ENV,
  type CreatedModel,
  createModel,
  createTextModel,
  PROVIDERS,
  type ProfileModel,
  profileModel,
  type ResolvedModelConfig,
  resolveModelConfig,
  SCRIPTED_MODEL_ID,
} from "./model.ts";
export { buildSystemPrompt } from "./prompt.ts";
export {
  parseEmail,
  parseRoutine,
  parseSite,
  SCRIPTED_HELP,
  SCRIPTED_NOTE,
  type ScriptedServer,
  scriptedReply,
  startScriptedModel,
} from "./scripted.ts";
export {
  DEFAULT_BRAND,
  DEFAULT_MODEL,
  DEFAULT_STARTERS,
  loadTenant,
  MODEL_PROVIDERS,
  TenantError,
} from "./tenant.ts";
export { BUILTIN_TOOLS, buildToolCatalogue, grantedBuiltins, toAgUiTool } from "./tools/catalogue.ts";
export {
  DELEGATE_TOOL,
  delegateTask,
  delegateToolFor,
  delegationEnvelope,
  isDelegationRun,
} from "./tools/delegate.ts";
export { NO_DIRECTORY, THIRD_PARTY_NOTE } from "./tools/directory.ts";
export { mcpTool } from "./tools/mcp.ts";
export type {
  DelegateTarget,
  DelegationResult,
  DelegationRun,
  DelegationService,
  DirectoryService,
  GateFacts,
  ObjectSchema,
  StewardTool,
  ToolArgs,
  ToolContext,
  ToolServices,
} from "./tools/types.ts";
export { UNTRUSTED_NOTICE, wrapUntrusted } from "./tools/untrusted.ts";
