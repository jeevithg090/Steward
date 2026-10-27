import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT } from "@steward/shared";

/** The repository root, found from this file rather than the working directory. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Origins of the Vite dev server, the only cross-origin callers the API answers. */
export const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

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
    env,
    ...overrides,
  };
  return config;
}
