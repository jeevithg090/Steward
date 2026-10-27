// Adapted from openbot/server/src/computer/target.ts (MIT, CopilotKit)
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Where an address leads, as far as Steward is concerned.
 *
 * - `public`: the internet. Fine to fetch.
 * - `private`: this computer or its private network (loopback, RFC 1918, unique-local, carrier-grade
 *   NAT such as a Tailscale network). Refused unless the person opted in with
 *   `STEWARD_ALLOW_PRIVATE_HOSTS=1`, because a page or a model could otherwise reach Steward's own
 *   API and every service on the LAN.
 * - `forbidden`: cloud metadata services and link-local ranges. Refused always, opt-in or not:
 *   that is how a machine's cloud credentials leave it, and no task needs them.
 */
export type AddressClass = "public" | "private" | "forbidden";

/** One DNS answer. The shape `dns.lookup(..., { all: true })` returns. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a hostname to every address it has. Injected in tests; `dns.lookup` by default. */
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export interface HostPolicy {
  allowPrivateHosts?: boolean;
  lookup?: LookupFn;
}

/** A refusal, with a sentence the person can act on. Never retried. */
export class BlockedAddressError extends Error {
  readonly code = "blocked_address";
  readonly addressClass: Exclude<AddressClass, "public"> | "scheme" | "credentials" | "invalid";
  constructor(message: string, addressClass: BlockedAddressError["addressClass"]) {
    super(message);
    this.name = "BlockedAddressError";
    this.addressClass = addressClass;
  }
}

const PRIVATE_REASON =
  "That address is on this computer or its private network, so Steward won't open it. " +
  "To allow local addresses while developing, start Steward with STEWARD_ALLOW_PRIVATE_HOSTS=1.";
const FORBIDDEN_REASON =
  "That address belongs to a cloud metadata service or a link-local network, which can hold this " +
  "machine's credentials, so Steward never opens it.";

/** Names that reach a metadata service without looking like an IP address. */
const FORBIDDEN_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog", "metadata"]);

/** Metadata endpoints that sit outside the link-local ranges below. */
const FORBIDDEN_IPS = new Set(["100.100.100.200", "fd00:ec2::254", "fd20:ce::254"]);

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * The hostname reduced to one comparable form: lower case, no root dot, no IPv6 brackets, and an
 * IPv6 address that carries an IPv4 one (`::ffff:a.b.c.d`, NAT64 `64:ff9b::/96`, the deprecated
 * `::/96`) unwrapped to that IPv4 address. `new URL()` already turns `127.1` and `2130706433` into
 * `127.0.0.1`; it does not unwrap embedded IPv4 or drop the root dot.
 */
export function canonicalHost(hostname: string): string {
  let name = hostname.toLowerCase().replace(/\.+$/, "");
  if (name.startsWith("[") && name.endsWith("]")) name = name.slice(1, -1);
  if (!name.includes(":")) return name;
  const groups = expandIpv6(name);
  if (!groups) return name;
  return embeddedIpv4(groups) ?? compressIpv6(groups);
}

/** Classifies a literal IPv4 or IPv6 address. Anything that does not parse is `forbidden`. */
export function classifyIp(ip: string): AddressClass {
  const host = canonicalHost(ip);
  if (FORBIDDEN_IPS.has(host)) return "forbidden";
  if (isIP(host) === 4) return classifyIpv4(host);
  if (isIP(host) === 6) return classifyIpv6(host);
  return "forbidden";
}

/**
 * Classifies a hostname without resolving it: literal IPs by range, `localhost` and `*.localhost` as
 * private (Chromium and most resolvers send the whole zone to loopback without asking DNS),
 * metadata names as forbidden, everything else as public until DNS says otherwise.
 */
export function classifyHostname(hostname: string): AddressClass {
  const host = canonicalHost(hostname);
  if (FORBIDDEN_HOSTNAMES.has(host)) return "forbidden";
  if (isIP(host)) return classifyIp(host);
  if (host === "localhost" || host.endsWith(".localhost")) return "private";
  if (host === "") return "forbidden";
  return "public";
}

export type AddressVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: string; error: BlockedAddressError };

function refuse(reason: string, cls: BlockedAddressError["addressClass"]): AddressVerdict {
  return { ok: false, reason, error: new BlockedAddressError(reason, cls) };
}

/**
 * Decides whether Steward may open this address, from the address alone (no DNS). Use
 * {@link assertPublicHost} as well before connecting, so a public name that resolves to a private
 * address is caught too.
 */
export function checkWebAddress(raw: string | URL, policy: HostPolicy = {}): AddressVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("That is not a web address.", "invalid");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return refuse(
      `Only web addresses (http and https) can be opened, and that one is ${url.protocol.replace(":", "")}.`,
      "scheme",
    );
  }
  if (url.username || url.password) {
    return refuse(
      "That address has a user name or password in it. Steward doesn't open those, so the secret stays out of the record.",
      "credentials",
    );
  }
  const cls = classifyHostname(url.hostname);
  if (cls === "forbidden") return refuse(FORBIDDEN_REASON, "forbidden");
  if (cls === "private" && !policy.allowPrivateHosts) return refuse(PRIVATE_REASON, "private");
  return { ok: true, url };
}

