/**
 * The record: an append-only, hash-chained audit log.
 *
 * Every row carries `prevHash` (the hash of the row before) and `hash` = sha256(prevHash +
 * canonical JSON of the row without `hash`). Triggers refuse UPDATE and DELETE; if someone gets
 * past them (by dropping the triggers, or editing the file), `verify()` finds the first row that no
 * longer matches. Details are redacted before they are hashed, so a secret never enters the chain.
 */
import type { Db } from "@steward/db";
import { fromJson, toJson } from "@steward/db";
import type { AuditLog, AuditType, ChainCheck, Effect, EventBus } from "@steward/shared";
import { type AuditEvent, newId } from "@steward/shared";
import { maskSensitive } from "./outbound.ts";
import {
  canonicalJson,
  plainJson,
  type RedactOptions,
  redactForAudit,
  sha256Hex,
  truncate,
} from "./redact.ts";

/** The hash the first row chains from. */
export const GENESIS_HASH = "0".repeat(64);

export type AuditInput = Parameters<AuditLog["append"]>[0];

interface AuditRow {
  seq: number;
  id: string;
  at: string;
  type: string;
  actor_id: string;
  agent_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  tool_call_id: string | null;
  tool_json: string | null;
  target_json: string | null;
  effect: string | null;
  rule_json: string | null;
  detail_json: string;
  prev_hash: string;
  hash: string;
}

/** The fields the hash covers: everything but `hash`, with absent fields left out. */
function hashBody(event: Omit<AuditEvent, "hash">): string {
  return canonicalJson(event);
}

export function hashEvent(event: Omit<AuditEvent, "hash">): string {
  return sha256Hex(event.prevHash + hashBody(event));
}

function rowToEvent(row: AuditRow): AuditEvent {
  const event: AuditEvent = {
    seq: row.seq,
    id: row.id,
    at: row.at,
    type: row.type as AuditType,
    actorId: row.actor_id,
    detail: fromJson<Record<string, unknown>>(row.detail_json, {}),
    prevHash: row.prev_hash,
    hash: row.hash,
  };
  if (row.agent_id !== null) event.agentId = row.agent_id;
  if (row.thread_id !== null) event.threadId = row.thread_id;
  if (row.run_id !== null) event.runId = row.run_id;
  if (row.tool_call_id !== null) event.toolCallId = row.tool_call_id;
  if (row.tool_json !== null) event.tool = fromJson<AuditEvent["tool"]>(row.tool_json, undefined);
  if (row.target_json !== null) event.target = fromJson<AuditEvent["target"]>(row.target_json, undefined);
  if (row.effect !== null) event.effect = row.effect as Effect;
  if (row.rule_json !== null) event.rule = fromJson<AuditEvent["rule"]>(row.rule_json, undefined);
  return event;
}

/** A target as the record keeps it: no query strings with keys in them, no long text. */
function recordTarget(target: AuditInput["target"]): AuditEvent["target"] {
  if (!target) return undefined;
  const out = plainJson(target) as NonNullable<AuditEvent["target"]>;
  if (out.url) out.url = truncate(maskSensitive(stripSecretsFromUrl(out.url)), 300);
  if (out.command) out.command = truncate(maskSensitive(out.command), 300);
  if (out.path) out.path = truncate(out.path, 300);
  if (out.element?.name) out.element.name = truncate(out.element.name, 120);
  if (out.recipients && out.recipients.length > 20) {
    out.recipients = [...out.recipients.slice(0, 20), `… ${out.recipients.length - 20} more`];
  }
  return out;
}

