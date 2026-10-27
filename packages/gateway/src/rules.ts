/**
 * The rule store. Presets and tenant rules are synced on start and can only be switched on or off;
 * the person's own rules and the ones "Always allow" wrote can be edited and removed. Every change
 * is written to the record as `policy.changed`.
 */
import type { Db } from "@steward/db";
import type { AuditEvent, Effect, Rule, RuleStore, TenantPackage } from "@steward/shared";
import { newId } from "@steward/shared";
import type { SqliteAuditLog } from "./audit.ts";
import { type CelEngine, RuleSyntaxError } from "./cel.ts";
import { GatewayError } from "./errors.ts";
import { orderRules } from "./policy.ts";
import type { PresetRule } from "./presets.ts";

interface RuleRow {
  id: string;
  name: string;
  effect: string;
  cel: string;
  description: string;
  source: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const EFFECTS: readonly Effect[] = ["allow", "ask", "deny"];
const SOURCES: readonly Rule["source"][] = ["preset", "tenant", "person", "always"];

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    effect: row.effect as Effect,
    when: row.cel,
    description: row.description,
    source: row.source as Rule["source"],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

/** Who changed policy, for the record. Rules are edited from `/rules` by the local person. */
const POLICY_ACTOR = "local";

export type RuleInput = Parameters<RuleStore["create"]>[0];

export class SqliteRuleStore implements RuleStore {
  private cached: Rule[] | undefined;

  constructor(
    private readonly db: Db,
    private readonly audit: SqliteAuditLog,
    private readonly engine: CelEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every rule, in the order they are tried: presets, tenant, person, always; oldest first. */
  list(): Rule[] {
    if (!this.cached) {
      this.cached = orderRules(this.db.all<RuleRow>("SELECT * FROM gateway_rules").map(rowToRule));
    }
    return this.cached.map((r) => ({ ...r }));
  }

  /** The rules the decision reads. Not copied; callers must not change them. */
  current(): readonly Rule[] {
    if (!this.cached) this.list();
    return this.cached ?? [];
  }

  presets(): Rule[] {
    return this.list().filter((r) => r.source === "preset");
  }

  get(id: string): Rule | undefined {
    return this.list().find((r) => r.id === id);
  }

  validate(when: string): void {
    try {
      this.engine.validate(when);
    } catch (err) {
      if (err instanceof RuleSyntaxError) throw new GatewayError("invalid", err.message);
      throw new GatewayError("invalid", "This rule cannot be used: it could not be checked.");
    }
  }

  private checkInput(input: { name: string; effect: string; when: string; description: string }): void {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      throw new GatewayError("invalid", "A rule needs a name.");
    }
    if (input.name.length > 120)
      throw new GatewayError("invalid", "A rule's name can be at most 120 characters.");
    if (!EFFECTS.includes(input.effect as Effect)) {
      throw new GatewayError("invalid", "A rule must allow, ask or deny.");
    }
    if (typeof input.when !== "string" || input.when.length > 2000) {
      throw new GatewayError("invalid", "A rule's condition can be at most 2,000 characters.");
    }
    if (typeof input.description !== "string" || input.description.length > 500) {
      throw new GatewayError("invalid", "A rule's description can be at most 500 characters.");
    }
    this.validate(input.when);
  }

  create(input: RuleInput): Rule {
    return this.withAudit(() => this.insert(input));
  }

