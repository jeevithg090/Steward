import type { Migration } from "@steward/db";

/** Tables owned by `@steward/connectors`. */
export const migrations: Migration[] = [
  {
    id: "connectors.001_mcp_servers",
    sql: `
      CREATE TABLE connectors_mcp_servers (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        transport    TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
        command      TEXT,
        args_json    TEXT NOT NULL DEFAULT '[]',
        url          TEXT,
        -- Tool names the person granted, and the ones they marked as reads. Everything else is a write.
        granted_json TEXT NOT NULL DEFAULT '[]',
        reads_json   TEXT NOT NULL DEFAULT '[]',
        -- The last tool listing, so tools can be offered before the server has reconnected.
        tools_json   TEXT NOT NULL DEFAULT '[]',
        listed_at    TEXT,
        last_error   TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
    `,
  },
  {
    // Kinds beyond read and write, so a tool that posts or deletes follows the rules for sends and
    // deletes (taint, "Routines never send") instead of passing as a write.
    id: "connectors.002_mcp_kinds",
    sql: `
      ALTER TABLE connectors_mcp_servers ADD COLUMN sends_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE connectors_mcp_servers ADD COLUMN deletes_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    // What each granted tool said it did when the person allowed it: { "<tool>": "<sha256>" }. A
    // server that changes a granted tool afterwards loses it until the person allows it again.
    id: "connectors.003_mcp_pins",
    sql: `
      ALTER TABLE connectors_mcp_servers ADD COLUMN pins_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    // What a server needs to sign in: environment variables (stdio) or an access token (http).
    // Write-only: handed to the server, never sent back to the page. Kept apart from the config so
    // nothing that lists servers reads them by accident.
    id: "connectors.004_mcp_secrets",
    sql: `
      CREATE TABLE connectors_mcp_secrets (
        server_id TEXT NOT NULL REFERENCES connectors_mcp_servers (id) ON DELETE CASCADE,
        kind      TEXT NOT NULL CHECK (kind IN ('env', 'bearer')),
        name      TEXT NOT NULL,
        value     TEXT NOT NULL,
        PRIMARY KEY (server_id, kind, name)
      );
    `,
  },
];
