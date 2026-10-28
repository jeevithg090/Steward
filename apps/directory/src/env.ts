import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Reads `DIRECTORY_ENV_FILE` (when set) and then `.env` at the repository root into `env`. A value
 * already in the environment wins, and a blank value (`KEY=`) counts as unset wherever it is, so a
 * blank line in `.env` never hides a real value from the shell. Returns the files that were read.
 */
export function loadEnvFiles(repoRoot: string, env: NodeJS.ProcessEnv): string[] {
  const files: string[] = [];
  const named = env.DIRECTORY_ENV_FILE?.trim();
  if (named) files.push(isAbsolute(named) ? named : resolve(repoRoot, named));
  files.push(resolve(repoRoot, ".env"));
  const read: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, value] of parseEnv(readFileSync(file, "utf8"))) {
      if (env[key]?.trim()) continue;
      if (value.trim() === "") continue;
      env[key] = value;
    }
    read.push(file);
  }
  return read;
}

/** `KEY=value` lines; `#` comments; single or double quotes around a value are removed. */
export function parseEnv(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = value.match(/^(["'])(.*)\1$/);
    if (quoted) value = quoted[2] ?? "";
    else {
      const hash = value.indexOf(" #");
      if (hash > -1) value = value.slice(0, hash).trim();
    }
    out.push([key, value]);
  }
  return out;
}
