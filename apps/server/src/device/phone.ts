import { accessSync, constants } from "node:fs";
import { hostname } from "node:os";
import { delimiter, join } from "node:path";
import { DEFAULT_DEVICE_PORT, type PhoneInfo } from "@steward/shared";
import { isLoopbackHost, type ServerConfig } from "../config.ts";
import { HttpError } from "../http/errors.ts";
import type { SettingsStore } from "../store/settings.ts";

/**
 * The address a phone uses to reach the device listener (Settings → Phone → Connection), and the
 * host names the listener answers. Tunnels such as Tailscale Serve or a Cloudflare tunnel give the
 * phone an https name for 127.0.0.1:8788; at home, `http://<mac>.local:8788` works with a warning.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Names that only reach a home or tailnet network: `.local`, RFC 1918, Tailscale's 100.64/10, ULA. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(h) || h.endsWith(".local") || h.endsWith(".home.arpa")) return true;
  const v4 = IPV4.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return /^f[cd][0-9a-f]{2}:/.test(h);
}

const PLAIN_HTTP_WARNING =
  "Plain http: your phone's token travels unencrypted, so use this only on a home network you trust.";

/** Checks an address the person typed. Returns its origin, and a warning for plain http at home. */
export function checkPhoneUrl(raw: string, mainPort: number): { url: string; warning?: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(
      400,
      "That isn't a web address. It should look like https://your-mac.your-tailnet.ts.net.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "The phone address must start with https://.");
  }
  if (url.username || url.password)
    throw new HttpError(400, "Leave the name and password out of the address.");
  if (url.port === String(mainPort) && isPrivateHost(url.hostname)) {
    throw new HttpError(
      400,
      `${mainPort} is Steward's main port, which has no sign-in. Phones use the device port (${DEFAULT_DEVICE_PORT} unless you changed it).`,
    );
  }
  if (url.protocol === "http:") {
    if (!isPrivateHost(url.hostname)) {
      throw new HttpError(
        400,
        "Use an https address (Tailscale Serve or a Cloudflare tunnel give you one). Plain http is only accepted for a home address such as your-mac.local.",
      );
    }
    return { url: url.origin, warning: PLAIN_HTTP_WARNING };
  }
  return { url: url.origin };
}

/** This machine's name as a phone shows it: "Sam's MacBook" rather than "sams-macbook.local". */
export function machineName(): string {
  const name = hostname()
    .replace(/\.local$/i, "")
    .trim();
  return name.slice(0, 60) || "this computer";
}

function onPath(command: string, env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      // Not in this folder.
    }
  }
  return false;
}

/**
 * Tunnel tools found on PATH, with the exact command for the device port. Steward never starts a
 * tunnel itself: the person runs the command, and sees what it exposes.
 */
export function detectTransports(
  devicePort: number,
  env: NodeJS.ProcessEnv = process.env,
): PhoneInfo["transports"] {
  return [
    { id: "tailscale", found: onPath("tailscale", env), command: `tailscale serve --bg ${devicePort}` },
    {
      id: "cloudflared",
      found: onPath("cloudflared", env),
      command: `cloudflared tunnel --url http://127.0.0.1:${devicePort}`,
    },
  ];
}

const URL_KEY = "phoneUrl";

export class PhoneSettings {
  constructor(
    private readonly settings: SettingsStore,
    private readonly config: Pick<ServerConfig, "port" | "deviceHosts" | "deviceUrl">,
  ) {}

  /** The phone address: the one set in Settings → Phone, else `STEWARD_DEVICE_URL`, else none. */
  url(): string | null {
    const stored = this.settings.get<string>(URL_KEY, "");
    const raw = stored || this.config.deviceUrl || "";
    if (!raw) return null;
    try {
      return checkPhoneUrl(raw, this.config.port).url;
    } catch {
      return null;
    }
  }

  warning(): string | undefined {
    const url = this.url();
    return url?.startsWith("http:") ? PLAIN_HTTP_WARNING : undefined;
  }

  /** Sets or clears the address. Throws a person-facing 400 for one that would not be safe. */
  setUrl(raw: string): void {
    if (!raw.trim()) {
      this.settings.delete(URL_KEY);
      return;
    }
    this.settings.set(URL_KEY, checkPhoneUrl(raw, this.config.port).url);
  }

  /** Host names the device listener answers besides loopback: the phone address's, and `STEWARD_DEVICE_HOSTS`. */
  hosts(): string[] {
    const url = this.url();
    const own = url ? [new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "")] : [];
    return [...new Set([...own, ...this.config.deviceHosts])];
  }
}
