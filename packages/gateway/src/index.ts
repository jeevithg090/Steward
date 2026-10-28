/**
 * @steward/gateway: the one door every tool call goes through.
 *
 * Policy (CEL rules with a fixed precedence), taint, the outbound check, approvals that are claimed
 * exactly once, and a hash-chained record. `createGateway` is the entry point; the rest is exported
 * for the server, the agent and tests.
 */
export { type ApprovalRecord, alwaysRuleFor, SqliteApprovalStore } from "./approvals.ts";
export { type AuditPageOptions, GENESIS_HASH, hashEvent, SqliteAuditLog } from "./audit.ts";
export { CelEngine, celString, FUNCTION_NAMES, RuleSyntaxError, unescapeCelString } from "./cel.ts";
export { buildContext, CONTEXT_SCHEMA, neutralContext, type PolicyContext } from "./context.ts";
export {
  DEVICE_FLOOR_PRESET,
  DEVICE_PRESETS,
  DEVICE_TAINT_PRESET,
  type DecidedFacts,
  deviceRefusal,
} from "./device-presets.ts";
export { GatewayError, type GatewayErrorCode, isGatewayError } from "./errors.ts";
export { ESCALATIONS, type EscalationPattern, escalateKind, kindForElementName } from "./escalate.ts";
export {
  createGateway,
  DEFAULT_EXPIRY_HOURS,
  type GatewayOptions,
  type StewardGateway,
} from "./gateway.ts";
export { actionDigest, GatewayGovernance, refusalMessage } from "./governance.ts";
export { migrations } from "./migrations.ts";
export {
  describeFindings,
  detectSensitive,
  HEALTH_TERMS,
  ibanValid,
  luhnValid,
  maskSensitive,
  scanOutbound,
  scanText,
} from "./outbound.ts";
export { BUILTIN, decide, type PreparedCall, prepareCall, type Verdict } from "./policy.ts";
export { METADATA_HOSTS, PRESET_RULES, type PresetRule } from "./presets.ts";
export { canonicalJson, isSecretKey, previewOf, redactForApproval, redactForAudit } from "./redact.ts";
export { SqliteRuleStore } from "./rules.ts";
export { summarize } from "./summary.ts";
export { completeTarget, deriveTarget, gateCallFor, hostOf, normaliseKind, toolInfo } from "./target.ts";