/** Query values under secret-looking names are dropped from URLs in the record. */
function stripSecretsFromUrl(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (/pass|secret|token|key|auth|sig|code|session|cookie|otp/i.test(key)) {
        u.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    if (u.password) {
      u.password = "redacted";
      changed = true;
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

export interface AuditPageOptions {
  before?: number;
  limit?: number;
  /** One type, a comma list, or a prefix ending in `*` (`approval.*`). */
  type?: string;
  /**
   * `allow`, `ask`, `deny` (matched against `tool.decided` rows, the only ones that carry an
   * effect), or `failed` for tool calls that failed after being allowed.
   */
  effect?: string;
  /** Free text over tool name, target host, command, summary and rule name. */
  q?: string;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class SqliteAuditLog implements AuditLog {
  constructor(
    private readonly db: Db,
    private readonly bus?: EventBus,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Appends and announces one event. Redacts `detail` and `target` first. */
  append(input: AuditInput, paths?: Pick<RedactOptions, "keep" | "hide">): AuditEvent {
    const event = this.db.tx(() => this.insert(input, paths));
    this.publish(event);
    return event;
  }

  /**
   * Appends inside the caller's transaction without announcing it. The caller publishes after
   * commit, so nobody hears about a row that was rolled back. `paths` names detail fields that are
   * secret (`args.text` typed into a password field) or are not, though named like one (`args.key`).
   */
  insert(input: AuditInput, paths?: Pick<RedactOptions, "keep" | "hide">): AuditEvent {
    const last = this.db.get<{ seq: number; hash: string }>(
      "SELECT seq, hash FROM gateway_audit ORDER BY seq DESC LIMIT 1",
    );
    const body = plainJson({
      seq: (last?.seq ?? 0) + 1,
      id: newId("aud"),
      at: this.now().toISOString(),
      type: input.type,
      actorId: input.actorId || "system",
      agentId: input.agentId,
      threadId: input.threadId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      tool: input.tool,
      target: recordTarget(input.target),
      effect: input.effect,
      rule: input.rule,
      detail: redactForAudit(input.detail ?? {}, paths),
      prevHash: last?.hash ?? GENESIS_HASH,
    }) as Omit<AuditEvent, "hash">;
    const event: AuditEvent = { ...body, hash: hashEvent(body) };
    this.db.run(
      `INSERT INTO gateway_audit (seq, id, at, type, actor_id, agent_id, thread_id, run_id, tool_call_id,
         tool_json, target_json, effect, rule_json, detail_json, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.seq,
        event.id,
        event.at,
        event.type,
        event.actorId,
        event.agentId ?? null,
        event.threadId ?? null,
        event.runId ?? null,
        event.toolCallId ?? null,
        event.tool ? toJson(event.tool) : null,
        event.target ? toJson(event.target) : null,
        event.effect ?? null,
        event.rule ? toJson(event.rule) : null,
        toJson(event.detail),
        event.prevHash,
        event.hash,
      ],
    );
    return event;
  }

  /** Tells live listeners. A listener that throws never fails the write. */
  publish(event: AuditEvent): void {
    try {
      this.bus?.emit({ type: "audit.appended", event });
    } catch (err) {
      console.error(JSON.stringify({ type: "gateway.bus_error", error: String(err) }));
    }
  }

  page(opts: AuditPageOptions = {}): { events: AuditEvent[]; nextBefore?: number; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];

    const types = (opts.type ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (types.length > 0) {
      const ors = types.map((t) => {
        if (t.endsWith("*")) {
          params.push(`${escapeLike(t.slice(0, -1))}%`);
          return "type LIKE ? ESCAPE '\\'";
        }
        params.push(t);
        return "type = ?";
      });
      where.push(`(${ors.join(" OR ")})`);
    }

    if (opts.effect) {
      if (opts.effect === "failed") where.push("type = 'tool.failed'");
      else if (["allow", "ask", "deny"].includes(opts.effect)) {
        where.push("effect = ?");
        params.push(opts.effect);
      } else where.push("0");
    }

    const q = opts.q?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const fields = [
        "json_extract(tool_json, '$.name')",
        "json_extract(target_json, '$.host')",
        "json_extract(target_json, '$.command')",
        "json_extract(detail_json, '$.summary')",
        "json_extract(rule_json, '$.name')",
      ];
      where.push(`(${fields.map((f) => `${f} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      for (let i = 0; i < fields.length; i++) params.push(like);
    }

    const filter = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total =
      this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM gateway_audit ${filter}`, params)?.n ?? 0;

    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
    const pageWhere = [...where];
    const pageParams = [...params];
    if (opts.before !== undefined && Number.isFinite(opts.before)) {
      pageWhere.push("seq < ?");
      pageParams.push(Math.trunc(opts.before));
    }
    const pageFilter = pageWhere.length > 0 ? `WHERE ${pageWhere.join(" AND ")}` : "";
    const rows = this.db.all<AuditRow>(
      `SELECT * FROM gateway_audit ${pageFilter} ORDER BY seq DESC LIMIT ?`,
      [...pageParams, limit + 1],
    );
    const events = rows.slice(0, limit).map(rowToEvent);
    const more = rows.length > limit;
    const last = events[events.length - 1];
    return more && last ? { events, nextBefore: last.seq, total } : { events, total };
  }

  /** Walks the whole chain, oldest first, in pages. */
  verify(): ChainCheck {
    let prev = GENESIS_HASH;
    let expected = 1;
    let count = 0;
    const PAGE = 500;
    for (;;) {
      const rows = this.db.all<AuditRow>("SELECT * FROM gateway_audit WHERE seq >= ? ORDER BY seq LIMIT ?", [
        expected,
        PAGE,
      ]);
      for (const row of rows) {
        // A missing row (gap in seq) or a row that does not chain from the one before.
        if (row.seq !== expected || row.prev_hash !== prev) return { ok: false, count, brokenAt: row.seq };
        const event = rowToEvent(row);
        const { hash, ...body } = event;
        if (hashEvent(body) !== hash) return { ok: false, count, brokenAt: row.seq };
        prev = row.hash;
        expected++;
        count++;
      }
      if (rows.length < PAGE) return { ok: true, count };
    }
  }

  /** All rows for one tool call, oldest first. Handy for tests and the action card's history. */
  forToolCall(toolCallId: string): AuditEvent[] {
    return this.db
      .all<AuditRow>("SELECT * FROM gateway_audit WHERE tool_call_id = ? ORDER BY seq", [toolCallId])
      .map(rowToEvent);
  }
}
