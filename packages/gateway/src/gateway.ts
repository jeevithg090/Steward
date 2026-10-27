import type { Db } from "@steward/db";
import type { EventBus, GatewayServices, TenantPackage } from "@steward/shared";
import { SqliteApprovalStore } from "./approvals.ts";
import { SqliteAuditLog } from "./audit.ts";
import { CelEngine } from "./cel.ts";
import { CONTEXT_SCHEMA, neutralContext } from "./context.ts";
import { GatewayGovernance } from "./governance.ts";
import { migrations } from "./migrations.ts";
import { PRESET_RULES } from "./presets.ts";
import { SqliteRuleStore } from "./rules.ts";

export interface GatewayOptions {
  db: Db;
  bus?: EventBus;
  /** Extra rules from the tenant package, stored with source `tenant` (upserted by name on start). */
  tenantRules?: TenantPackage["rules"];
  /** How long a pending approval stays open. Default 24. A function is read on every ask. */
  expiryHours?: number | (() => number);
  /** The clock. Tests pass a fixed one. */
  now?: () => Date;
}

/** `GatewayServices` with the concrete stores, which add a few extras (`waitFor`, `cancel`, `forToolCall`). */
export interface StewardGateway extends GatewayServices {
  governance: GatewayGovernance;
  rules: SqliteRuleStore;
  approvals: SqliteApprovalStore;
  audit: SqliteAuditLog;
}

export const DEFAULT_EXPIRY_HOURS = 24;

function hoursFrom(value: GatewayOptions["expiryHours"]): () => number {
  const read = typeof value === "function" ? value : () => value;
  return () => {
    const hours = read();
    return typeof hours === "number" && Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_EXPIRY_HOURS;
  };
}

/**
 * Builds the gateway on one database: applies its migrations (idempotent), syncs the shipped
 * presets and the tenant's rules, and returns the governance door with its stores.
 *
 * Throws when a tenant rule does not compile, so a broken package stops the server at start rather
 * than refusing every call later.
 */
export function createGateway(opts: GatewayOptions): StewardGateway {
  const now = opts.now ?? (() => new Date());
  opts.db.migrate(migrations);
  const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);
  const audit = new SqliteAuditLog(opts.db, opts.bus, now);
  const rules = new SqliteRuleStore(opts.db, audit, engine, now);
  rules.sync(PRESET_RULES, opts.tenantRules ?? []);
  const approvals = new SqliteApprovalStore(opts.db, audit, rules, opts.bus, now);
  const governance = new GatewayGovernance({
    rules,
    approvals,
    audit,
    engine,
    expiryHours: hoursFrom(opts.expiryHours),
    now,
  });
  return { governance, rules, approvals, audit };
}
