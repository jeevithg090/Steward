import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ComputerError } from "./errors.ts";

/**
 * Where the agent's browser may go. Cloud metadata services are refused always; loopback, private,
 * link-local and other non-public ranges are refused unless the person opted in
 * (`allowPrivateHosts`, wired to `STEWARD_ALLOW_PRIVATE_HOSTS=1`). Otherwise a web page could steer
 * the agent's browser into Steward's own API on localhost or into the home network.
 *
 * Names are resolved here and every address is checked, so `evil.example → 127.0.0.1` is refused
 * like `127.0.0.1` itself. The egress proxy then connects only to the addresses checked here, so a
 * second DNS answer cannot change where the connection goes.
 */

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export type AddressClass = "metadata" | "private" | "public";

export type HostVerdict =
  | { ok: true; host: string; addresses: ResolvedAddress[] }
  | { ok: false; host: string; reason: "metadata" | "private" | "unresolved" | "invalid"; message: string };

// ── Address classification ─────────────────────────────────────────────────────────────────────

/** Instance metadata endpoints: AWS (and ECS, EKS), GCP, Azure, Alibaba, Oracle. Never reachable. */
const METADATA_V4 = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "169.254.170.23",
  "100.100.100.200",
  "192.0.0.192",
  "168.63.129.16",
]);
const METADATA_V6 = ["fd00:ec2::254", "fd00:ec2::23", "fd20:ce::254"];
const METADATA_NAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);
const LOOPBACK_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

/** Every IPv4 range that is not the public internet. */
const PRIVATE_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT, also Tailscale
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // retired 6to4 relay
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];

const PRIVATE_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard
  ["64:ff9b:1::", 48], // local-use NAT64
  ["2001::", 32], // Teredo tunnels
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // old site-local
  ["ff00::", 8], // multicast
];

export function parseIpv4(text: string): number[] | undefined {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return undefined;
  const bytes = text.split(".").map(Number);
  return bytes.every((b) => b <= 255) ? bytes : undefined;
}

/** Eight 16-bit groups, or undefined when `text` is not an IPv6 address. Accepts a dotted IPv4 tail and a zone. */
export function parseIpv6(text: string): number[] | undefined {
  let s = text.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return undefined;
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const parts = [...head, ...Array.from({ length: missing }, () => "0"), ...rest];
  if (!parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return undefined;
  return parts.map((p) => Number.parseInt(p, 16));
}

function v4ToInt(bytes: readonly number[]): number {
  return (((bytes[0] ?? 0) << 24) >>> 0) + ((bytes[1] ?? 0) << 16) + ((bytes[2] ?? 0) << 8) + (bytes[3] ?? 0);
}

function inV4Range(ip: number, base: string, prefix: number): boolean {
  const shift = 32 - prefix;
  const baseInt = v4ToInt(parseIpv4(base) ?? []);
  return shift >= 32 || ip >>> shift === baseInt >>> shift;
}

function inV6Range(groups: readonly number[], base: string, prefix: number): boolean {
  const baseGroups = parseIpv6(base);
  if (!baseGroups) return false;
  let bits = prefix;
  for (let i = 0; i < 8 && bits > 0; i++) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if (((groups[i] ?? 0) & mask) !== ((baseGroups[i] ?? 0) & mask)) return false;
    bits -= take;
  }
  return true;
}

function classifyV4(bytes: readonly number[]): AddressClass {
  if (METADATA_V4.has(bytes.join("."))) return "metadata";
  const ip = v4ToInt(bytes);
  return PRIVATE_V4.some(([base, prefix]) => inV4Range(ip, base, prefix)) ? "private" : "public";
}

