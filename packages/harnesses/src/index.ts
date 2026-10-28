/**
 * @steward/harnesses: external coding agents (Claude Code, Codex, Gemini CLI and others) as Steward
 * agents. Each runs as the vendor's own tool in the agent's workspace; every permission it asks for
 * goes through the gateway. See docs/plans/orchestration.md.
 */
export { AcpBackend, lineFilter, updateFrom } from "./acp/backend.ts";
export {
  commandOf,
  filterStdoutLine,
  insideWorkspace,
  outcomeFor,
  outputOf,
  pathsOf,
  permissionFrom,
  toolNameOf,
} from "./acp/mapping.ts";
export { CodexBackend, INTERRUPT_GRACE_MS } from "./codex/backend.ts";
export {
  changedFiles,
  commandLine,
  commandPermission,
  decisionFor,
  elicitationPermission,
  elicitationResponse,
  fileChangePermission,
  itemCompleted,
  itemStarted,
  scopedId,
  usageFrom,
} from "./codex/mapping.ts";
export { AgUiStream } from "./events.ts";
export {
  HarnessAgent,
  type HarnessAgentDeps,
  latestUserText,
  STOPPED_BEFORE_FINISHING,
} from "./harness-agent.ts";
export {
  findProgram,
  HarnessProfileError,
  harnessEnvironment,
  harnessInfo,
  loadHarnesses,
  notInstalled,
  parseHarnesses,
  profileKey,
} from "./profiles.ts";
export {
  HarnessThread,
  HarnessThreads,
  type HarnessThreadsOptions,
  IDLE_MS,
  PARKED_MS,
  type ParkedPermission,
  type ThreadEvent,
} from "./session.ts";
export { HarnessSessionStore, migrations } from "./store.ts";
export type {
  BackendEvents,
  BackendFactory,
  HarnessBackend,
  HarnessPermission,
  HarnessUpdate,
  PermissionAnswer,
  TurnEnd,
} from "./types.ts";
