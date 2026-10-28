import type { Db } from "@steward/db";
import { fromJson, toJson } from "@steward/db";
import type { BotPack, InstalledBot } from "@steward/shared";

/** One installed bot as the server keeps it: the listing facts, the pack, and what it brought. */
export interface InstalledBotRecord extends Omit<InstalledBot, "updateAvailable"> {
  pack: BotPack;
}

interface Row {
  id: string;
  name: string;
  version: number;
  hash: string;
  source: string;
  installed_at: string;
  updated_at: string;
  agent_id: string;
  pack_json: string;
  skill_ids_json: string;
  rule_ids_json: string;
  routine_ids_json: string;
}

function toRecord(row: Row): InstalledBotRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    hash: row.hash,
    source: row.source,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    agentId: row.agent_id,
    pack: fromJson<BotPack>(row.pack_json, {} as BotPack),
    skillIds: fromJson<string[]>(row.skill_ids_json, []),
    ruleIds: fromJson<string[]>(row.rule_ids_json, []),
    routineIds: fromJson<string[]>(row.routine_ids_json, []),
  };
}

/** The installed bot as the API shows it, without the pack. */
export function toInstalledBot(record: InstalledBotRecord): InstalledBot {
  const { pack: _pack, ...rest } = record;
  return rest;
}

/**
 * Bots the person added from the directory. The pack is kept whole so the agent can be rebuilt at
 * every start without the directory; the ids say what to remove when the bot goes.
 */
export class InstalledBotStore {
  constructor(private readonly db: Db) {}

  list(): InstalledBotRecord[] {
    return this.db.all<Row>("SELECT * FROM installed_bots ORDER BY installed_at, id").map(toRecord);
  }

  get(id: string): InstalledBotRecord | undefined {
    const row = this.db.get<Row>("SELECT * FROM installed_bots WHERE id = ?", [id]);
    return row ? toRecord(row) : undefined;
  }

  /** Inserts, or replaces everything but `installedAt` when the bot is already there. */
  upsert(
    record: Omit<InstalledBotRecord, "installedAt" | "updatedAt"> & { at?: string },
  ): InstalledBotRecord {
    const at = record.at ?? new Date().toISOString();
    this.db.run(
      `INSERT INTO installed_bots
         (id, name, version, hash, source, installed_at, updated_at, agent_id, pack_json,
          skill_ids_json, rule_ids_json, routine_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         version = excluded.version,
         hash = excluded.hash,
         source = excluded.source,
         updated_at = excluded.updated_at,
         agent_id = excluded.agent_id,
         pack_json = excluded.pack_json,
         skill_ids_json = excluded.skill_ids_json,
         rule_ids_json = excluded.rule_ids_json,
         routine_ids_json = excluded.routine_ids_json`,
      [
        record.id,
        record.name,
        record.version,
        record.hash,
        record.source,
        at,
        at,
        record.agentId,
        toJson(record.pack),
        toJson(record.skillIds),
        toJson(record.ruleIds),
        toJson(record.routineIds),
      ],
    );
    return this.get(record.id)!;
  }

  remove(id: string): void {
    this.db.run("DELETE FROM installed_bots WHERE id = ?", [id]);
  }
}
