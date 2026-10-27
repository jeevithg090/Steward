import type { Db } from "@steward/db";
import type { MemoryFact, MemoryStore } from "@steward/shared";
import { newId } from "@steward/shared";
import { ProactiveError, requireText } from "./errors.ts";

interface MemoryRow {
  id: string;
  text: string;
  source: string;
  created_at: string;
}

function toFact(row: MemoryRow): MemoryFact {
  return {
    id: row.id,
    text: row.text,
    source: row.source as MemoryFact["source"],
    createdAt: row.created_at,
  };
}

/**
 * What Steward remembers about the person, newest first. Adding a fact it already holds (ignoring
 * case and spacing) returns the one it has, so "remember that" twice does not make two rows.
 */
export function createMemoryStore(opts: { db: Db; now: () => Date }): MemoryStore {
  const { db, now } = opts;

  return {
    list() {
      return db.all<MemoryRow>("SELECT * FROM proactive_memory ORDER BY rowid DESC").map(toFact);
    },

    add(text, source) {
      const clean = requireText(
        typeof text === "string" ? text.replace(/\s+/g, " ") : text,
        1000,
        "Say what to remember.",
        "Keep a fact under 1,000 characters.",
      );
      if (source !== "you" && source !== "learned") {
        throw new ProactiveError("invalid", "A fact comes from you or from what Steward learned.");
      }
      const existing = db.get<MemoryRow>("SELECT * FROM proactive_memory WHERE lower(text) = lower(?)", [
        clean,
      ]);
      if (existing) return toFact(existing);
      const fact: MemoryFact = { id: newId("mem"), text: clean, source, createdAt: now().toISOString() };
      db.run("INSERT INTO proactive_memory (id, text, source, created_at) VALUES (?, ?, ?, ?)", [
        fact.id,
        fact.text,
        fact.source,
        fact.createdAt,
      ]);
      return fact;
    },

    remove(id) {
      const { changes } = db.run("DELETE FROM proactive_memory WHERE id = ?", [id]);
      if (changes === 0)
        throw new ProactiveError("not_found", "Couldn't find that fact. It may already be forgotten.");
    },
  };
}
