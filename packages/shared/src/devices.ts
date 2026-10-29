/**
 * Paired devices (docs/plans/phone-and-shortcuts.md §3, §8): a phone reaches Steward only through
 * the device listener, with a scoped, revocable token, and only through the routes listed here.
 * Shared by the server, the web app's Settings → Phone, and the phone surfaces.
 */
import { z } from "zod";
import type { CatalogueEntry, DeviceScope, DeviceUi } from "./phone.ts";

/** The device listener's port: tunnels point here, never at the main port (8787). */
export const DEFAULT_DEVICE_PORT = 8788;

export type DeviceKind = "shortcut" | "pwa" | "app";
export const DEVICE_KINDS = ["shortcut", "pwa", "app"] as const satisfies readonly DeviceKind[];

export const DEVICE_SCOPES = [
  "brief:read",
  "approvals:read",
  "approvals:decide",
  "chat",
  "tasks",
  "routines:run",
] as const satisfies readonly DeviceScope[];

/** Everything except saying yes to approvals, which the person turns on per device. */
export const DEFAULT_DEVICE_SCOPES: readonly DeviceScope[] = DEVICE_SCOPES.filter(
  (s) => s !== "approvals:decide",
);

/** Plain words for each scope, for Settings → Phone. */
export const DEVICE_SCOPE_LABELS: Record<DeviceScope, { label: string; description: string }> = {
  "brief:read": { label: "Read the brief", description: "What needs you today, read aloud or shown." },
  "approvals:read": {
    label: "See what Steward asks",
    description: "List the requests waiting for you, and refuse them.",
  },
  "approvals:decide": {
    label: "Say yes to requests",
    description: "This phone can say yes to things Steward asks about.",
  },
  chat: { label: "Talk to Steward", description: "Ask for things and hear the answer." },
  tasks: { label: "Tasks", description: "See, start and hide tasks." },
  "routines:run": { label: "Run routines", description: "Run one of your routines now." },
};

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  shortcut: "Shortcuts",
  pwa: "Steward on the phone",
  app: "Steward app",
};

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  scopes: DeviceScope[];
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  /** From the `X-Steward-Shortcut` header of its last call, e.g. `steward@1`. */
  shortcutVersion?: string;
}

/** What "Add a phone" shows: the code, and the two things to scan. */
export interface PairingOffer {
  kind: DeviceKind;
  /** Eight characters, single use, for ten minutes. Shown so it can also be read out or typed. */
  code: string;
  expiresAt: string;
  /** What the second QR code holds: `shortcuts://run-shortcut?…steward-pair:1:…`. */
  qrText: string;
  /** The generic Steward shortcut's download address on the phone address. */
  shortcutUrl: string;
  /** The address the phone will use (the device listener behind a tunnel). */
  deviceUrl: string;
}

/**
 * A rule about who may answer, which ships with Steward and cannot be switched off. Unlike the
 * presets on `/rules`, these judge answers to approvals, not tool calls.
 */
export interface DevicePreset {
  id: string;
  name: string;
  description: string;
  /** What the phone shows instead of the answer buttons. */
  phoneMessage: string;
}

/** The generic shortcut's version. Below `minVersion` every device route answers 426. */
export interface ShortcutManifest {
  id: string;
  version: number;
  minVersion: number;
  url: string;
  notes: string;
}

export const STEWARD_SHORTCUT = {
  id: "steward",
  name: "Steward",
  version: 1,
  minVersion: 1,
  notes: "The first Steward shortcut: your brief, what needs you, and asking Steward.",
} as const;

/** Every phone request names its shortcut and version: `steward@1`. */
export const SHORTCUT_HEADER = "x-steward-shortcut";