export const defaultLookup: LookupFn = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family,
  }));

/**
 * Resolves a hostname and refuses it when any of its addresses is private (unless allowed) or
 * forbidden. Any, not all: a name with one public and one private address is a name that can be
 * steered at the private one. Returns the checked addresses, so a caller can connect to exactly
 * those and nothing a second lookup might say.
 */
export async function assertPublicHost(
  hostname: string,
  policy: HostPolicy = {},
): Promise<ResolvedAddress[]> {
  const host = canonicalHost(hostname);
  const literal = isIP(host);
  const first = classifyHostname(host);
  if (first === "forbidden") throw new BlockedAddressError(FORBIDDEN_REASON, "forbidden");
  if (first === "private" && !policy.allowPrivateHosts)
    throw new BlockedAddressError(PRIVATE_REASON, "private");
  if (literal) return [{ address: host, family: literal }];

  let addresses: ResolvedAddress[];
  try {
    addresses = await (policy.lookup ?? defaultLookup)(host);
  } catch (err) {
    const code = (err as { code?: string }).code;
    throw new Error(
      code === "ENOTFOUND" || code === "EAI_NONAME"
        ? `Couldn't find a website at ${host}. Check the address.`
        : `Couldn't look up ${host}: ${(err as Error).message}`,
    );
  }
  if (addresses.length === 0) throw new Error(`Couldn't find a website at ${host}. Check the address.`);
  for (const { address } of addresses) {
    const cls = classifyIp(address);
    if (cls === "forbidden") throw new BlockedAddressError(FORBIDDEN_REASON, "forbidden");
    if (cls === "private" && !policy.allowPrivateHosts)
      throw new BlockedAddressError(PRIVATE_REASON, "private");
  }
  return addresses;
}

// ── IPv4 ──────────────────────────────────────────────────────────────────────────────────────

function ipv4Octets(ip: string): [number, number, number, number] | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  if (octets.some((o) => Number.isNaN(o) || o > 255)) return undefined;
  return octets as [number, number, number, number];
}

function classifyIpv4(ip: string): AddressClass {
  const o = ipv4Octets(ip);
  if (!o) return "forbidden";
  const [a, b, c] = o;
  if (a === 169 && b === 254) return "forbidden"; // link-local, home of 169.254.169.254
  if (a === 0) return "private"; // "this host"; 0.0.0.0 reaches every local port
  if (a === 10) return "private";
  if (a === 127) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private"; // carrier-grade NAT, Tailscale
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 192 && b === 0 && c === 0) return "private"; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return "private"; // benchmarking
  if (a >= 224) return "private"; // multicast, reserved, broadcast
  return "public";
}

// ── IPv6 ──────────────────────────────────────────────────────────────────────────────────────

/** The eight 16-bit groups of an IPv6 address, or undefined. Accepts a trailing dotted IPv4. */
function expandIpv6(input: string): number[] | undefined {
  let text = input;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const tailV4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tailV4?.[1]) {
    const o = ipv4Octets(tailV4[1]);
    if (!o) return undefined;
    const hex = `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    text = text.slice(0, tailV4.index) + hex;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN));
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if ([...head, ...tail].some((g) => Number.isNaN(g))) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function compressIpv6(groups: number[]): string {
  // Longest run of zero groups becomes "::", matching what `new URL()` and `dns` print.
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i > 1) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

/**
 * The IPv4 address an IPv6 one carries in its low 32 bits, for the three prefixes that route to it:
 * IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96` and the deprecated compatible `::/96`. The
 * compatible form keeps `::` and `::1` as IPv6 (their low bits are 0.0.0.0 and 0.0.0.1).
 */
function embeddedIpv4(groups: number[]): string | undefined {
  const [a, b, c, d, e, f, high = 0, low = 0] = groups;
  const zeros = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  const mapped = zeros && f === 0xffff;
  const compatible = zeros && f === 0;
  const nat64 = a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0;
  if (!mapped && !compatible && !nat64) return undefined;
  if (compatible && high >> 8 === 0) return undefined;
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function classifyIpv6(ip: string): AddressClass {
  const groups = expandIpv6(ip);
  if (!groups) return "forbidden";
  const v4 = embeddedIpv4(groups);
  if (v4) return classifyIpv4(v4);
  if (groups.every((g) => g === 0)) return "private"; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "private"; // ::1
  const first = groups[0] ?? 0;
  if (first >= 0xfe80 && first <= 0xfebf) return "forbidden"; // fe80::/10 link-local
  if (first >= 0xfc00 && first <= 0xfdff) return "private"; // fc00::/7 unique-local
  if (first >= 0xff00) return "private"; // multicast
  return "public";
}
