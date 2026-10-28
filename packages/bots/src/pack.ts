import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { type BotPack, BotPackSchema, type SkillPack } from "@steward/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ZodIssue } from "zod";
import { parseSkillMd, serializeSkillMd } from "./skill.ts";

/**
 * A bot on disk (plan §1): `bot.yaml` with everything but the prose, `README.md` with the listing
 * text, and one `skills/<name>/SKILL.md` per skill. The folder is the unit people write, review
 * and submit; `packs/<id>.json` is what Steward downloads.
 */

export class BotPackError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "BotPackError";
  }
}

/** The keys `bot.yaml` may hold, in the order they are written back. Anything else is a typo. */
const BOT_YAML_KEYS = [
  "id",
  "name",
  "pitch",
  "category",
  "version",
  "author",
  "licence",
  "needs",
  "instructions",
  "starters",
  "examples",
  "skills",
  "rules",
  "routines",
  "shortcuts",
  "hash",
] as const;

export function issuePath(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (out, part) => (typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${part}` : part),
    "",
  );
}

export const ONLY_TIGHTEN = "A bot can only tighten the rules: a rule may ask or deny, never allow";

/** The schema refuses `allow` as an unknown enum value; this says why instead. */
export function issueMessage(issue: ZodIssue, input: unknown): string {
  const [head, index, field] = issue.path;
  if (head === "rules" && typeof index === "number" && field === "effect") {
    const rules = (input as { rules?: unknown } | undefined)?.rules;
    const rule = Array.isArray(rules) ? (rules[index] as { effect?: unknown } | undefined) : undefined;
    if (rule?.effect === "allow") return ONLY_TIGHTEN;
  }
  return issue.message;
}

export function describeIssues(issues: readonly ZodIssue[], input?: unknown): string {
  return issues
    .slice(0, 8)
    .map((issue) => {
      const where = issuePath(issue.path);
      const message = issueMessage(issue, input);
      return where ? `${where}: ${message}` : message;
    })
    .join("; ");
}

async function readText(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  return readFile(path, "utf8");
}

async function skillFolders(dir: string): Promise<string[]> {
  const skillsDir = join(dir, "skills");
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) return [];
  const entries = await readdir(skillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Reads a bot folder and returns the validated pack. `bot.yaml` lists its skills by folder name;
 * when it does not, every `skills/<name>/SKILL.md` is taken. Throws `BotPackError` naming the file
 * and the field. The hash is kept when `bot.yaml` has one and left out otherwise; `buildIndex`
 * sets it.
 */
export async function parseBotFolder(dir: string): Promise<BotPack> {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new BotPackError(`Bot folder not found: ${root}`, root);
  }
  const yamlText = await readText(join(root, "bot.yaml"));
  if (yamlText === undefined) throw new BotPackError("bot.yaml: is missing", "bot.yaml");
  let raw: unknown;
  try {
    raw = parseYaml(yamlText) ?? {};
  } catch (error) {
    const reason = (error as Error).message.split("\n")[0];
    throw new BotPackError(`bot.yaml: is not valid YAML: ${reason}`, "bot.yaml");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BotPackError("bot.yaml: must be a map of fields", "bot.yaml");
  }
  const fields = raw as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!(BOT_YAML_KEYS as readonly string[]).includes(key)) {
      throw new BotPackError(`bot.yaml: unknown field "${key}"`, "bot.yaml");
    }
  }

  let names: string[];
  if (fields.skills === undefined || fields.skills === null) {
    names = await skillFolders(root);
  } else if (Array.isArray(fields.skills) && fields.skills.every((s) => typeof s === "string")) {
    names = fields.skills as string[];
  } else {
    throw new BotPackError("bot.yaml: skills: must be a list of skill folder names", "bot.yaml");
  }

  const skills: SkillPack[] = [];
  for (const name of names) {
    const file = join("skills", name, "SKILL.md");
    const text = await readText(join(root, file));
    if (text === undefined) throw new BotPackError(`${file}: is missing`, file);
    let skill: SkillPack;
    try {
      skill = parseSkillMd(text);
    } catch (error) {
      throw new BotPackError(`${file}: ${(error as Error).message}`, file);
    }
    if (skill.name !== name) {
      throw new BotPackError(`${file}: name: "${skill.name}" must match the folder name "${name}"`, file);
    }
    skills.push(skill);
  }

  const readme = (await readText(join(root, "README.md")))?.trimEnd() ?? "";
  const input = { ...fields, skills, readme };
  const checked = BotPackSchema.safeParse(input);
  if (!checked.success) {
    throw new BotPackError(`bot.yaml: ${describeIssues(checked.error.issues, input)}`, "bot.yaml");
  }
  return checked.data;
}

/** Writes a pack as a folder, the inverse of `parseBotFolder`. Existing files are overwritten. */
export async function writeBotFolder(dir: string, pack: BotPack): Promise<void> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  const checked = BotPackSchema.parse(pack);
  const { readme, skills, ...rest } = checked;
  const doc: Record<string, unknown> = {};
  for (const key of BOT_YAML_KEYS) {
    if (key === "skills") {
      if (skills.length > 0) doc.skills = skills.map((s) => s.name);
      continue;
    }
    const value = (rest as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    doc[key] = value;
  }
  await writeFile(join(root, "bot.yaml"), stringifyYaml(doc, { lineWidth: 0 }), "utf8");
  if (readme) await writeFile(join(root, "README.md"), `${readme.trimEnd()}\n`, "utf8");
  for (const skill of skills) {
    const skillDir = join(root, "skills", skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), serializeSkillMd(skill), "utf8");
  }
}

/** The folder's name, which the directory expects to be the bot's id. */
export function folderId(dir: string): string {
  return basename(resolve(dir));
}
