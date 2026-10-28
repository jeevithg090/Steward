import type { Migration } from "@steward/db";

/**
 * The gateway's tables: rules, approvals and the record. The record refuses UPDATE and DELETE at
 * the database level; the hash chain catches anything that gets past that.
 */
export const migrations: Migration[] = [
  {
    id: "gateway.001_rules",
    sql: `
      CREATE TABLE gateway_rules (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        effect      TEXT NOT NULL CHECK (effect IN ('allow', 'ask', 'deny')),
        cel         TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL CHECK (source IN ('preset', 'tenant', 'person', 'always')),
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX gateway_rules_tenant_name ON gateway_rules(name) WHERE source = 'tenant';
      CREATE INDEX gateway_rules_source ON gateway_rules(source, created_at);
    `,
  },
  {
    id: "gateway.002_approvals",
    sql: `
      CREATE TABLE gateway_approvals (
        id              TEXT PRIMARY KEY,
        tool_call_id    TEXT NOT NULL UNIQUE,
        run_id          TEXT NOT NULL,
        thread_id       TEXT NOT NULL,
        agent_id        TEXT NOT NULL,
        actor_id        TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'allowed', 'refused', 'expired', 'cancelled')),
        summary         TEXT NOT NULL,
        tool_json       TEXT NOT NULL CHECK (json_valid(tool_json)),
        args_json       TEXT NOT NULL CHECK (json_valid(args_json)),
        target_json     TEXT NOT NULL CHECK (json_valid(target_json)),
        decision_json   TEXT NOT NULL CHECK (json_valid(decision_json)),
        initiator_json  TEXT NOT NULL CHECK (json_valid(initiator_json)),
        digest          TEXT NOT NULL,
        can_always      INTEGER NOT NULL CHECK (can_always IN (0, 1)),
        answer          TEXT CHECK (answer IN ('once', 'always', 'refuse')),
        note            TEXT,
        decided_by      TEXT,
        claimed_at      TEXT,
        created_rule_id TEXT,
        created_at      TEXT NOT NULL,
        decided_at      TEXT,
        expires_at      TEXT NOT NULL
      );
      CREATE INDEX gateway_approvals_status ON gateway_approvals(status, created_at);
      CREATE INDEX gateway_approvals_thread ON gateway_approvals(thread_id, created_at);
    `,
  },
  {
    id: "gateway.003_audit",
    sql: `
      CREATE TABLE gateway_audit (
        seq          INTEGER PRIMARY KEY,
        id           TEXT NOT NULL UNIQUE,
        at           TEXT NOT NULL,
        type         TEXT NOT NULL,
        actor_id     TEXT NOT NULL,
        agent_id     TEXT,
        thread_id    TEXT,
        run_id       TEXT,
        tool_call_id TEXT,
        tool_json    TEXT,
        target_json  TEXT,
        effect       TEXT,
        rule_json    TEXT,
        detail_json  TEXT NOT NULL,
        prev_hash    TEXT NOT NULL,
        hash         TEXT NOT NULL
      );
      CREATE INDEX gateway_audit_type ON gateway_audit(type, seq);
      CREATE INDEX gateway_audit_effect ON gateway_audit(effect, seq);
      CREATE INDEX gateway_audit_tool_call ON gateway_audit(tool_call_id);
      CREATE INDEX gateway_audit_thread ON gateway_audit(thread_id, seq);
      CREATE TRIGGER gateway_audit_no_update BEFORE UPDATE ON gateway_audit
      BEGIN SELECT RAISE(ABORT, 'The record is append-only: rows cannot be changed.'); END;
      CREATE TRIGGER gateway_audit_no_delete BEFORE DELETE ON gateway_audit
      BEGIN SELECT RAISE(ABORT, 'The record is append-only: rows cannot be deleted.'); END;
    `,
  },
  {
    // Bots bring rules too (ask or deny only). SQLite cannot change a CHECK in place, so the table
    // is rebuilt with the wider list and its rows and indexes carried over.
    id: "gateway.004_rule_source_bot",
    sql: `
      CREATE TABLE gateway_rules_new (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        effect      TEXT NOT NULL CHECK (effect IN ('allow', 'ask', 'deny')),
        cel         TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL CHECK (source IN ('preset', 'tenant', 'person', 'always', 'bot')),
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      INSERT INTO gateway_rules_new SELECT id, name, effect, cel, description, source, enabled, created_at, updated_at FROM gateway_rules;
      DROP TABLE gateway_rules;
      ALTER TABLE gateway_rules_new RENAME TO gateway_rules;
      CREATE UNIQUE INDEX gateway_rules_tenant_name ON gateway_rules(name) WHERE source = 'tenant';
      CREATE INDEX gateway_rules_source ON gateway_rules(source, created_at);
    `,
  },
  {
    // What a phone may answer depends on these facts about the call that asked (device presets).
    id: "gateway.005_approval_facts",
    sql: `
      ALTER TABLE gateway_approvals ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0 CHECK (tainted IN (0, 1));
      ALTER TABLE gateway_approvals ADD COLUMN credential_entry INTEGER NOT NULL DEFAULT 0 CHECK (credential_entry IN (0, 1));
    `,
  },
];
