// Adapted from the ordered, duplicate-safe message log in happy-server
// (sources/app/api/routes/v3SessionRoutes.ts; slopus/happy, MIT, Copyright (c) 2026 Happy Coder
// Contributors): `localId` dedupe and `after_seq` catch-up, here per device.
import { createHash, randomBytes } from "node:crypto";
import { Db, type Migration } from "@steward/db";
import type { Envelope } from "@steward/remote";

/**
 * What the relay keeps: devices (an id, a hashed token, a push subscription) and each device's
 * sealed log. Never a key, never plaintext. Pairings live in memory only, for two minutes.
 */

const migrations: Migration[] = [
  {
    id: "relay.001_devices",
    sql: `
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        push_json TEXT
      );
      CREATE TABLE envelopes (
        device_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        local_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        c TEXT NOT NULL,
        at TEXT NOT NULL,
        PRIMARY KEY (device_id, seq),
        UNIQUE (device_id, local_id)
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  },
];

/** How many envelopes a device keeps. Older ones are dropped; the phone refetches by RPC. */
export const KEEP_ENVELOPES = 500;

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export class RelayStore {
  readonly db: Db;

  constructor(path: string) {
    this.db = new Db(path);
    this.db.migrate(migrations);
  }

  /** A device and its token. The token is returned once and kept only as a hash. */
  createDevice(id: string): string {
    const token = randomBytes(32).toString("base64url");
    this.db.run("INSERT INTO devices (id, token_hash, created_at) VALUES (?, ?, ?)", [
      id,
      sha256(token),
      new Date().toISOString(),
    ]);
    return token;
  }

  deviceForToken(token: string): string | undefined {
    if (!token || token.length > 200) return undefined;
    return this.db.get<{ id: string }>("SELECT id FROM devices WHERE token_hash = ? AND revoked_at IS NULL", [
      sha256(token),
    ])?.id;
  }

  isActive(id: string): boolean {
    return this.db.get("SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL", [id]) !== undefined;
  }

  /** Revokes a device and drops its log and push subscription. */
  revoke(id: string): void {
    this.db.tx(() => {
      this.db.run("UPDATE devices SET revoked_at = ?, push_json = NULL WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
      this.db.run("DELETE FROM envelopes WHERE device_id = ?", [id]);
    });
  }

  setPush(id: string, subscription: PushSubscriptionJson): void {
    this.db.run("UPDATE devices SET push_json = ? WHERE id = ? AND revoked_at IS NULL", [
      JSON.stringify(subscription),
      id,
    ]);
  }

  clearPush(id: string): void {
    this.db.run("UPDATE devices SET push_json = NULL WHERE id = ?", [id]);
  }

  push(id: string): PushSubscriptionJson | undefined {
    const row = this.db.get<{ push_json: string | null }>(
      "SELECT push_json FROM devices WHERE id = ? AND revoked_at IS NULL",
      [id],
    );
    return row?.push_json ? (JSON.parse(row.push_json) as PushSubscriptionJson) : undefined;
  }

  /**
   * Appends envelopes in order. An envelope whose `localId` is already in the log is not added
   * again, so a bridge that resends after a reconnect does no harm.
   */
  append(deviceId: string, items: { localId: string; topic: string; c: string }[]): Envelope[] {
    if (!this.isActive(deviceId)) return [];
    return this.db.tx(() => {
      const added: Envelope[] = [];
      let seq = this.latestSeq(deviceId);
      for (const item of items) {
        const exists = this.db.get("SELECT seq FROM envelopes WHERE device_id = ? AND local_id = ?", [
          deviceId,
          item.localId,
        ]);
        if (exists) continue;
        seq += 1;
        const at = new Date().toISOString();
        this.db.run(
          "INSERT INTO envelopes (device_id, seq, local_id, topic, c, at) VALUES (?, ?, ?, ?, ?, ?)",
          [deviceId, seq, item.localId, item.topic, item.c, at],
        );
        added.push({ seq, localId: item.localId, topic: item.topic, c: item.c, at });
      }
      this.db.run("DELETE FROM envelopes WHERE device_id = ? AND seq <= ?", [deviceId, seq - KEEP_ENVELOPES]);
      return added;
    });
  }

  latestSeq(deviceId: string): number {
    return (
      this.db.get<{ seq: number | null }>("SELECT MAX(seq) AS seq FROM envelopes WHERE device_id = ?", [
        deviceId,
      ])?.seq ?? 0
    );
  }

  /** What a phone missed: everything after `afterSeq`, oldest first. */
  after(deviceId: string, afterSeq: number, limit = 200): Envelope[] {
    return this.db
      .all<{ seq: number; local_id: string; topic: string; c: string; at: string }>(
        "SELECT seq, local_id, topic, c, at FROM envelopes WHERE device_id = ? AND seq > ? ORDER BY seq LIMIT ?",
        [deviceId, afterSeq, Math.min(Math.max(limit, 1), 500)],
      )
      .map((r) => ({ seq: r.seq, localId: r.local_id, topic: r.topic, c: r.c, at: r.at }));
  }

  setting(key: string): string | undefined {
    return this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  close(): void {
    this.db.close();
  }
}
