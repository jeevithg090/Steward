import type { Db } from "@steward/db";

/**
 * What a tool server needs to sign in: environment variables for a program on this computer, or an
 * access token for one at a web address. Write-only: saved here, handed to the server, and never
 * sent back to the page, written to the record or put in front of the model.
 */
export interface Secrets {
  env: Record<string, string>;
  bearer?: string;
}

/** An environment variable name a person can set for a server. */
export const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
/** Names Steward sets itself: the program is found through PATH and runs in HOME. */
export const RESERVED_ENV = new Set(["PATH", "HOME"]);
export const MAX_SECRET_CHARS = 8_192;
/** What a hidden value reads as. */
export const HIDDEN = "***";
/** Query parameter names that usually carry a key. */
const SECRET_PARAM = /key|token|secret|sig|pass|auth|credential|session/i;
/** Shorter values are left alone: hiding "a" would hide every "a". */
const MIN_HIDDEN_CHARS = 4;

interface SecretRow {
  kind: "env" | "bearer";
  name: string;
  value: string;
}

export function loadSecrets(db: Db, serverId: string): Secrets {
  const secrets: Secrets = { env: {} };
  for (const row of db.all<SecretRow>(
    "SELECT kind, name, value FROM connectors_mcp_secrets WHERE server_id = ? ORDER BY name",
    [serverId],
  )) {
    if (row.kind === "bearer") secrets.bearer = row.value;
    else secrets.env[row.name] = row.value;
  }
  return secrets;
}

/** Replaces every saved secret for the server. Runs inside the caller's transaction. */
export function saveSecrets(db: Db, serverId: string, secrets: Secrets): void {
  db.run("DELETE FROM connectors_mcp_secrets WHERE server_id = ?", [serverId]);
  for (const [name, value] of Object.entries(secrets.env)) {
    db.run("INSERT INTO connectors_mcp_secrets (server_id, kind, name, value) VALUES (?, 'env', ?, ?)", [
      serverId,
      name,
      value,
    ]);
  }
  if (secrets.bearer !== undefined) {
    db.run("INSERT INTO connectors_mcp_secrets (server_id, kind, name, value) VALUES (?, 'bearer', '', ?)", [
      serverId,
      secrets.bearer,
    ]);
  }
}

export function sameSecrets(a: Secrets, b: Secrets): boolean {
  const names = Object.keys(a.env);
  return (
    a.bearer === b.bearer &&
    names.length === Object.keys(b.env).length &&
    names.every((name) => a.env[name] === b.env[name])
  );
}

/** Every value worth hiding: the saved secrets, and any key-looking value in the server's address. */
export function secretValues(secrets: Secrets, url?: string): string[] {
  const values = [...Object.values(secrets.env), ...(secrets.bearer ? [secrets.bearer] : [])];
  if (url) {
    try {
      for (const [name, value] of new URL(url).searchParams) if (SECRET_PARAM.test(name)) values.push(value);
    } catch {
      // Not a URL: nothing to add.
    }
  }
  const all = new Set<string>();
  for (const value of values) {
    if (value.length < MIN_HIDDEN_CHARS) continue;
    all.add(value);
    all.add(encodeURIComponent(value));
  }
  // Longest first, so a value that contains another is hidden whole.
  return [...all].sort((a, b) => b.length - a.length);
}

/** `text` with every one of `values` replaced by `***`. */
export function hideValues(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of values) out = out.split(value).join(HIDDEN);
  return out;
}

/**
 * The address as the page shows it: the value of any query parameter whose name looks like it
 * carries a key (`api_key`, `token`, `sig`…) becomes `***`.
 */
export function maskedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (![...parsed.searchParams.keys()].some((name) => SECRET_PARAM.test(name))) return url;
  const query = parsed.search
    .slice(1)
    .split("&")
    .map((pair) => {
      const [name = "", ...rest] = pair.split("=");
      let decoded = name;
      try {
        decoded = decodeURIComponent(name.replace(/\+/g, " "));
      } catch {
        // Keep the raw name.
      }
      return rest.length > 0 && SECRET_PARAM.test(decoded) ? `${name}=${HIDDEN}` : pair;
    })
    .join("&");
  return `${parsed.origin}${parsed.pathname}?${query}${parsed.hash}`;
}
