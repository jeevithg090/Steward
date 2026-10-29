import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isBuiltinTool, MCP_TOOL_PREFIX, type Skill, type TenantPackage } from "@steward/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * A tenant package is a folder of five YAML files that makes Steward someone's own: the brand, the
 * agents, the skills, extra rules and the model. Every file is optional; a missing one falls back to
 * Steward's defaults. A file that is there but wrong stops start-up with a message that names the
 * file and the field, because a silently ignored typo in a rule is a rule that does not apply.
 */

export const DEFAULT_BRAND = {
  name: "Steward",
  tagline: "Does the work, asks before it acts, keeps a record you can read.",
  accent: "#0f6e66",
  voice: "Plain, warm, brief. Says what it did and what it needs.",
} as const;

export const DEFAULT_STARTERS = [
  "What needs me today?",
  "Open news.ycombinator.com and tell me the top story.",
] as const;

export const DEFAULT_MODEL = { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" } as const;

export class TenantError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "TenantError";
  }
}

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const idField = (what: string) =>
  z
    .string()
    .regex(ID, `${what} must be lower case letters, digits and hyphens, starting with a letter or digit`);

/** A CSS colour, without anything that could break out of a style declaration. */
const colour = z
  .string()
  .min(1)
  .max(64)
  .refine((v) => !/[;{}<>"'\\]/.test(v), "must be a CSS colour such as #0f6e66");

const toolName = z
  .string()
  .min(1)
  .refine((name) => name === "*" || isBuiltinTool(name) || name.startsWith(MCP_TOOL_PREFIX), {
    error: (issue) =>
      `"${String(issue.input)}" is not a Steward tool. Use "*" for every built-in tool, or a name from the tool list`,
  });

const brandFile = z
  .object({
    name: z.string().min(1).max(60).default(DEFAULT_BRAND.name),
    tagline: z.string().max(200).default(DEFAULT_BRAND.tagline),
    accent: colour.default(DEFAULT_BRAND.accent),
    voice: z.string().max(1000).default(DEFAULT_BRAND.voice),
    starters: z
      .array(z.string().min(1).max(200))
      .max(8)
      .default([...DEFAULT_STARTERS]),
  })
  .strict();

const agentEntry = z
  .object({
    id: idField("id"),
    name: z.string().min(1).max(60),
    title: z.string().max(120).default(""),
    instructions: z.string().max(20_000).default(""),
    skills: z.array(z.string()).default([]),
    tools: z.array(toolName).default(["*"]),
    model: z.string().min(1).optional(),
  })
  .strict();

const agentsFile = z.object({ agents: z.array(agentEntry).min(1) }).strict();

const skillEntry = z
  .object({
    name: idField("name"),
    description: z.string().min(1).max(300),
    instructions: z.string().min(1).max(8000),
    tools: z.array(toolName).default([]),
  })
  .strict();

const skillsFile = z.object({ skills: z.array(skillEntry).default([]) }).strict();

const ruleEntry = z
  .object({
    name: z.string().min(1).max(120),
    effect: z.enum(["allow", "ask", "deny"]),
    when: z.string().min(1).max(2000),
    description: z.string().max(500).default(""),
  })
  .strict();

const rulesFile = z.object({ rules: z.array(ruleEntry).default([]) }).strict();

export const MODEL_PROVIDERS = [
  "openrouter",
  "openai",
  "anthropic",
  "nvidia",
  "gemini",
  "xai",
  "ollama",
  "openai-compatible",
  "scripted",
] as const;

const modelFile = z
  .object({
    provider: z.enum(MODEL_PROVIDERS),
    model: z.string().min(1).max(200),
    baseUrl: z.string().url().optional(),
    apiKeyEnv: z
      .string()
      .regex(
        /^[A-Z][A-Z0-9_]*$/,
        "must be the NAME of an environment variable, such as OPENROUTER_API_KEY, never the key",
      )
      .optional(),
  })
  .strict();

function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (out, part) =>
      typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part),
    "",
  );
}

function describeIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .slice(0, 8)
    .map((issue) => {
      const where = issuePath(issue.path);
      const message =
        issue.code === "unrecognized_keys"
          ? `unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`
          : issue.message;
      return where ? `${where}: ${message}` : message;
    })
    .join("; ");
}

/** Reads one YAML file. Missing or empty → undefined, so the caller uses defaults. */
function readYaml(dir: string, file: string): unknown {
  const path = join(dir, file);
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new TenantError(`${file}: could not be read (${(error as Error).message})`, file);
  }
  try {
    const value = parseYaml(text);
    return value ?? undefined;
  } catch (error) {
    const reason = (error as Error).message.split("\n")[0];
    throw new TenantError(`${file}: is not valid YAML: ${reason}`, file);
  }
}

function validate<S extends z.ZodType>(schema: S, value: unknown, file: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new TenantError(`${file}: ${describeIssues(result.error.issues)}`, file);
  return result.data;
}

/**
 * Reads `tenants/<id>/` and returns the validated package. The folder name is the tenant id.
 * Throws `TenantError` naming the file and the field when something is wrong.
 */
export function loadTenant(dir: string): TenantPackage {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new TenantError(`Tenant folder not found: ${root}`, root);
  }
  const id = basename(root);

  const brandRaw = readYaml(root, "brand.yaml");
  const brand = validate(brandFile, brandRaw ?? {}, "brand.yaml");

  const skillsRaw = readYaml(root, "skills.yaml");
  const skillDefs = validate(skillsFile, skillsRaw ?? {}, "skills.yaml").skills;
  const skillNames = new Set<string>();
  skillDefs.forEach((skill, i) => {
    if (skillNames.has(skill.name)) {
      throw new TenantError(`skills.yaml: skills[${i}].name: "${skill.name}" is used twice`, "skills.yaml");
    }
    skillNames.add(skill.name);
  });
  const skills: Skill[] = skillDefs.map((s) => ({
    id: `tenant:${s.name}`,
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    tools: s.tools,
    source: "tenant",
  }));

  const agentsRaw = readYaml(root, "agents.yaml");
  const agentDefs =
    agentsRaw === undefined
      ? [
          {
            id: "steward",
            name: brand.name,
            title: "Your steward",
            instructions: "",
            skills: [],
            tools: ["*"],
          },
        ]
      : validate(agentsFile, agentsRaw, "agents.yaml").agents;
  const agentIds = new Set<string>();
  agentDefs.forEach((agent, i) => {
    if (agentIds.has(agent.id)) {
      throw new TenantError(`agents.yaml: agents[${i}].id: "${agent.id}" is used twice`, "agents.yaml");
    }
    agentIds.add(agent.id);
    agent.skills.forEach((name, j) => {
      if (!skillNames.has(name)) {
        const known =
          skillNames.size > 0 ? `skills.yaml has: ${[...skillNames].join(", ")}` : "skills.yaml has none";
        throw new TenantError(
          `agents.yaml: agents[${i}].skills[${j}]: no skill named "${name}" (${known})`,
          "agents.yaml",
        );
      }
    });
  });

  const rulesRaw = readYaml(root, "rules.yaml");
  const rules = validate(rulesFile, rulesRaw ?? {}, "rules.yaml").rules;

  const modelRaw = readYaml(root, "model.yaml");
  const model = modelRaw === undefined ? { ...DEFAULT_MODEL } : validate(modelFile, modelRaw, "model.yaml");

  const { starters, ...brandFields } = brand;
  return {
    id,
    brand: brandFields,
    agents: agentDefs.map((a) => ({
      id: a.id,
      name: a.name,
      title: a.title,
      instructions: a.instructions,
      skills: a.skills,
      tools: a.tools,
      ...(a.model ? { model: a.model } : {}),
    })),
    skills,
    rules,
    model,
    starters,
  };
}
