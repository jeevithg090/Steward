import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DEVICE_PORT, DEFAULT_SERVER_PORT } from "@steward/shared";

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
  /**
   * The device listener's port (`STEWARD_DEVICE_PORT`, default 8788), or null when it is off. It
   * serves only `/device/*`, and every route but pairing needs a device token. Tunnels point here.
   */
  devicePort: number | null;
  /** Where the device listener binds (`STEWARD_DEVICE_HOST`). Loopback unless set for same Wi-Fi. */
  deviceHost: string;
  /** Host names the device listener answers besides loopback (`STEWARD_DEVICE_HOSTS`), e.g. a tunnel's. */
  deviceHosts: string[];
  /** The address phones use (`STEWARD_DEVICE_URL`), until one is set in Settings → Phone. */
  deviceUrl?: string;
  /**
   * A Cloudflare Access service token for the tunnel in front of the device port
   * (`STEWARD_DEVICE_ACCESS_CLIENT_ID` and `_SECRET`). Handed to a phone in its pairing reply.
   */
  deviceAccess?: { clientId: string; clientSecret: string };
  /**
   * The relay for the phone app (`STEWARD_RELAY_URL`, wss://) and the token Steward presents to it
   * (`STEWARD_RELAY_TOKEN`). Steward dials out; nothing listens beyond this machine.
   */
  relay?: { url: string; token: string };
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

function parsePort(value: string | undefined, name = "STEWARD_PORT", fallback = DEFAULT_SERVER_PORT): number {
  if (!value?.trim()) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`${name} must be a port number, not "${value}".`);
  }
  return port;
}

/** `off` switches the device listener off; anything else is a port. */
function parseDevicePort(value: string | undefined, mainPort: number): number | null {
  if (value !== undefined && FALSE.has(value.trim().toLowerCase())) return null;
  const port = parsePort(value, "STEWARD_DEVICE_PORT", DEFAULT_DEVICE_PORT);
  if (port !== 0 && port === mainPort) {
    throw new ConfigError(
      "STEWARD_DEVICE_PORT must differ from STEWARD_PORT: phones get a port of their own, so the main one never faces a tunnel.",
    );
  }
  return port;
}

const hostList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

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

  const port = parsePort(env.STEWARD_PORT);
  const relayUrl = env.STEWARD_RELAY_URL?.trim();
  const relayToken = env.STEWARD_RELAY_TOKEN?.trim();
  if (relayUrl) {
    let parsed: URL;
    try {
      parsed = new URL(relayUrl);
    } catch {
      throw new ConfigError(`STEWARD_RELAY_URL must be a wss:// address, not "${relayUrl}".`);
    }
    if (parsed.protocol !== "wss:" && !(parsed.protocol === "ws:" && isLoopbackHost(parsed.hostname))) {
      throw new ConfigError("STEWARD_RELAY_URL must be wss://, or ws:// only on this machine.");
    }
    if (!relayToken || relayToken.length < 24) {
      throw new ConfigError("STEWARD_RELAY_TOKEN must be set (24+ characters) with STEWARD_RELAY_URL.");
    }
  }
  const config: ServerConfig = {
    repoRoot,
    port,
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
    allowedHosts: hostList(env.STEWARD_ALLOWED_HOSTS),
    devicePort: parseDevicePort(env.STEWARD_DEVICE_PORT, port),
    deviceHost: env.STEWARD_DEVICE_HOST?.trim() || "127.0.0.1",
    deviceHosts: hostList(env.STEWARD_DEVICE_HOSTS),
    ...(env.STEWARD_DEVICE_URL?.trim() ? { deviceUrl: env.STEWARD_DEVICE_URL.trim() } : {}),
    ...(relayUrl && relayToken ? { relay: { url: relayUrl, token: relayToken } } : {}),
    ...(env.STEWARD_DEVICE_ACCESS_CLIENT_ID?.trim() && env.STEWARD_DEVICE_ACCESS_CLIENT_SECRET?.trim()
      ? {
          deviceAccess: {
            clientId: env.STEWARD_DEVICE_ACCESS_CLIENT_ID.trim(),
            clientSecret: env.STEWARD_DEVICE_ACCESS_CLIENT_SECRET.trim(),
          },
        }
      : {}),
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

/**
 * What the server says at start when it is set up to be reached from beyond this machine. The main
 * port has no sign-in, so a tunnel or a listed host name there lets anyone who reaches it act as you.
 */
export function startupWarnings(config: ServerConfig): string[] {
  const warnings: string[] = [];
  if (!isLoopbackHost(config.host)) {
    warnings.push(
      `Steward is listening on ${config.host}, beyond this machine. It has no sign-in: anyone who can reach this address and is allowed by STEWARD_ALLOWED_HOSTS can use it.`,
    );
  }
  if (config.allowedHosts.length > 0) {
    warnings.push(
      `STEWARD_ALLOWED_HOSTS lets ${config.allowedHosts.join(", ")} reach Steward's main port (${config.port}), which has no sign-in. Never point a tunnel at it. For a phone, point the tunnel at the device port (${config.devicePort ?? DEFAULT_DEVICE_PORT}) instead: see docs/security.md.`,
    );
  }
  if (config.devicePort !== null && !isLoopbackHost(config.deviceHost)) {
    warnings.push(
      `The phone port is listening on ${config.deviceHost}. Every call needs a device token, but on plain http anyone on this network can read them: use it only on a home network you trust.`,
    );
  }
  return warnings;
}
