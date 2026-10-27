/**
 * @steward/computer: the agent's computer of its own. A Playwright Chromium profile, a workspace
 * folder and a restricted shell per agent, with a live screen the person can watch and take over.
 * See README.md.
 */

export { withToolCall } from "./activity.ts";
export { VIEWPORT } from "./browser.ts";
export { AgentComputer } from "./computer.ts";
export { ComputerError, type ComputerErrorCode, isComputerError, MESSAGES } from "./errors.ts";
export { type ComputerManagerOptions, createComputerManager } from "./manager.ts";
export {
  classifyAddress,
  createHostPolicy,
  displayUrl,
  HostPolicy,
  type HostVerdict,
  type LookupFn,
  parseWebUrl,
  type ResolvedAddress,
} from "./network.ts";
export { SHELL_DEFAULT_TIMEOUT_MS, SHELL_MAX_TIMEOUT_MS, SHELL_OUTPUT_LIMIT } from "./shell.ts";
export { MASKED_VALUE, SNAPSHOT_CHAR_LIMIT } from "./snapshot.ts";
