import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  type ConfigSource,
  configMessage,
  describeConfigIssues,
  isBuiltinTool,
  MCP_TOOL_PREFIX,
  type Skill,
  type TenantPackage,
} from "@steward/shared";
import { parseDocument } from "yaml";
import { z } from "zod";
import { checkTenantRules } from "./tenant-rules.ts";

/**
 * A tenant package is a folder of YAML files that makes Steward someone's own. This loader reads
 * five of them: the brand, the agents, the skills, extra rules and the model. Two more are read
 * where they are used: `harnesses.yaml` (coding agents, `@steward/harnesses`) and `shortcuts.yaml`
 * (phone shortcuts, `@steward/phone`). Every file is optional; a missing one means Steward's
 * built-in defaults, not the files in `tenants/steward/`. A file that is there but wrong stops
 * start-up with a message that names the file and the field, because a silently ignored typo in a
 * rule is a rule that does not apply.
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

/** WCAG contrast of a `#rrggbb` colour against white, the text colour on buttons. */
export function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (l + 0.05);
}

/** The accent: buttons, links and the focus ring, with white text on it. */
const accentColour = z
  .string()
  .superRefine((value, ctx) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: 'must be a colour written as # and six hex digits, such as "#0f6e66"',
      });
    } else if (contrastWithWhite(value) < 4.5) {
      ctx.addIssue({
        code: "custom",
        message: `"${value}" is too light for white text on it (${(Math.floor(contrastWithWhite(value) * 10) / 10).toFixed(1)}:1). Pick a darker colour, with a contrast of at least 4.5:1 against white`,
      });
    }
  })
  .transform((hex) => hex.toLowerCase());

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
    accent: accentColour.default(DEFAULT_BRAND.accent),
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

/** Providers whose address the package gives. Every other one has its own endpoint for its key. */
const ADDRESS_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "openai-compatible"]);

/** Each provider's own key variable. A package never sends one provider's key to another. */
const PROVIDER_KEYS: Record<string, string> = {
  OPENROUTER_API_KEY: "openrouter",
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  NVIDIA_API_KEY: "nvidia",
  GEMINI_API_KEY: "gemini",
  XAI_API_KEY: "xai",
};

/** Hosts on this machine or the local network, where plain http is acceptable. Never cloud metadata. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  // A name without a dot ("ollama", "gpu-box") is resolved on the local network.
  return !host.includes(".") && !host.includes(":") && host !== "";
}

const modelFile = z
  .object({
    provider: z.enum(MODEL_PROVIDERS),
    model: z.string().min(1).max(200),
    baseUrl: z.string().max(500).optional(),
    apiKeyEnv: z
      .string()
      .regex(
        /^[A-Z][A-Z0-9_]*_KEY$/,
        "must be the NAME of an environment variable that ends in _KEY, such as OPENROUTER_API_KEY, never the key",
      )
      .refine((name) => !name.includes("SECRET"), "must name a model key, not another secret")
      .optional(),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.baseUrl !== undefined) {
      if (!ADDRESS_PROVIDERS.has(file.provider)) {
        ctx.addIssue({
          code: "custom",
          path: ["baseUrl"],
          message: `${file.provider} has its own address, so its key only ever goes there. Remove baseUrl, or use provider: openai-compatible for another endpoint`,
        });
      } else {
        let url: URL | undefined;
        try {
          url = new URL(file.baseUrl);
        } catch {
          url = undefined;
        }
        if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
          ctx.addIssue({
            code: "custom",
            path: ["baseUrl"],
            message:
              "must be a web address that starts with https://, such as https://models.acme.example/v1",
          });
        } else if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
          ctx.addIssue({
            code: "custom",
            path: ["baseUrl"],
            message: `must use https:// for ${url.hostname}: plain http is only for this machine or your local network`,
          });
        }
      }
    }
    const owner = file.apiKeyEnv ? PROVIDER_KEYS[file.apiKeyEnv] : undefined;
    if (owner && owner !== file.provider) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKeyEnv"],
        message: `${file.apiKeyEnv} is the key for ${owner}, and Steward never sends it anywhere else. Name a variable of your own, such as ACME_MODEL_KEY`,
      });
    }
  });

/** Reads one YAML file. Missing or empty → undefined, so the caller uses defaults. */
function readYaml(dir: string, file: string): ConfigSource | undefined {
  const path = join(dir, file);
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new TenantError(`${file}: could not be read (${(error as Error).message})`, file);
  }
  const doc = parseDocument(text);
  const broken = doc.errors[0];
  if (broken) throw new TenantError(`${file}: is not valid YAML: ${broken.message.split("\n")[0]}`, file);
  const value: unknown = doc.toJS();
  return value === null || value === undefined ? undefined : { text, doc, value };
}

