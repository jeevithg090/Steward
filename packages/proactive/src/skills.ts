import type { Db } from "@steward/db";
import { fromJson, toJson } from "@steward/db";
import type { Skill, SkillStore } from "@steward/shared";
import { newId } from "@steward/shared";
import { ProactiveError, requireText } from "./errors.ts";

/** The same shape `SkillBody` accepts: lower-case letters, digits and hyphens, read as `/name`. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_TOOLS = 50;

interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    tools: fromJson<string[]>(row.tools, []),
    source: row.source as Skill["source"],
  };
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/^\//, "").toLowerCase() : "";
  if (!NAME_PATTERN.test(name)) {
    throw new ProactiveError(
      "invalid",
      "A skill name uses lower-case letters, numbers and hyphens, like weekly-review, and is at most 41 characters.",
    );
  }
  return name;
}

function cleanTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tools = new Set<string>();
  for (const tool of value) {
    if (typeof tool === "string" && tool.trim()) tools.add(tool.trim());
  }
  return [...tools].slice(0, MAX_TOOLS);
}

function cleanInput(input: Omit<Skill, "id" | "source">) {
  return {
    name: cleanName(input.name),
    description: requireText(
      input.description,
      300,
      "Say in a line what the skill is for.",
      "Keep the description under 300 characters.",
    ),
    instructions: requireText(
      input.instructions,
      8000,
      "A skill needs instructions.",
      "Keep the instructions under 8,000 characters.",
    ),
    tools: cleanTools(input.tools),
  };
}

/**
 * Skills: instructions written once and called with `/name`.
 *
 * Tenant skills come from the tenant package on every start. They are re-seeded each time (so a
 * skill removed from the package disappears) and are read only: changing one means making your own.
 * The person's skills are theirs to edit. Names are unique across both, ignoring case; when a
 * tenant skill arrives with a name the person already uses, the person's own skill wins.
 */
export function createSkillStore(opts: { db: Db; now: () => Date; tenantSkills?: Skill[] }): SkillStore {
  const { db, now } = opts;

  function seedTenantSkills(skills: Skill[]): void {
    db.tx(() => {
      db.run("DELETE FROM proactive_skills WHERE source = 'tenant'");
      const at = now().toISOString();
      for (const skill of skills) {
        let clean: ReturnType<typeof cleanInput>;
        try {
          clean = cleanInput(skill);
        } catch {
          continue; // A malformed tenant skill is left out rather than stopping the server.
        }
        const taken = db.get<{ id: string }>("SELECT id FROM proactive_skills WHERE name = ?", [clean.name]);
        if (taken) continue;
        const id = skill.id?.trim() || `skl_tenant_${clean.name}`;
        const idTaken = db.get<{ id: string }>("SELECT id FROM proactive_skills WHERE id = ?", [id]);
        db.run(
          `INSERT INTO proactive_skills (id, name, description, instructions, tools, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'tenant', ?, ?)`,
          [
            idTaken ? `skl_tenant_${clean.name}` : id,
            clean.name,
            clean.description,
            clean.instructions,
            toJson(clean.tools),
            at,
            at,
          ],
        );
      }
    });
  }

  seedTenantSkills(opts.tenantSkills ?? []);

  function byId(id: string): SkillRow | undefined {
    return db.get<SkillRow>("SELECT * FROM proactive_skills WHERE id = ?", [id]);
  }

  function nameTaken(name: string, exceptId?: string): boolean {
    const row = db.get<{ id: string }>("SELECT id FROM proactive_skills WHERE name = ?", [name]);
    return row !== undefined && row.id !== exceptId;
  }

  function editable(id: string): SkillRow {
    const row = byId(id);
    if (!row) throw new ProactiveError("not_found", "Couldn't find that skill.");
    if (row.source === "tenant") {
      throw new ProactiveError(
        "read_only",
        "This skill comes with Steward and can't be changed. Make your own copy instead.",
      );
    }
    return row;
  }

  return {
    list() {
      return db.all<SkillRow>("SELECT * FROM proactive_skills ORDER BY name").map(toSkill);
    },

    /** By id, or by name with or without the leading slash, ignoring case. */
    get(idOrName) {
      const key = idOrName.trim();
      if (!key) return undefined;
      const row =
        byId(key) ??
        db.get<SkillRow>("SELECT * FROM proactive_skills WHERE name = ?", [
          key.replace(/^\//, "").toLowerCase(),
        ]);
      return row ? toSkill(row) : undefined;
    },

    create(input) {
      const clean = cleanInput(input);
      if (nameTaken(clean.name)) {
        throw new ProactiveError(
          "conflict",
          `There is already a skill called /${clean.name}. Choose another name.`,
        );
      }
      const at = now().toISOString();
      const id = newId("skl");
      db.run(
        `INSERT INTO proactive_skills (id, name, description, instructions, tools, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'person', ?, ?)`,
        [id, clean.name, clean.description, clean.instructions, toJson(clean.tools), at, at],
      );
      return toSkill(byId(id)!);
    },

    update(id, input) {
      editable(id);
      const clean = cleanInput(input);
      if (nameTaken(clean.name, id)) {
        throw new ProactiveError(
          "conflict",
          `There is already a skill called /${clean.name}. Choose another name.`,
        );
      }
      db.run(
        `UPDATE proactive_skills SET name = ?, description = ?, instructions = ?, tools = ?, updated_at = ?
         WHERE id = ?`,
        [clean.name, clean.description, clean.instructions, toJson(clean.tools), now().toISOString(), id],
      );
      return toSkill(byId(id)!);
    },

    remove(id) {
      editable(id);
      db.run("DELETE FROM proactive_skills WHERE id = ?", [id]);
    },
  };
}