  /**
   * Inserts inside the caller's transaction. `approvals.decide` uses it for "Always allow" and
   * calls `flushAudit` after its commit, or `discardAudit` after a rollback.
   */
  insert(input: RuleInput): Rule {
    if (!SOURCES.includes(input.source)) throw new GatewayError("invalid", "Unknown rule source.");
    if (input.source === "preset") {
      throw new GatewayError("invalid", "Shipped rules come with Steward and cannot be added.");
    }
    this.checkInput(input);
    const at = this.now().toISOString();
    const rule: Rule = {
      id: newId("rule"),
      name: input.name.trim(),
      effect: input.effect,
      when: input.when,
      description: input.description.trim(),
      source: input.source,
      enabled: input.enabled !== false,
      createdAt: at,
    };
    this.db.run(
      `INSERT INTO gateway_rules (id, name, effect, cel, description, source, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule.id,
        rule.name,
        rule.effect,
        rule.when,
        rule.description,
        rule.source,
        rule.enabled ? 1 : 0,
        at,
        at,
      ],
    );
    this.cached = undefined;
    this.record("created", rule);
    return rule;
  }

  update(
    id: string,
    patch: Partial<Pick<Rule, "name" | "effect" | "when" | "description" | "enabled">>,
  ): Rule {
    return this.withAudit(() => {
      const current = this.get(id);
      if (!current) throw new GatewayError("not_found", "There is no rule with that id.");
      const fixed = current.source === "preset" || current.source === "tenant";
      if (fixed) {
        const changesMore = (["name", "effect", "when", "description"] as const).some(
          (k) => patch[k] !== undefined && patch[k] !== current[k],
        );
        if (changesMore) {
          throw new GatewayError(
            "invalid",
            current.source === "preset"
              ? "Shipped rules cannot be changed. Switch this one off and write your own instead."
              : "Rules from the tenant package cannot be changed here. Switch this one off, or change the package.",
          );
        }
      }
      const next: Rule = {
        ...current,
        name: patch.name ?? current.name,
        effect: patch.effect ?? current.effect,
        when: patch.when ?? current.when,
        description: patch.description ?? current.description,
        enabled: patch.enabled ?? current.enabled,
      };
      if (!fixed) this.checkInput(next);
      next.name = next.name.trim();
      next.description = next.description.trim();
      this.db.run(
        `UPDATE gateway_rules SET name = ?, effect = ?, cel = ?, description = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
        [
          next.name,
          next.effect,
          next.when,
          next.description,
          next.enabled ? 1 : 0,
          this.now().toISOString(),
          id,
        ],
      );
      this.cached = undefined;
      this.record("updated", next, current);
      return next;
    });
  }

  remove(id: string): void {
    this.withAudit(() => {
      const current = this.get(id);
      if (!current) throw new GatewayError("not_found", "There is no rule with that id.");
      if (current.source === "preset" || current.source === "tenant") {
        throw new GatewayError(
          "invalid",
          current.source === "preset"
            ? "Shipped rules cannot be deleted. Switch this one off instead."
            : "Rules from the tenant package cannot be deleted here. Switch this one off instead.",
        );
      }
      this.db.run("DELETE FROM gateway_rules WHERE id = ?", [id]);
      this.cached = undefined;
      this.record("removed", current);
    });
  }

  /**
   * Brings presets and tenant rules in line with what ships: inserts new ones, updates changed ones
   * (keeping the person's on/off choice), and removes ones that are gone. A tenant rule that does
   * not compile stops the start with a readable error rather than refusing every call later.
   */
  sync(presets: readonly PresetRule[], tenantRules: TenantPackage["rules"]): void {
    for (const p of presets) {
      try {
        this.engine.validate(p.when);
      } catch (err) {
        throw new Error(`Shipped rule '${p.name}' is broken: ${(err as Error).message}`);
      }
    }
    const seenNames = new Set<string>();
    for (const t of tenantRules) {
      try {
        this.checkInput({ name: t.name, effect: t.effect, when: t.when, description: t.description ?? "" });
      } catch (err) {
        throw new Error(`The tenant rule '${t.name}' cannot be used: ${(err as Error).message}`);
      }
      if (seenNames.has(t.name.trim()))
        throw new Error(`The tenant package has two rules named '${t.name}'.`);
      seenNames.add(t.name.trim());
    }

    const changes = { added: [] as string[], updated: [] as string[], removed: [] as string[] };
    this.withAudit(() => {
      const at = this.now().toISOString();
      const existing = this.db.all<RuleRow>(
        "SELECT * FROM gateway_rules WHERE source IN ('preset', 'tenant')",
      );
      const byId = new Map(existing.filter((r) => r.source === "preset").map((r) => [r.id, r]));
      const byName = new Map(existing.filter((r) => r.source === "tenant").map((r) => [r.name, r]));

      const upsert = (
        row: RuleRow | undefined,
        want: { id: string; name: string; effect: Effect; when: string; description: string; source: string },
      ) => {
        if (!row) {
          this.db.run(
            `INSERT INTO gateway_rules (id, name, effect, cel, description, source, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [want.id, want.name, want.effect, want.when, want.description, want.source, at, at],
          );
          changes.added.push(want.name);
          return;
        }
        if (
          row.name !== want.name ||
          row.effect !== want.effect ||
          row.cel !== want.when ||
          row.description !== want.description
        ) {
          this.db.run(
            "UPDATE gateway_rules SET name = ?, effect = ?, cel = ?, description = ?, updated_at = ? WHERE id = ?",
            [want.name, want.effect, want.when, want.description, at, row.id],
          );
          changes.updated.push(want.name);
        }
      };

      for (const p of presets) upsert(byId.get(p.id), { ...p, source: "preset" });
      for (const t of tenantRules) {
        const name = t.name.trim();
        const row = byName.get(name);
        upsert(row, {
          id: row?.id ?? newId("rule"),
          name,
          effect: t.effect,
          when: t.when,
          description: (t.description ?? "").trim(),
          source: "tenant",
        });
      }

      const keepPresets = new Set(presets.map((p) => p.id));
      for (const row of existing) {
        const gone = row.source === "preset" ? !keepPresets.has(row.id) : !seenNames.has(row.name);
        if (!gone) continue;
        this.db.run("DELETE FROM gateway_rules WHERE id = ?", [row.id]);
        changes.removed.push(row.name);
      }

      this.cached = undefined;
      if (changes.added.length + changes.updated.length + changes.removed.length > 0) {
        this.pending.push(
          this.audit.insert({
            type: "policy.changed",
            actorId: "system",
            detail: { change: "synced", ...changes },
          }),
        );
      }
    });
  }

  private record(change: "created" | "updated" | "removed", rule: Rule, before?: Rule): void {
    const detail: Record<string, unknown> = {
      change,
      summary: `${change === "created" ? "Added" : change === "updated" ? "Changed" : "Removed"} the rule '${rule.name}'`,
      ruleEffect: rule.effect,
      when: rule.when,
      enabled: rule.enabled,
    };
    if (before && before.enabled !== rule.enabled) detail.switched = rule.enabled ? "on" : "off";
    this.pending.push(
      this.audit.insert({
        type: "policy.changed",
        actorId: POLICY_ACTOR,
        rule: { id: rule.id, name: rule.name, source: rule.source },
        detail,
      }),
    );
  }

  /** Runs `fn` in a transaction and announces the audit rows it wrote once it commits. */
  private withAudit<T>(fn: () => T): T {
    try {
      const out = this.db.tx(fn);
      this.flushAudit();
      return out;
    } catch (err) {
      this.discardAudit();
      throw err;
    }
  }

  /** Audit rows written inside a transaction that has not been announced yet. */
  private pending: AuditEvent[] = [];

  /** Announces queued audit rows. Called after the outermost transaction commits. */
  flushAudit(): void {
    const events = this.pending;
    this.pending = [];
    for (const e of events) this.audit.publish(e);
  }

  /** Forgets queued audit rows from a transaction that rolled back. */
  discardAudit(): void {
    this.pending = [];
    this.cached = undefined;
  }
}