/** A file that holds one list, and what it looks like, for a file written without the list's name. */
interface ListFile {
  key: string;
  example: string;
}

function validate<S extends z.ZodType>(
  schema: S,
  source: ConfigSource | undefined,
  file: string,
  list?: ListFile,
): z.output<S> {
  const value = source?.value ?? {};
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const root = value as Record<string, unknown>;
  if (list && typeof value === "object" && !Array.isArray(value) && !(list.key in root)) {
    throw new TenantError(
      `${file}: the file must start with "${list.key}:" and list each one under it, starting with "- ", like this:\n\n${list.example}\n`,
      file,
    );
  }
  throw new TenantError(describeConfigIssues(file, result.error.issues, source), file);
}

/** ". The packages there are: steward, tempo", or nothing when the parent folder has none. */
function packagesBeside(root: string): string {
  try {
    const parent = dirname(root);
    const names = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
    return names.length > 0 ? `. The packages there are: ${names.join(", ")}` : "";
  } catch {
    return "";
  }
}

/**
 * Reads `tenants/<id>/` and returns the validated package. The folder name is the tenant id.
 * Throws `TenantError` naming the file and the field when something is wrong.
 */
export function loadTenant(dir: string): TenantPackage {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new TenantError(`Tenant folder not found: ${root}${packagesBeside(root)}`, root);
  }
  const id = basename(root);

  const fail = (
    file: string,
    source: ConfigSource | undefined,
    path: PropertyKey[],
    message: string,
  ): never => {
    throw new TenantError(configMessage(file, path, message, source), file);
  };

  const brand = validate(brandFile, readYaml(root, "brand.yaml"), "brand.yaml");

  const skillsSource = readYaml(root, "skills.yaml");
  const skillDefs = validate(skillsFile, skillsSource, "skills.yaml", {
    key: "skills",
    example:
      "  skills:\n    - name: weekly-review\n      description: Look back at the week\n      instructions: List what got done.",
  }).skills;
  const skillNames = new Set<string>();
  skillDefs.forEach((skill, i) => {
    if (skillNames.has(skill.name)) {
      fail("skills.yaml", skillsSource, ["skills", i, "name"], `"${skill.name}" is used twice`);
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

  const agentsSource = readYaml(root, "agents.yaml");
  const agentDefs =
    agentsSource === undefined
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
      : validate(agentsFile, agentsSource, "agents.yaml", {
          key: "agents",
          example: "  agents:\n    - id: helper\n      name: Helper",
        }).agents;
  const agentIds = new Set<string>();
  agentDefs.forEach((agent, i) => {
    if (agentIds.has(agent.id))
      fail("agents.yaml", agentsSource, ["agents", i, "id"], `"${agent.id}" is used twice`);
    agentIds.add(agent.id);
    agent.skills.forEach((name, j) => {
      if (!skillNames.has(name)) {
        const known =
          skillNames.size > 0 ? `skills.yaml has: ${[...skillNames].join(", ")}` : "skills.yaml has none";
        fail("agents.yaml", agentsSource, ["agents", i, "skills", j], `no skill named "${name}" (${known})`);
      }
    });
  });

  const rulesSource = readYaml(root, "rules.yaml");
  const rules = checkTenantRules(
    validate(rulesFile, rulesSource, "rules.yaml", {
      key: "rules",
      example:
        '  rules:\n    - name: Routines never send\n      effect: deny\n      when: \'initiator.kind == "routine" && tool.kind == "send"\'',
    }).rules,
    [...agentIds],
    (path, where, message) => {
      throw new TenantError(configMessage("rules.yaml", path, message, rulesSource, { where }), "rules.yaml");
    },
  );

  const modelSource = readYaml(root, "model.yaml");
  const model =
    modelSource === undefined ? { ...DEFAULT_MODEL } : validate(modelFile, modelSource, "model.yaml");

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
