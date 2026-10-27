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
];
