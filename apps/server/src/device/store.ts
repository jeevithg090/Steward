import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Db } from "@steward/db";
import { fromJson, toJson } from "@steward/db";
import {
  type AuditLog,
  DEFAULT_DEVICE_SCOPES,
  DEVICE_SCOPES,
  type Device,
  type DeviceKind,
  type DeviceScope,
  newId,
} from "@steward/shared";

/**
 * Paired devices and pairing codes (docs/plans/phone-and-shortcuts.md §3.2).
 *
 * - A token is 256 random bits, shown once inside the pairing reply and stored only as its SHA-256.
 * - A code is 8 characters, lasts 10 minutes, is used once, and dies after 5 wrong tries.
 * - Pairing, revoking and changing scopes are written to the record.
 */

export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_ATTEMPTS = 5;
export const CODE_LENGTH = 8;
/** No 0/O, 1/I/L or U: a code read aloud or typed from a screen cannot be misread. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Marks a Steward device token for secret scanners and for the person reading a leak report. */
export const TOKEN_PREFIX = "stw_dev_";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function newPairingCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** What a person might type: lower case, spaces and dashes are forgiven. */
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function newDeviceToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** A code that did not work. The message is the same whatever was wrong, so it tells a guesser nothing. */
export class PairingError extends Error {
  override name = "PairingError";
  constructor() {
    super("That pairing code didn't work. Make a new one in Settings → Phone on your Mac.");
  }
}

interface DeviceRow {
  id: string;
  name: string;
  kind: string;
  token_hash: string;
  scopes_json: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  public_key: string | null;
  shortcut_version: string | null;
}

interface CodeRow {
  code_hash: string;
  kind: string;
  created_at: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
}

/** Scopes as stored, with anything unknown dropped: a scope is only ever granted by name. */
function scopesOf(json: string): DeviceScope[] {
  const raw = fromJson<unknown>(json, []);
  if (!Array.isArray(raw)) return [];
  return DEVICE_SCOPES.filter((s) => raw.includes(s));
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as DeviceKind,
    scopes: scopesOf(row.scopes_json),
    createdAt: row.created_at,
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.shortcut_version ? { shortcutVersion: row.shortcut_version } : {}),
  };
}

/** How often `last seen` is written for one device. A shortcut menu makes several calls in a row. */
const SEEN_EVERY_MS = 30_000;