export interface PhoneInfo {
  /** The device listener (127.0.0.1:8788 by default); `port` is null when it is switched off. */
  listener: { port: number | null; running: boolean };
  /** Steward's main port, which a tunnel must never point at: it has no sign-in. */
  mainPort: number;
  /** The address the phone uses to reach the device listener, or null until it is set. */
  url: string | null;
  /** A plain warning about that address (plain http at home), when there is one. */
  urlWarning?: string;
  /** Host names the device listener answers besides this machine's own. */
  hosts: string[];
  /** Tunnel tools found on this machine, with the exact command to point them at the device port. */
  transports: { id: "tailscale" | "cloudflared"; found: boolean; command: string }[];
  presets: DevicePreset[];
  shortcut: ShortcutManifest;
  /** The relay for the phone app, when STEWARD_RELAY_URL is set, and what it can see. */
  relay: { configured: boolean; connected: boolean; url?: string; sees: string[] };
}

/** "Add phone (app)": the one-time QR address, and later the code to compare on both screens. */
export interface RemotePairing {
  pairingId: string;
  url: string;
  expiresAt: string;
}

export interface RemotePairingState {
  state: "waiting" | "check" | "paired" | "refused" | "expired";
  expiresAt: string;
  name?: string;
  /** "482 913": the phone shows the same code. */
  code?: string;
  deviceId?: string;
}

/** The address a QR code hands the generic shortcut: `steward-pair:1:<base64url JSON>`. */
export const PAIR_PREFIX = "steward-pair:1:";

export interface PairPayload {
  /** The device address, `https://…` (plain `http` only at home). */
  u: string;
  /** The pairing code. */
  c: string;
  /** The machine's name, shown before pairing. */
  n: string;
}

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // Padding kept: the shortcut swaps -_ back to +/ and decodes with Shortcuts' own Base64 action.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64url(text: string): string {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function pairText(payload: PairPayload): string {
  return `${PAIR_PREFIX}${base64url(JSON.stringify({ u: payload.u, c: payload.c, n: payload.n }))}`;
}

