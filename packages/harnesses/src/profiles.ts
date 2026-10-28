import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { HarnessInfo, HarnessProfile } from "@steward/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Harness profiles: the external coding agents a tenant offers, read from
 * `tenants/<id>/harnesses.yaml`. Each one is the vendor's own, unmodified tool, started by Steward
 * in the agent's workspace. A profile is offered only when its program is installed.
 */

export class HarnessProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessProfileError";
  }
}

const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Arguments that switch a vendor tool's own permission checks off. Steward never passes them. */
const BYPASS_FLAGS = [
  /^--dangerously-skip-permissions\b/,
  /^--dangerously-bypass-approvals-and-sandbox\b/,
  /bypass[-_]?permissions/i,
  /danger[-_]full[-_]access/i,
  /^--yolo\b/,
  /^--full-auto\b/,
  /^--auto-approve\b/,
  // Codex config overrides (`-c approval_policy="never"`): Steward sets both itself, per thread.
  /approval[_-]?policy\s*=\s*"?(never|on-failure|on-request)/i,
  /sandbox[_-]?mode\s*=/i,
];

const profileEntry = z
  .object({
    id: z.string().regex(ID, "must be lower case letters, digits and hyphens"),
    name: z.string().min(1).max(60),
    title: z.string().max(160).default(""),
    kind: z.enum(["acp", "codex"]),
    command: z.string().min(1).max(500),
    args: z.array(z.string().max(500)).max(40).default([]),
    env: z
      .record(z.string().regex(ENV_NAME, "must be an environment variable name"), z.string().max(2000))
      .optional(),
    passEnv: z.array(z.string().regex(ENV_NAME, "must be an environment variable name")).max(20).optional(),
    signIn: z.enum(["vendor-tool", "api-key"]),
    models: z.array(z.string().min(1).max(120)).max(40).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    for (const [i, arg] of [entry.command, ...entry.args].entries()) {
      if (BYPASS_FLAGS.some((flag) => flag.test(arg))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: i === 0 ? ["command"] : ["args", i - 1],
          message: `"${arg}" turns the tool's own permission checks off. Steward never runs a harness that way`,
        });
      }
    }
    if (entry.env && Object.values(entry.env).some((v) => /\b(sk|xai|gsk|nvapi|AIza)[-_][\w-]{8,}/.test(v))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["env"],
        message: "looks like a key. Name the variable in passEnv instead and keep the key in .env",
      });
    }
  });

const harnessesFile = z.object({ harnesses: z.array(profileEntry).default([]) }).strict();

function describe(issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 6)
    .map((issue) => {
      const where = issue.path.reduce<string>(
        (out, part) => (typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${part}` : String(part)),
        "",
      );
      const message =
        issue.code === "unrecognized_keys"
          ? `unknown field ${issue.keys.map((k) => `"${k}"`).join(", ")}`
          : issue.message;
      return where ? `${where}: ${message}` : message;
    })
    .join("; ");
}

/** Validates the parsed contents of a `harnesses.yaml`. Throws naming the field that is wrong. */
export function parseHarnesses(value: unknown): HarnessProfile[] {
  const result = harnessesFile.safeParse(value ?? {});
  if (!result.success) throw new HarnessProfileError(`harnesses.yaml: ${describe(result.error.issues)}`);
  const seen = new Set<string>();
  for (const [i, profile] of result.data.harnesses.entries()) {
    if (seen.has(profile.id)) {
      throw new HarnessProfileError(`harnesses.yaml: harnesses[${i}].id: "${profile.id}" is used twice`);
    }
    seen.add(profile.id);
  }
  return result.data.harnesses.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    kind: p.kind,
    command: p.command,
    args: p.args,
    signIn: p.signIn,
    ...(p.env ? { env: p.env } : {}),
    ...(p.passEnv ? { passEnv: p.passEnv } : {}),
    ...(p.models ? { models: p.models } : {}),
  }));
}

/** Reads `<tenantDir>/harnesses.yaml`. A missing or empty file means no harnesses. */
export function loadHarnesses(tenantDir: string): HarnessProfile[] {
  const path = join(tenantDir, "harnesses.yaml");
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = (error as Error).message.split("\n")[0];
    throw new HarnessProfileError(`harnesses.yaml: is not valid YAML: ${reason}`);
  }
  return parseHarnesses(raw ?? {});
}

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where a program would be found: its absolute path, or the first match on PATH. */
export function findProgram(command: string, env: NodeJS.ProcessEnv): string | undefined {
  if (isAbsolute(command)) return executable(command) ? command : undefined;
  if (command.includes("/")) return undefined;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (executable(candidate)) return candidate;
  }
  return undefined;
}

/** A profile with whether its program is installed, for `GET /api/harnesses` and the picker. */
export function harnessInfo(profile: HarnessProfile, env: NodeJS.ProcessEnv): HarnessInfo {
  const path = findProgram(profile.command, env);
  if (path) return { ...profile, available: true, path };
  return { ...profile, available: false, reason: notInstalled(profile) };
}

export function notInstalled(profile: Pick<HarnessProfile, "name" | "command">): string {
  return `${profile.name} is not installed on this computer (Steward looked for "${profile.command}"). Install it, sign in to it, then restart Steward.`;
}

/** The server's variables a harness may always see: what a program needs to run, nothing secret. */
const PASSED = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TZ",
]);
/** Never passed, whatever a profile asks: each one changes what the loader or a shell runs. */
const NEVER_PASSED = new Set([
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
]);

/**
 * The environment a harness runs with: what a program needs (PATH, and the real HOME so the vendor
 * tool finds its own sign-in), the variables the profile names in `passEnv`, and its own `env`.
 * Steward's model keys never reach a harness unless a profile names one.
 */
export function harnessEnvironment(profile: HarnessProfile, base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  const passed = new Set([...PASSED, ...(profile.passEnv ?? [])]);
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || NEVER_PASSED.has(name)) continue;
    if (passed.has(name) || name.startsWith("LC_")) env[name] = value;
  }
  for (const [name, value] of Object.entries(profile.env ?? {})) {
    if (!NEVER_PASSED.has(name)) env[name] = value;
  }
  env.PATH ??= "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return env;
}

/** Profiles that would start the same process share their sessions across rebuilds. */
export function profileKey(profile: HarnessProfile): string {
  return JSON.stringify([
    profile.kind,
    profile.command,
    profile.args,
    profile.env ?? {},
    profile.passEnv ?? [],
  ]);
}