/** The IPv4 address an IPv6 address carries (mapped, compatible, NAT64 or 6to4), if any. */
function embeddedV4(g: readonly number[]): number[] | undefined {
  const at = (i: number) => g[i] ?? 0;
  const fromGroups = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  const firstFiveZero = at(0) === 0 && at(1) === 0 && at(2) === 0 && at(3) === 0 && at(4) === 0;
  if (firstFiveZero && at(5) === 0xffff) return fromGroups(at(6), at(7)); // ::ffff:a.b.c.d
  if (firstFiveZero && at(5) === 0 && (at(6) !== 0 || at(7) > 1)) return fromGroups(at(6), at(7)); // ::a.b.c.d
  if (at(0) === 0x64 && at(1) === 0xff9b && at(2) === 0 && at(3) === 0 && at(4) === 0 && at(5) === 0) {
    return fromGroups(at(6), at(7)); // 64:ff9b::/96
  }
  if (at(0) === 0x2002) return fromGroups(at(1), at(2)); // 6to4
  return undefined;
}

/** Classifies an IP literal. Returns undefined when `ip` is not an IP address. */
export function classifyAddress(ip: string): AddressClass | undefined {
  const v4 = parseIpv4(ip);
  if (v4) return classifyV4(v4);
  const groups = parseIpv6(ip);
  if (!groups) return undefined;
  if (METADATA_V6.some((m) => inV6Range(groups, m, 128))) return "metadata";
  const inner = embeddedV4(groups);
  if (inner) return classifyV4(inner);
  return PRIVATE_V6.some(([base, prefix]) => inV6Range(groups, base, prefix)) ? "private" : "public";
}

/** Lower case, no brackets, no trailing dots: the form every check compares. */
export function canonicalHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function classifyName(host: string): AddressClass | undefined {
  if (METADATA_NAMES.has(host)) return "metadata";
  if (LOOPBACK_NAMES.has(host) || host.endsWith(".localhost")) return "private";
  return undefined;
}

// ── URLs ───────────────────────────────────────────────────────────────────────────────────────

const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d{1,5})?([/?#].*)?$/i;

/**
 * Parses what the agent (or the person) asked to open. Only http and https: `file:`, `chrome:`,
 * `data:` and `javascript:` are refused here, before anything reaches the browser. A bare
 * `example.com` is read as `https://example.com`, because models often drop the scheme.
 */
export function parseWebUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ComputerError("bad_url", "Give a web address, such as https://example.com.");
  }
  const text = raw.trim();
  if (text.length > 8192) throw new ComputerError("bad_url", "That web address is too long.");
  let url: URL;
  try {
    url = new URL(!text.includes("://") && BARE_HOST.test(text) ? `https://${text}` : text);
  } catch {
    throw new ComputerError(
      "bad_url",
      "That is not a web address. Include https://, for example https://example.com.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ComputerError(
      "bad_url",
      `Only web addresses that start with http:// or https:// can be opened, not ${url.protocol} addresses.`,
    );
  }
  if (url.username || url.password) {
    throw new ComputerError(
      "bad_url",
      "Web addresses with a user name or password in them are not opened. Ask for sign-in details with the secret box instead.",
    );
  }
  if (!url.hostname) throw new ComputerError("bad_url", "That web address has no host.");
  return url;
}

/** `example.com/path` for activity lines and refusals: no query string, which can carry tokens. */
export function displayUrl(url: string | URL, max = 80): string {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    if (u.protocol !== "http:" && u.protocol !== "https:") return u.protocol.replace(/:$/, "");
    const path = u.pathname === "/" ? "" : u.pathname;
    const text = `${u.host}${path}`;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  } catch {
    return "a page";
  }
}

// ── The policy ─────────────────────────────────────────────────────────────────────────────────

export interface HostPolicyOptions {
  allowPrivateHosts?: boolean;
  /**
   * Ports on this machine the browser never reaches, whatever `allowPrivateHosts` says: Steward's
   * own server, so a page in the agent's browser cannot call its API or take over the screen.
   */
  protectedPorts?: readonly number[];
  /** Injectable for tests. Defaults to the system resolver. */
  lookup?: LookupFn;
  /** How long a DNS answer is trusted. Short on purpose. */
  cacheMs?: number;
  now?: () => number;
}

const CACHE_LIMIT = 1000;
const FAILED_LOOKUP_MS = 5_000;