/** The QR code that runs the installed Steward shortcut with the pairing text as its input. */
export function pairRunUrl(payload: PairPayload, shortcutName: string = STEWARD_SHORTCUT.name): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text=${encodeURIComponent(
    pairText(payload),
  )}`;
}

/**
 * Reads pairing text the way the shortcut does: only `u`, `c` and `n`, nothing else. Any web page
 * can open the shortcut with any text, so anything else is refused.
 */
export function parsePairText(text: string): PairPayload | undefined {
  if (!text.startsWith(PAIR_PREFIX)) return undefined;
  try {
    const value = JSON.parse(fromBase64url(text.slice(PAIR_PREFIX.length))) as Record<string, unknown>;
    const { u, c, n } = value;
    if (typeof u !== "string" || typeof c !== "string" || typeof n !== "string") return undefined;
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return { u: url.origin, c, n: n.slice(0, 80) };
  } catch {
    return undefined;
  }
}

// ── Device API (the device listener only) ──────────────────────────────────────────────────────

export const DEVICE_ROUTES = {
  pair: "/device/pair", // POST DevicePairBody → DevicePairReply (no token: the code is the credential)
  home: "/device/home", // GET|POST → DeviceReply (the main menu, from the person's profile)
  brief: "/device/brief", // GET|POST → DeviceBrief
  approvals: "/device/approvals", // GET|POST ?status=pending → DeviceApprovals
  approval: "/device/approvals/:id", // GET|POST → DeviceReply (one request and its answers)
  approvalDecide: "/device/approvals/:id/decision", // POST DeviceDecisionBody → DeviceReply
  say: "/device/say", // POST DeviceSayBody → DeviceSayReply
  run: "/device/run/:actionId", // POST DeviceRunBody → DeviceReply
  manifest: "/device/manifest", // GET|POST → ShortcutManifest
  shortcut: "/device/shortcut/Steward.shortcut", // GET, no token: the generic signed shortcut
  install: "/device/install/:id", // GET, no token: a one-time personal shortcut (10 minutes)
} as const;

export const DevicePairBody = z.object({
  code: z.string().trim().min(4).max(32),
  deviceName: z.string().trim().min(1).max(60),
  kind: z.enum(DEVICE_KINDS).default("shortcut"),
  /** The phone app's device key (Phase 2). Shortcuts have none. */
  publicKey: z.string().max(200).optional(),
});

/** A phone may allow once or refuse. "Always allow" writes a standing rule, which stays on the Mac. */
export const DeviceDecisionBody = z.object({
  answer: z.enum(["once", "refuse"]),
  note: z.string().max(500).optional(),
});

export const DeviceSayBody = z.object({
  text: z.string().trim().min(1).max(4000),
  /** A skill name, as if the person typed `/name` first. */
  skill: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,40}$/)
    .optional(),
  /** Carry on in this conversation (one this device started). */
  threadId: z.string().max(128).optional(),
});

export const DeviceRunBody = z.object({ text: z.string().max(4000).optional() }).default({});

/** What every device route answers with: a short list the thin client acts on, in order. */
export interface DeviceReply {
  /**
   * Any number of `say` and `show`, then at most one `choose`, `ask` or `open`, last. A shortcut
   * cannot branch on more than one question per call.
   */
  ui: DeviceUi[];
}

export interface DevicePairReply extends DeviceReply {
  token: string;
  deviceId: string;
  scopes: DeviceScope[];
  minShortcutVersion: number;
  /** A Cloudflare Access service token the phone sends on every later call, when the tunnel has one. */
  access?: { clientId: string; clientSecret: string };
}

export interface DeviceBrief extends DeviceReply {
  /** At most 300 characters, written to be read aloud. */
  say: string;
  items: string[];
}

export interface DeviceApprovalItem {
  id: string;
  summary: string;
  kind: string;
  createdAt: string;
  expiresAt: string;
  /** Whether this phone may say yes here. Refusing is always possible. */
  canDecideHere: boolean;
  /** Why not, in words for the phone, when `canDecideHere` is false. */
  reason?: string;
  /** The phone app may still say yes after Face ID (a tainted send, delete or command). */
  withFaceId?: boolean;
}

export interface DeviceApprovals extends DeviceReply {
  items: DeviceApprovalItem[];
}

export interface DeviceSayReply extends DeviceReply {
  threadId: string;
  /** The reply, when the run finished in time. */
  say?: string;
  /** True when Steward is still working: the answer will be in the conversation. */
  pending?: boolean;
}

// ── Loopback API (the web app's Settings → Phone and Shortcuts page) ───────────────────────────

/** What the Shortcuts page shows: the catalogue, and what this machine can make and sign. */
export interface PhoneCatalogue {
  entries: (CatalogueEntry & { steps: string[]; launcher: boolean })[];
  steward: {
    /** What the generic shortcut does, in plain steps. */
    steps: string[];
    personalSteps: string[];
    /** Where the phone downloads it, on the phone address; null until that is set. */
    downloadUrl: string | null;
    /** A signed copy ships with this build. */
    shipped: boolean;
  };
  /** The morning brief as an automation the person adds by hand (iOS 27 embedding is unverified). */
  automation?: { time: string; input: string };
  shortcut: ShortcutManifest;
  /** Whether this machine can sign a personal file or a launcher, and why not. */
  signing: { available: boolean; reason?: string };
}

/** A one-time download: open it on the phone within ten minutes. */
export interface ShortcutInstall {
  url: string;
  expiresAt: string;
  name: string;
  /** The file holds this phone's key: say so, and never share it. */
  personal: boolean;
}

// ── Loopback API (the web app's Settings → Phone) ──────────────────────────────────────────────

export const PairingBody = z.object({ kind: z.enum(DEVICE_KINDS).default("shortcut") });

export const DevicePatchBody = z.object({
  scopes: z.array(z.enum(DEVICE_SCOPES)).max(DEVICE_SCOPES.length).optional(),
  name: z.string().trim().min(1).max(60).optional(),
});

/** The address the phone uses. An empty string clears it. */
export const PhoneSettingsBody = z.object({ url: z.string().trim().max(300) });