export class DeviceStore {
  constructor(
    private readonly db: Db,
    private readonly audit: Pick<AuditLog, "append">,
    private readonly actorId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * A new code for pairing one device. Codes made before it stop working: only the newest offer on
   * the screen pairs, so a code someone photographed earlier is already dead.
   */
  createPairing(kind: DeviceKind): { code: string; expiresAt: string } {
    const at = this.now();
    const code = newPairingCode();
    const expiresAt = new Date(at.getTime() + PAIRING_TTL_MS).toISOString();
    this.db.tx(() => {
      this.db.run("UPDATE pairing_codes SET expires_at = ? WHERE consumed_at IS NULL AND expires_at > ?", [
        at.toISOString(),
        at.toISOString(),
      ]);
      this.db.run("DELETE FROM pairing_codes WHERE expires_at < ?", [
        new Date(at.getTime() - 24 * 3_600_000).toISOString(),
      ]);
      this.db.run(
        "INSERT INTO pairing_codes (code_hash, kind, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)",
        [sha256(normaliseCode(code)), kind, at.toISOString(), expiresAt],
      );
    });
    return { code, expiresAt };
  }

  /**
   * Trades a code for a device and its token. A wrong code counts against every live code (codes
   * are stored hashed, so a guess cannot be matched to one), and a code dies after five.
   */
  pair(input: { code: string; deviceName: string; kind: DeviceKind; publicKey?: string }): {
    device: Device;
    token: string;
  } {
    const at = this.now().toISOString();
    const hash = sha256(normaliseCode(input.code));
    const result = this.db.tx(() => {
      const row = this.db.get<CodeRow>("SELECT * FROM pairing_codes WHERE code_hash = ?", [hash]);
      const usable =
        row &&
        row.consumed_at === null &&
        row.expires_at > at &&
        row.attempts < PAIRING_ATTEMPTS &&
        row.kind === input.kind;
      if (!usable) {
        this.db.run(
          "UPDATE pairing_codes SET attempts = attempts + 1 WHERE consumed_at IS NULL AND expires_at > ?",
          [at],
        );
        return undefined;
      }
      const used = this.db.run(
        "UPDATE pairing_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL",
        [at, hash],
      );
      if (used.changes !== 1) return undefined;
      const token = newDeviceToken();
      const id = newId("dev");
      this.db.run(
        `INSERT INTO devices (id, name, kind, token_hash, scopes_json, created_at, last_seen_at, public_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.deviceName,
          input.kind,
          sha256(token),
          toJson(DEFAULT_DEVICE_SCOPES),
          at,
          at,
          input.publicKey ?? null,
        ],
      );
      return { device: this.get(id)!, token };
    });
    if (!result) {
      this.record("device.refused", undefined, { reason: "pairing code did not work", kind: input.kind });
      throw new PairingError();
    }
    this.record("device.paired", result.device, { scopes: result.device.scopes });
    return result;
  }

  /** The device a token belongs to, unless it was revoked. */
  authenticate(token: string): Device | undefined {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 128) return undefined;
    const row = this.db.get<DeviceRow>("SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL", [
      sha256(token),
    ]);
    return row ? toDevice(row) : undefined;
  }

  /** Notes a call: when it was, and which shortcut version made it. */
  touch(device: Device, shortcutVersion?: string): void {
    const at = this.now();
    const stale = !device.lastSeenAt || at.getTime() - Date.parse(device.lastSeenAt) > SEEN_EVERY_MS;
    const version = shortcutVersion?.slice(0, 40);
    if (!stale && (version === undefined || version === device.shortcutVersion)) return;
    this.db.run(
      "UPDATE devices SET last_seen_at = ?, shortcut_version = COALESCE(?, shortcut_version) WHERE id = ?",
      [at.toISOString(), version ?? null, device.id],
    );
  }

  get(id: string): Device | undefined {
    const row = this.db.get<DeviceRow>("SELECT * FROM devices WHERE id = ?", [id]);
    return row ? toDevice(row) : undefined;
  }

  /** The device key a phone app paired with (Phase 2), never shown. */
  publicKey(id: string): string | undefined {
    const row = this.db.get<{ public_key: string | null }>(
      "SELECT public_key FROM devices WHERE id = ? AND revoked_at IS NULL",
      [id],
    );
    return row?.public_key ?? undefined;
  }

  /** Paired devices, newest first. Revoked ones only when asked. */
  list(opts: { includeRevoked?: boolean } = {}): Device[] {
    const rows = this.db.all<DeviceRow>(
      `SELECT * FROM devices ${opts.includeRevoked ? "" : "WHERE revoked_at IS NULL"} ORDER BY created_at DESC, id DESC`,
    );
    return rows.map(toDevice);
  }

  /** Revokes at once: the next call with its token is refused. */
  revoke(id: string): Device | undefined {
    const at = this.now().toISOString();
    const changed = this.db.run("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [
      at,
      id,
    ]);
    const device = this.get(id);
    if (changed.changes === 1 && device) this.record("device.revoked", device, {});
    return device;
  }

  update(id: string, patch: { scopes?: DeviceScope[]; name?: string }): Device | undefined {
    const before = this.get(id);
    if (!before || before.revokedAt) return undefined;
    const scopes = patch.scopes ? DEVICE_SCOPES.filter((s) => patch.scopes?.includes(s)) : before.scopes;
    const name = patch.name ?? before.name;
    this.db.run("UPDATE devices SET scopes_json = ?, name = ? WHERE id = ?", [toJson(scopes), name, id]);
    const after = this.get(id);
    if (after) {
      this.record("device.changed", after, {
        ...(patch.scopes ? { scopes, before: before.scopes } : {}),
        ...(patch.name && patch.name !== before.name ? { renamedFrom: before.name } : {}),
      });
    }
    return after;
  }

  /** Writes a device row to the record. A record that cannot be written is reported, never silent. */
  record(
    type: "device.paired" | "device.changed" | "device.revoked" | "device.refused",
    device: Device | undefined,
    detail: Record<string, unknown>,
  ): void {
    try {
      this.audit.append({
        type,
        actorId: this.actorId,
        detail: {
          ...(device ? { via: `device:${device.id}`, device: device.name, deviceKind: device.kind } : {}),
          ...detail,
        },
      });
    } catch (err) {
      console.error("[steward] could not record a device event:", err instanceof Error ? err.message : err);
    }
  }
}
