/**
 * The `/` skill picker's matching. A draft that is a slash and a partial name ("/wee") lists the
 * skills whose names start with it first, then those that contain it.
 */
import type { Skill } from "@steward/shared";

/** The partial skill name being typed, or undefined when the draft is not a bare `/name`. */
export function slashQuery(draft: string): string | undefined {
  const match = draft.match(/^\/([a-z0-9-]*)$/i);
  return match ? (match[1] ?? "").toLowerCase() : undefined;
}

export function matchSkills(skills: readonly Skill[], query: string, limit = 8): Skill[] {
  const starts = skills.filter((skill) => skill.name.toLowerCase().startsWith(query));
  const contains = skills.filter(
    (skill) => !skill.name.toLowerCase().startsWith(query) && skill.name.toLowerCase().includes(query),
  );
  return [...starts, ...contains].slice(0, limit);
}
