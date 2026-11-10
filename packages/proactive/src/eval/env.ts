import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseEnv } from "node:util";

/**
 * Loads `STEWARD_ENV_FILE` when set (relative to the repo root), then `<repo>/.env`, into `env`, the
 * way the server does, so a key in `.env` reaches the eval too. A value already set wins over the
 * files, and the first file wins over the second. A blank value counts as unset wherever it is, so
 * `KEY=` (as `.env.example` has) never hides a key set elsewhere.
 *
 * A copy of `loadEnvFiles` in `apps/server/src/env.ts`: this package must not import the server.
 * Returns the files it read.
 */
export function loadEvalEnv(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const files: string[] = [];
  const extra = env.STEWARD_ENV_FILE?.trim();
  if (extra) files.push(isAbsolute(extra) ? extra : resolve(repoRoot, extra));
  files.push(resolve(repoRoot, ".env"));
  const loaded: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (value !== undefined && !env[key]?.trim()) env[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}
