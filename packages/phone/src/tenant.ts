import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEVICE_SCOPES } from "@steward/shared";
import { parse } from "yaml";
import { z } from "zod";
import type { TenantShortcut } from "./catalogue.ts";

/**
 * `tenants/<id>/shortcuts.yaml`: a tenant's own phone shortcuts, declared the way it declares
 * skills. They run as a normal turn through the gateway, so a tenant shortcut can only ask Steward
 * for something; it adds no permission.
 */

const Shortcut = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,60}$/, "an id is lower case letters, digits and -"),
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
  siri: z.string().min(1).max(60).optional(),
  skill: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,40}$/)
    .optional(),
  prompt: z.string().min(1).max(2000),
  share: z.boolean().optional(),
  scopes: z.array(z.enum(DEVICE_SCOPES)).optional(),
});

const File = z.object({ shortcuts: z.array(Shortcut).max(20).default([]) });

export class TenantShortcutsError extends Error {
  override name = "TenantShortcutsError";
}

/** Reads the tenant's shortcuts; none when the file is absent. Throws with the file named when it is wrong. */
export function loadTenantShortcuts(tenantDir: string): TenantShortcut[] {
  const path = join(tenantDir, "shortcuts.yaml");
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8")) ?? {};
  } catch (err) {
    throw new TenantShortcutsError(`${path} is not valid YAML: ${(err as Error).message}`);
  }
  const parsed = File.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new TenantShortcutsError(
      `${path}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "is not valid"}`.trim(),
    );
  }
  const ids = new Set<string>();
  for (const s of parsed.data.shortcuts) {
    if (ids.has(s.id)) throw new TenantShortcutsError(`${path}: the id "${s.id}" is used twice.`);
    ids.add(s.id);
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
