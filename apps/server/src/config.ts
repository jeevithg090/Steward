import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT } from "@steward/shared";

/** The repository root, found from this file rather than the working directory. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Ports of the Vite dev server (`vite`) and of `vite preview`, which both proxy `/api` here. */
export const DEV_PORTS = [5173, 4173] as const;

/**
 * Origins of the Vite dev and preview servers, the only cross-origin callers the API answers. Their
 * proxy keeps the browser's Origin, so without them every POST through it would be refused.
 */
export const DEV_ORIGINS = DEV_PORTS.flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]);

export interface ServerConfig {
  repoRoot: string;
  port: number;
  /** Loopback by default: Steward has no sign-in, so it must not listen beyond this machine unasked. */
  host: string;
  dataDir: string;
  /** `<dataDir>/steward.db`, or `:memory:` in tests. */
  dbPath: string;
  tenantId: string;
  tenantDir: string;
  /** Serve and use the demo inbox and calendar at `/demo-google`. */
  demoGoogle: boolean;
  headful: boolean;
  allowPrivateHosts: boolean;
  production: boolean;
  /** The built web app. Served at `/` when it exists. */
  webDistDir: string;
  /** Host names accepted besides loopback (`STEWARD_ALLOWED_HOSTS`, comma separated). */
  allowedHosts: string[];
  /** Origins allowed to call the API from another origin. Empty in production. */
  devOrigins: string[];
  /** Background workers: routines, the daily brief, approval expiry. Tests switch them off. */
  workers: boolean;
  /** How long a decided approval waits for a browser to resume it before the server does. */
  resumeDelayMs: number;
  /**
   * The bot directory: an https URL or a path to an `index.json` (`STEWARD_DIRECTORY_URL`). Defaults
   * to the directory bundled with the repository, so the Bots page works offline.
   */
  directoryUrl: string;
  /**
   * Tell the directory when a bot is installed: one POST per install, no identity
   * (`STEWARD_DIRECTORY_COUNTS`). Off by default, and never sent to a directory read from a file.
   */
  directoryCounts: boolean;
  /** The environment model resolution reads. Never echoed to a person. */
  env: NodeJS.ProcessEnv;
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
  if (!value?.trim()) return DEFAULT_SERVER_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`STEWARD_PORT must be a port number, not "${value}".`);
  }
  return port;
}

const TENANT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The bundled directory, relative to the repository root. */
export const DEFAULT_DIRECTORY = "directory/index.json";

/** True for a directory read over the network rather than from a file. */
export function isRemoteDirectory(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

/** An https URL as given, or a file path resolved from the repository root. */
export function resolveDirectory(value: string | undefined, repoRoot: string): string {
  const raw = value?.trim() || DEFAULT_DIRECTORY;
  if (isRemoteDirectory(raw)) {
    const url = new URL(raw);
    if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      throw new ConfigError("STEWARD_DIRECTORY_URL must be https, or http only on this machine.");
    }
    return raw;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new ConfigError(`STEWARD_DIRECTORY_URL must be an https URL or a file path, not "${raw}".`);
  }
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
}

/** True for names that only reach this machine. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    /^127(?:\.\d{1,3}){3}$/.test(h)
  );
}

/**
 * Reads the server's settings from the environment. Relative paths resolve against the repository
 * root, so `pnpm --filter @steward/server dev` and `pnpm dev` find the same data.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  const repoRoot = overrides.repoRoot ?? REPO_ROOT;
  const production = env.NODE_ENV === "production";

  const dataDirRaw = env.STEWARD_DATA_DIR?.trim() || ".steward-data";
  const dataDir = isAbsolute(dataDirRaw) ? dataDirRaw : resolve(repoRoot, dataDirRaw);

  const tenantId = env.STEWARD_TENANT?.trim() || "steward";
  if (!TENANT_ID.test(tenantId)) {
    throw new ConfigError(`STEWARD_TENANT must be a folder name under tenants/, not "${tenantId}".`);
  }

  const allowPrivateHosts = parseFlag(env.STEWARD_ALLOW_PRIVATE_HOSTS, false);
  if (allowPrivateHosts && production) {
    throw new ConfigError(
      "STEWARD_ALLOW_PRIVATE_HOSTS lets the agent reach this machine's own services. It is refused when NODE_ENV=production.",
    );
  }

  const config: ServerConfig = {
    repoRoot,
    port: parsePort(env.STEWARD_PORT),
    host: env.STEWARD_HOST?.trim() || "127.0.0.1",
    dataDir,
    dbPath: resolve(dataDir, "steward.db"),
    tenantId,
    tenantDir: resolve(repoRoot, "tenants", tenantId),
    demoGoogle: parseFlag(env.STEWARD_DEMO_GOOGLE, true),
    headful: parseFlag(env.STEWARD_HEADFUL, false),
    allowPrivateHosts,
    production,
    webDistDir: resolve(repoRoot, "apps/web/dist"),
    allowedHosts: (env.STEWARD_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    devOrigins: production ? [] : [...DEV_ORIGINS],
    workers: parseFlag(env.STEWARD_WORKERS, true),
    resumeDelayMs: 3000,
    directoryUrl: resolveDirectory(env.STEWARD_DIRECTORY_URL, repoRoot),
    directoryCounts: parseFlag(env.STEWARD_DIRECTORY_COUNTS, false),
    env,
    ...overrides,
  };
  return config;
}
