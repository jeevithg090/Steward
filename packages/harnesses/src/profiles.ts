import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import type { HarnessInfo, HarnessProfile } from "@steward/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { looksLikeKey } from "./secrets.ts";

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

/**
 * Arguments that switch a vendor tool's own permission checks off, or tell it what it may do
 * without asking. Steward never passes them: the tool must ask, so Steward can. Each is matched
 * against every argument, and against each `--flag value` pair read as `--flag=value`, with quotes
 * taken off.
 */
const BYPASS_FLAGS = [
  /^--dangerously/i,
  /bypass[-_]?permissions/i,
  /danger[-_]full[-_]access/i,
  /^--yolo\b/i,
  // `-y`, alone or among other one-letter flags (`-dy` is debug and yolo to Gemini CLI), or `-y=true`.
  /^-[A-Za-z]{0,4}y[A-Za-z]{0,4}(=|$)/,
  /^--full[-_]?auto\b/i,
  /^--auto[-_]?approve\b/i,
  /^--auto[-_]?edit\b/i,
  // Gemini CLI: `--approval-mode yolo` or `auto_edit` approves by itself.
  /^--approval[-_]?mode=(yolo|auto)/i,
  // Codex: `-a never`, `-anever` and the like. Steward sets the approval policy itself, per thread.
  /^(-a|--ask[-_]?for[-_]?approval)=(never|on-failure|on-request)/i,
  /^-a(never|on-failure|on-request)$/i,
  // Claude Code: any permission mode, and tools allowed without asking.
  /^--permission[-_]?mode\b/i,
  /^--allowed[-_]?tools\b/i,
  // Codex config overrides (`-c approval_policy="never"`): Steward sets these itself, per thread.
  /approval[_-]?policy\s*=\s*(never|on-failure|on-request)/i,
  /sandbox[_-]?mode\s*=/i,
  /sandbox[_-]?workspace[_-]?write\./i,
];

/** Environment names that hold a key: a key is named in `passEnv`, never written in the file. */
const KEY_NAME = /(^|_)(API_?KEY|KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$/;

/**
 * The forms an argument list is checked in: each argument, each word inside one (`sh -c "gemini
 * --yolo"` hides its flags in a single argument), and each `--flag value` pair as one.
 */
export function argumentForms(args: readonly string[]): { form: string; index: number }[] {
  const unquote = (arg: string) => arg.replace(/["']/g, "").trim();
  const words: { word: string; index: number }[] = [];
  for (const [index, arg] of args.entries()) {
    const whole = unquote(arg);
    const parts = whole.split(/\s+/).filter(Boolean);
    if (parts.length > 1) words.push({ word: whole, index });
    for (const word of parts.length > 0 ? parts : [whole]) words.push({ word, index });
  }
  const forms: { form: string; index: number }[] = [];
  for (const [i, { word, index }] of words.entries()) {
    forms.push({ form: word, index });
    const next = words[i + 1]?.word;
    if (/^-{1,2}[A-Za-z]/.test(word) && !word.includes("=") && next !== undefined && !next.startsWith("-")) {
      forms.push({ form: `${word}=${next}`, index });
    }
  }
  return forms;
}
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
    /** How to install it, said when it is missing: "npm install -g …". */
    install: z.string().min(1).max(300).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const args = [entry.command, ...entry.args];
    const flagged = new Set<number>();
    for (const { form, index } of argumentForms(args)) {
      if (flagged.has(index) || !BYPASS_FLAGS.some((flag) => flag.test(form))) continue;
      flagged.add(index);
      ctx.addIssue({
        code: "custom",
        path: index === 0 ? ["command"] : ["args", index - 1],
        message: `"${args[index]}" turns the tool's own permission checks off. Steward never runs a harness that way`,
      });
    }
    for (const [name, value] of Object.entries(entry.env ?? {})) {
      if (KEY_NAME.test(name) || looksLikeKey(value)) {
        ctx.addIssue({
          code: "custom",
          path: ["env", name],
          message: "looks like a key. Name the variable in passEnv instead and keep the key in .env",
        });
      }
    }
  });

const harnessesFile = z.object({ harnesses: z.array(profileEntry).default([]) }).strict();

function describe(issues: z.core.$ZodIssue[]): string {
  return issues
    .slice(0, 6)
    .map((issue) => {
      const where = issue.path.reduce<string>(
        (out, part) =>
          typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part),
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
    ...(p.install ? { install: p.install } : {}),
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

/**
 * Where command-line tools are often installed but a launcher's PATH may leave out (a server
 * started from an app or a service has a short PATH). Looked in after PATH.
 */
export function usualBinDirs(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME;
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(home ? [join(home, ".local", "bin"), join(home, ".npm-global", "bin")] : []),
  ];
}

/** Where a program would be found: its absolute path, else the first match on PATH, else in the usual places. */
export function findProgram(command: string, env: NodeJS.ProcessEnv): string | undefined {
  if (isAbsolute(command)) return executable(command) ? command : undefined;
  if (command.includes("/")) return undefined;
  const onPath = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of [...onPath, ...usualBinDirs(env).filter((d) => !onPath.includes(d))]) {
    const candidate = join(dir, command);
    if (executable(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The server's environment for a program found at `path`: its folder joins PATH when it is not
 * there, so a script's `#!/usr/bin/env node` finds the node installed beside it.
 */
export function withProgramDir(env: NodeJS.ProcessEnv, path: string | undefined): NodeJS.ProcessEnv {
  if (!path) return env;
  const dir = dirname(path);
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  return dirs.includes(dir) ? env : { ...env, PATH: [...dirs, dir].join(delimiter) };
}

/** A profile with whether its program is installed, for the picker. `path` is for the server only. */
export function harnessInfo(profile: HarnessProfile, env: NodeJS.ProcessEnv): HarnessInfo {
  const path = findProgram(profile.command, env);
  if (path) return { ...profile, available: true, path };
  return { ...profile, available: false, reason: notInstalled(profile) };
}

/** Said when a harness's program is missing: what to install, when the profile says, and to sign in. */
export function notInstalled(profile: Pick<HarnessProfile, "name" | "command" | "install">): string {
  if (profile.install) {
    return `${profile.name} is not installed here. To add it, run: ${profile.install}, then sign in to it.`;
  }
  return `${profile.name} is not installed here (Steward looked for "${profile.command}"). Install it, then sign in to it.`;
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
