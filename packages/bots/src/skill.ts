import { type SkillPack, SkillPackSchema } from "@steward/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * `SKILL.md` as the Agent Skills spec (agentskills.io/specification) defines it: a YAML frontmatter
 * block with `name`, `description` and the optional `license`, `compatibility`, `metadata` and
 * `allowed-tools`, then Markdown instructions. Steward keeps the same shape so a skill written for
 * any agent can be installed here, and ours can be installed elsewhere.
 */

export class SkillMdError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "SkillMdError";
  }
}

/** The spec's name rule: 1–64 lowercase letters, digits and single hyphens, matching the folder. */
export const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The fields the spec names, in the order they are written back. Anything else is an error. */
const FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"] as const;

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/;

function text(
  raw: Record<string, unknown>,
  field: string,
  opts: { max: number; required?: boolean },
): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null) {
    if (opts.required) throw new SkillMdError(`${field}: is required`, field);
    return undefined;
  }
  if (typeof value !== "string") throw new SkillMdError(`${field}: must be text`, field);
  if (value.trim() === "") throw new SkillMdError(`${field}: must not be empty`, field);
  if (value.length > opts.max) {
    throw new SkillMdError(`${field}: is too long: at most ${opts.max} characters`, field);
  }
  return value;
}

/** Reads one `SKILL.md`. Errors name the field; the body is the Markdown after the frontmatter. */
export function parseSkillMd(source: string): SkillPack {
  const input = source.startsWith("﻿") ? source.slice(1) : source;
  const match = FRONTMATTER.exec(input);
  if (!match) {
    throw new SkillMdError(
      "frontmatter: SKILL.md must start with a --- block holding name and description, closed by ---",
      "frontmatter",
    );
  }
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "");
  } catch (error) {
    const reason = (error as Error).message.split("\n")[0];
    throw new SkillMdError(`frontmatter: is not valid YAML: ${reason}`, "frontmatter");
  }
  if (raw === null || raw === undefined) throw new SkillMdError("frontmatter: is empty", "frontmatter");
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SkillMdError("frontmatter: must be a map of fields", "frontmatter");
  }
  const fields = raw as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      throw new SkillMdError(`${key}: is not a SKILL.md field; put extra details under metadata`, key);
    }
  }

  const name = text(fields, "name", { max: 64, required: true }) ?? "";
  if (!SKILL_NAME.test(name) || name.includes("--")) {
    throw new SkillMdError(
      `name: "${name}" must be lowercase letters, digits and single hyphens, and match its folder`,
      "name",
    );
  }
  const description = text(fields, "description", { max: 1024, required: true }) ?? "";
  const license = text(fields, "license", { max: 120 });
  const compatibility = text(fields, "compatibility", { max: 500 });

  let metadata: Record<string, string> | undefined;
  if (fields.metadata !== undefined && fields.metadata !== null) {
    const value = fields.metadata;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new SkillMdError("metadata: must be a map of text values", "metadata");
    }
    metadata = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item !== "string")
        throw new SkillMdError(`metadata.${key}: must be text`, `metadata.${key}`);
      metadata[key] = item;
    }
  }

  let allowedTools: string[] | undefined;
  if (fields["allowed-tools"] !== undefined && fields["allowed-tools"] !== null) {
    const value = fields["allowed-tools"];
    if (typeof value !== "string") {
      throw new SkillMdError("allowed-tools: must be tool names separated by spaces", "allowed-tools");
    }
    allowedTools = value.split(/\s+/).filter(Boolean);
  }

  const body = input
    .slice(match[0].length)
    .replace(/^(?:\r?\n)+/, "")
    .trimEnd();
  if (!body) throw new SkillMdError("body: SKILL.md needs instructions after the frontmatter", "body");

  const skill: SkillPack = {
    name,
    description,
    body,
    ...(license !== undefined ? { license } : {}),
    ...(compatibility !== undefined ? { compatibility } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(allowedTools !== undefined ? { allowedTools } : {}),
  };
  const checked = SkillPackSchema.safeParse(skill);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const field = issue?.path.join(".") || "frontmatter";
    throw new SkillMdError(`${field}: ${issue?.message ?? "is not valid"}`, field);
  }
  return checked.data;
}

/** Writes a skill back as `SKILL.md`. `parseSkillMd(serializeSkillMd(skill))` gives `skill` again. */
export function serializeSkillMd(skill: SkillPack): string {
  const frontmatter: Record<string, unknown> = { name: skill.name, description: skill.description };
  if (skill.license !== undefined) frontmatter.license = skill.license;
  if (skill.compatibility !== undefined) frontmatter.compatibility = skill.compatibility;
  if (skill.metadata !== undefined) frontmatter.metadata = skill.metadata;
  if (skill.allowedTools !== undefined) frontmatter["allowed-tools"] = skill.allowedTools.join(" ");
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${skill.body.trimEnd()}\n`;
}
