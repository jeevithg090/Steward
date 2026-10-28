import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, found from this file rather than the working directory. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** 8787 is Steward itself and 5173 its web app; the directory sits beside them. */
export const DEFAULT_PORT = 8790;

/** Where "Add to Steward" opens by default: the person's own Steward web app. */
export const DEFAULT_APP_URL = "http://localhost:5173";

export interface DirectoryConfig {
  repoRoot: string;
  port: number;
  /** Loopback by default. Docker and hosts set `DIRECTORY_HOST=0.0.0.0`. */
  host: string;
  /** The folder with `bots/`, `categories.yaml` and the built `index.json` and `packs/`. */
  directoryDir: string;
  dataDir: string;
  /** `<dataDir>/directory.db`, or `:memory:` in tests. */
  dbPath: string;
  /**
   * The public address of this server, with no trailing slash. Every `pageUrl`, the feed, the
   * counts endpoint Steward posts to and the GitHub sign-in callback are built from it.
   */
  siteUrl: string;
  /** Where "Add to Steward" opens, with no trailing slash. */
  appUrl: string;
  /** The directory's name, shown on the site and in `index.json`. */
  name: string;
  /** GitHub sign-in, for submissions and "I use this". Off when unset. */
  github?: { clientId: string; clientSecret: string; token?: string };
  /** GitHub logins (lower case) who may review submissions at `/admin`. */
  adminLogins: string[];
  /** Read the client address from `X-Forwarded-For`, when a proxy in front sets it. */
  trustProxy: boolean;
  production: boolean;
  /** Where this directory's code is, for the footer's Source link. Left out when unset. */
  sourceUrl?: string;
  /** A folder copied into `directoryDir` on first start, when that has no `index.json` yet. */
  seedDir?: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

export function parseFlag(value: string | undefined, fallback: boolean): boolean {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return fallback;
}

function parsePort(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`DIRECTORY_PORT must be a port number, not "${value}".`);
  }
  return port;
}

export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("127.");
}

function parseSiteUrl(
  value: string | undefined,
  name: string,
  fallback: string,
  production: boolean,
): string {
  const raw = value?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} must be a web address, not "${raw}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`${name} must start with http:// or https://.`);
  }
  if (production && url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new ConfigError(`${name} must be https when NODE_ENV=production (sign-in cookies need it).`);
  }
  if (url.search || url.hash) throw new ConfigError(`${name} must not have a query or a fragment.`);
  return url.toString().replace(/\/+$/, "");
}

function resolveFrom(root: string, value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  return isAbsolute(raw) ? raw : resolve(root, raw);
}

export function loadConfig(
  env: NodeJS.ProcessEnv,
  overrides: Partial<DirectoryConfig> = {},
): DirectoryConfig {
  const repoRoot = overrides.repoRoot ?? REPO_ROOT;
  const production = overrides.production ?? env.NODE_ENV === "production";
  const port = overrides.port ?? parsePort(env.DIRECTORY_PORT);
  const host = overrides.host ?? (env.DIRECTORY_HOST?.trim() || "127.0.0.1");
  const dataDir =
    overrides.dataDir ?? resolveFrom(repoRoot, env.DIRECTORY_DATA_DIR, ".steward-data/directory");

  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
    throw new ConfigError("Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither.");
  }
  const github =
    "github" in overrides
      ? overrides.github
      : clientId && clientSecret
        ? {
            clientId,
            clientSecret,
            ...(env.DIRECTORY_GITHUB_TOKEN?.trim() ? { token: env.DIRECTORY_GITHUB_TOKEN.trim() } : {}),
          }
        : undefined;

  const adminLogins =
    overrides.adminLogins ??
    (env.ADMIN_GITHUB_LOGINS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);

  const siteUrl =
    overrides.siteUrl ??
    parseSiteUrl(env.DIRECTORY_SITE_URL, "DIRECTORY_SITE_URL", `http://127.0.0.1:${port}`, production);
  const appUrl =
    overrides.appUrl ?? parseSiteUrl(env.DIRECTORY_APP_URL, "DIRECTORY_APP_URL", DEFAULT_APP_URL, false);

  const sourceUrl =
    "sourceUrl" in overrides
      ? overrides.sourceUrl
      : env.DIRECTORY_SOURCE_URL?.trim()
        ? parseSiteUrl(env.DIRECTORY_SOURCE_URL, "DIRECTORY_SOURCE_URL", "", false)
        : undefined;
  const seedDir =
    "seedDir" in overrides
      ? overrides.seedDir
      : env.DIRECTORY_SEED_DIR?.trim()
        ? resolveFrom(repoRoot, env.DIRECTORY_SEED_DIR, "")
        : undefined;

  return {
    repoRoot,
    port,
    host,
    directoryDir: overrides.directoryDir ?? resolveFrom(repoRoot, env.DIRECTORY_DIR, "directory"),
    dataDir,
    dbPath: overrides.dbPath ?? resolve(dataDir, "directory.db"),
    siteUrl,
    appUrl,
    name: overrides.name ?? (env.DIRECTORY_NAME?.trim() || "Steward bots"),
    ...(github ? { github } : {}),
    adminLogins,
    trustProxy: overrides.trustProxy ?? parseFlag(env.DIRECTORY_TRUST_PROXY, false),
    production,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(seedDir ? { seedDir } : {}),
  };
}

/**
 * The startup lines. Secrets never appear here: GitHub sign-in is "on" or "off", never the client
 * secret or the token, and reviewers are a count, not a list.
 */
export function describeConfig(config: DirectoryConfig): string[] {
  return [
    `site      ${config.siteUrl}`,
    `bots      ${config.directoryDir}`,
    `data      ${config.dataDir}`,
    `sign-in   ${config.github ? "GitHub (on)" : "off: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to take submissions"}`,
    `review    ${config.adminLogins.length} reviewer${config.adminLogins.length === 1 ? "" : "s"} (ADMIN_GITHUB_LOGINS)`,
    `mcp       ${config.siteUrl}/mcp`,
  ];
}

/** What `GET /api/info` says about this server. No secrets, no reviewer names. */
export function publicInfo(config: DirectoryConfig): {
  name: string;
  site: string;
  index: string;
  mcp: string;
  feed: string;
  signIn: boolean;
  submissions: boolean;
} {
  return {
    name: config.name,
    site: config.siteUrl,
    index: `${config.siteUrl}/index.json`,
    mcp: `${config.siteUrl}/mcp`,
    feed: `${config.siteUrl}/feed.xml`,
    signIn: Boolean(config.github),
    submissions: Boolean(config.github) && config.adminLogins.length > 0,
  };
}
