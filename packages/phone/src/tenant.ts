import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ConfigSource, configMessage, DEVICE_SCOPES, describeConfigIssues } from "@steward/shared";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { TenantShortcut } from "./catalogue.ts";

/**
 * `tenants/<id>/shortcuts.yaml`: a tenant's own phone shortcuts, declared the way it declares
 * skills. They run as a normal turn through the gateway, so a tenant shortcut can only ask Steward
 * for something; it adds no permission.
 */

const Shortcut = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,60}$/, "must be lower case letters, digits and -"),
    title: z.string().min(1).max(60),
    description: z.string().min(1).max(300),
    siri: z.string().min(1).max(60).optional(),
    skill: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "must be a skill's name from skills.yaml, such as scam-check")
      .optional(),
    prompt: z.string().min(1).max(2000),
    share: z.boolean().optional(),
    scopes: z.array(z.enum(DEVICE_SCOPES)).optional(),
  })
  .strict();

const File = z.object({ shortcuts: z.array(Shortcut).max(20).default([]) }).strict();

const FILE = "shortcuts.yaml";

export class TenantShortcutsError extends Error {
  override name = "TenantShortcutsError";
}

export interface LoadShortcutsOptions {
  /** The package's skills, from skills.yaml. Given, a shortcut must name one of them. */
  skills?: readonly string[];
}

/**
 * Reads the tenant's shortcuts; none when the file is absent. Throws a plain message that starts
 * with "shortcuts.yaml line N:" when it is wrong: a misspelled field, or a skill the package lacks.
 */
export function loadTenantShortcuts(tenantDir: string, opts: LoadShortcutsOptions = {}): TenantShortcut[] {
  const path = join(tenantDir, FILE);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const doc = parseDocument(text);
  const broken = doc.errors[0];
  if (broken) throw new TenantShortcutsError(`${FILE}: is not valid YAML: ${broken.message.split("\n")[0]}`);
  const value: unknown = doc.toJS() ?? {};
  const source: ConfigSource = { text, doc, value };
  const parsed = File.safeParse(value);
  if (!parsed.success)
    throw new TenantShortcutsError(describeConfigIssues(FILE, parsed.error.issues, source));
  const ids = new Set<string>();
  const skills = opts.skills ? new Set(opts.skills) : undefined;
  for (const [i, s] of parsed.data.shortcuts.entries()) {
    if (ids.has(s.id)) {
      throw new TenantShortcutsError(
        configMessage(FILE, ["shortcuts", i, "id"], `"${s.id}" is used twice`, source),
      );
    }
    ids.add(s.id);
    if (skills && s.skill && !skills.has(s.skill)) {
      const known = skills.size > 0 ? `skills.yaml has: ${[...skills].join(", ")}` : "skills.yaml has none";
      throw new TenantShortcutsError(
        configMessage(FILE, ["shortcuts", i, "skill"], `no skill named "${s.skill}" (${known})`, source),
      );
    }
  }
  return parsed.data.shortcuts.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    prompt: s.prompt,
    ...(s.siri ? { siri: s.siri } : {}),
    ...(s.skill ? { skill: s.skill } : {}),
    ...(s.share !== undefined ? { share: s.share } : {}),
    ...(s.scopes ? { scopes: s.scopes } : {}),
  }));
}
