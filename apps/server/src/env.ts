import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Environment fixes that must happen before the CopilotKit runtime is imported.
 *
 * - Blank `*_BASE_URL` values are deleted: the runtime passes `OPENAI_BASE_URL` straight to the
 *   provider, and an empty string is not "unset", so every request would go to a broken URL.
 * - Telemetry is switched off: Steward sends nothing anywhere except to the model provider chosen.
 */
export function normaliseEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.endsWith("_BASE_URL") && !env[key]?.trim()) delete env[key];
  }
  env.COPILOTKIT_TELEMETRY_DISABLED = "true";
  env.DO_NOT_TRACK = "1";
}

/**
 * Loads `<repo>/.env`, then `STEWARD_ENV_FILE` when set (relative to the repo root). Values already
 * in the environment always win, so a shell export or `--env-file` beats the file.
 * Returns the files it read, for the startup log.
 */
export function loadEnvFiles(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const files: string[] = [];
  const extra = env.STEWARD_ENV_FILE?.trim();
  if (extra) files.push(isAbsolute(extra) ? extra : resolve(repoRoot, extra));
  files.push(resolve(repoRoot, ".env"));
  const loaded: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    process.loadEnvFile(file);
    loaded.push(file);
  }
  return loaded;
}