async function systemLookup(hostname: string): Promise<ResolvedAddress[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

export class HostPolicy {
  readonly allowPrivateHosts: boolean;
  readonly protectedPorts: ReadonlySet<number>;
  private readonly lookup: LookupFn;
  private readonly cacheMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { expires: number; addresses?: ResolvedAddress[] }>();
  private readonly inflight = new Map<string, Promise<ResolvedAddress[] | undefined>>();

  constructor(opts: HostPolicyOptions = {}) {
    this.allowPrivateHosts = opts.allowPrivateHosts ?? false;
    this.protectedPorts = new Set(opts.protectedPorts ?? []);
    this.lookup = opts.lookup ?? systemLookup;
    this.cacheMs = opts.cacheMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** Decides a URL. Only web schemes reach the host check; anything else is invalid here. */
  async checkUrl(url: URL): Promise<HostVerdict> {
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return {
        ok: false,
        host: url.hostname,
        reason: "invalid",
        message: `${url.protocol} addresses are not opened.`,
      };
    }
    return this.checkHost(url.hostname);
  }

  async checkHost(hostname: string): Promise<HostVerdict> {
    const host = canonicalHost(hostname);
    if (!host) return { ok: false, host, reason: "invalid", message: "That address has no host." };

    const byName = classifyName(host);
    if (byName === "metadata") return this.refuse(host, "metadata");
    if (byName === "private" && !this.allowPrivateHosts) return this.refuse(host, "private");

    if (isIP(host)) {
      const cls = classifyAddress(host) ?? "public";
      if (cls === "metadata" || (cls === "private" && !this.allowPrivateHosts)) return this.refuse(host, cls);
      return { ok: true, host, addresses: [{ address: host, family: isIP(host) === 6 ? 6 : 4 }] };
    }

    const addresses = await this.resolve(host);
    if (!addresses || addresses.length === 0) {
      return { ok: false, host, reason: "unresolved", message: `Could not find ${host}. Check the address.` };
    }
    const classes = addresses.map((a) => classifyAddress(a.address) ?? "private");
    if (classes.includes("metadata")) return this.refuse(host, "metadata");
    if (classes.includes("private") && !this.allowPrivateHosts) return this.refuse(host, "private");
    // IPv4 first: it is what most sites serve reliably.
    const ordered = [...addresses].sort((a, b) => a.family - b.family);
    return { ok: true, host, addresses: ordered };
  }

  /**
   * A second check once the port is known: loopback on a protected port is Steward itself. Returns
   * the verdict unchanged when it is fine.
   */
  checkPort(verdict: HostVerdict, port: number): HostVerdict {
    if (!verdict.ok || !this.protectedPorts.has(port)) return verdict;
    const loopback = verdict.addresses.some((a) => a.address === "::1" || a.address.startsWith("127."));
    if (!loopback) return verdict;
    return {
      ok: false,
      host: verdict.host,
      reason: "private",
      message: "That address is Steward's own server. Steward's browser never opens it.",
    };
  }

  private refuse(host: string, reason: "metadata" | "private"): HostVerdict {
    const message =
      reason === "metadata"
        ? `${host} is a cloud metadata address. Steward never opens those.`
        : `${host} is on this computer or a private network. Steward's browser does not open those unless private hosts are allowed (STEWARD_ALLOW_PRIVATE_HOSTS=1).`;
    return { ok: false, host, reason, message };
  }

  private async resolve(host: string): Promise<ResolvedAddress[] | undefined> {
    const now = this.now();
    const cached = this.cache.get(host);
    if (cached && cached.expires > now) return cached.addresses;
    const pending = this.inflight.get(host);
    if (pending) return pending;
    const task = this.lookup(host)
      .then((addresses) => {
        this.remember(host, addresses, this.cacheMs);
        return addresses;
      })
      .catch(() => {
        this.remember(host, undefined, FAILED_LOOKUP_MS);
        return undefined;
      })
      .finally(() => this.inflight.delete(host));
    this.inflight.set(host, task);
    return task;
  }

  private remember(host: string, addresses: ResolvedAddress[] | undefined, ttl: number): void {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(host, { expires: this.now() + ttl, addresses });
  }
}

export function createHostPolicy(opts: HostPolicyOptions = {}): HostPolicy {
  return new HostPolicy(opts);
}
