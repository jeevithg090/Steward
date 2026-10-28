import {
  type AgentProfile,
  type BotCategory,
  type BotPack,
  BotPackSchema,
  type SkillPack,
  type TenantPackage,
  TOOL_PLAIN_WORDS,
  TOOLS,
} from "@steward/shared";
import { hashPack } from "./canonical.ts";

/**
 * Between tenant packs and bot packs. A tenant is how Steward is re-branded; a bot is what one
 * person adds. The first two listings in the directory are Steward's own agent and Tempo's, made
 * from their tenant folders by `packFromTenant`; `profileFromPack` is the other direction, used
 * when an installed bot becomes an agent.
 */

/** Display-only tools and the secret box are not part of a job, so `*` does not expand to them. */
function isJobTool(name: string): boolean {
  return !name.startsWith("show_") && name !== "request_secret";
}

/** The built-in tools a profile's `*` stands for, in a pack. */
export function expandStar(tools: readonly string[]): string[] {
  const out: string[] = [];
  for (const tool of tools) {
    if (tool === "*") out.push(...Object.keys(TOOLS).filter(isJobTool));
    else out.push(tool);
  }
  return [...new Set(out)];
}

function readmeFor(name: string, pitch: string, skills: readonly SkillPack[], tenant: TenantPackage): string {
  const lines = [`# ${name}`, "", pitch, ""];
  if (skills.length > 0) {
    lines.push("## What it can do", "");
    for (const skill of skills) lines.push(`- **${skill.name}**: ${skill.description}`);
    lines.push("");
  }
  lines.push(`Made from the ${tenant.brand.name} tenant pack. ${tenant.brand.voice}`);
  return lines.join("\n");
}

/**
 * A bot pack from a tenant's agent (the first one unless `agentId` says otherwise): its
 * instructions, its skills as `SKILL.md` skills, the tenant's ask and deny rules (an allow rule
 * has no place in a pack), the starters, and the tools it holds with `*` spelled out.
 */
export function packFromTenant(tenant: TenantPackage, agentId?: string): BotPack {
  const profile = agentId ? tenant.agents.find((a) => a.id === agentId) : tenant.agents[0];
  if (!profile)
    throw new Error(`The ${tenant.id} tenant has no agent${agentId ? ` called "${agentId}"` : ""}`);
  const byName = new Map(tenant.skills.map((s) => [s.name, s]));
  const skills: SkillPack[] = [];
  for (const name of profile.skills) {
    const skill = byName.get(name);
    if (!skill) continue;
    skills.push({
      name: skill.name,
      description: skill.description,
      body: skill.instructions,
      ...(skill.tools.length > 0 ? { allowedTools: [...skill.tools] } : {}),
    });
  }
  const name = profile.name || tenant.brand.name;
  const pitch = tenant.brand.tagline || profile.title || `${name}, from ${tenant.brand.name}.`;
  const category: BotCategory = tenant.id === "tempo" ? "money" : "productivity";
  const pack = BotPackSchema.parse({
    id: profile.id,
    name,
    pitch,
    category,
    version: 1,
    author: { kind: "person", handle: tenant.brand.name },
    licence: "MIT",
    needs: { tools: expandStar(profile.tools), connectors: [], model: "any" },
    instructions: profile.instructions.trim() || tenant.brand.voice,
    starters: tenant.starters.slice(0, 8),
    examples: [],
    skills,
    rules: tenant.rules
      .filter((r) => r.effect === "ask" || r.effect === "deny")
      .map((r) => ({ name: r.name, effect: r.effect, when: r.when, description: r.description })),
    routines: [],
    shortcuts: [],
    readme: readmeFor(name, pitch, skills, tenant),
  });
  return { ...pack, hash: hashPack(pack) };
}

/** The agent an installed pack becomes. Its tools are the pack's; its skills are the pack's names. */
export function profileFromPack(pack: BotPack): AgentProfile {
  return {
    id: pack.id,
    name: pack.name,
    title: pack.pitch,
    instructions: pack.instructions,
    skills: pack.skills.map((s) => s.name),
    tools: [...pack.needs.tools],
    source: `bot:${pack.id}`,
  };
}

/**
 * "What it may do without asking", in plain words, from a list of tools: one line per distinct
 * meaning, with the tools that always ask (sending, running commands) left out. Tools with no
 * plain words, such as MCP tools, are left out too.
 */
export function describeMayDo(tools: readonly string[]): string[] {
  const out: string[] = [];
  for (const tool of tools) {
    const words = TOOL_PLAIN_WORDS[tool];
    if (!words || words.includes("(asks first)") || out.includes(words)) continue;
    out.push(words);
  }
  return out;
}
