/**
 * The record: an append-only, hash-chained audit log.
 *
 * Every row carries `prevHash` (the hash of the row before) and `hash` = sha256(prevHash +
 * canonical JSON of the row without `hash`). Triggers refuse UPDATE and DELETE; if someone gets
 * past them (by dropping the triggers, or editing the file), a check finds the first row that no
 * longer matches. Details are redacted before they are hashed, so a secret never enters the chain.
 *
 * Checking hashes every row, which takes seconds on a big record, so `check()` does it a page at a
 * time and gives way between pages. It remembers the newest row it found intact; the next check
 * hashes only the rows after it (and re-reads that row and the numbering), and a full walk runs
 * again at least hourly, on request, or whenever something looks off.
 */
import type { Db } from "@steward/db";
import { fromJson, toJson } from "@steward/db";
import type {
  AuditType,
  ChainAnchor,
  ChainCheck,
  ChainCheckOptions,
  Effect,
  EventBus,
  RecordLog,
} from "@steward/shared";
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

export type AuditInput = Parameters<RecordLog["append"]>[0];

/** Rows hashed between two pauses of a check. */
const CHECK_PAGE = 250;
/** A check walks the whole chain again when the last full walk is older than this. */
export const FULL_CHECK_EVERY_MS = 60 * 60_000;

/** The newest row a check found chaining, intact, from the first one. */
interface Checkpoint {
  seq: number;
  hash: string;
  at: string;
}

/** Where a walk stopped: at the end, or at the first row that is missing or does not match. */
interface Walked {
  last?: Checkpoint;
  brokenAt?: number;
}

/**
 * Text the database stores as it is given. A lone UTF-16 surrogate would come back as U+FFFD, so
 * the row would never match its hash again; it is replaced before hashing instead.
 */
function wellFormed<T extends string | undefined>(text: T): T {
  return (typeof text === "string" ? text.toWellFormed() : text) as T;
}

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

function rowIntact(row: AuditRow): boolean {
  const { hash, ...body } = rowToEvent(row);
  return hashEvent(body) === hash;
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

export class SqliteAuditLog implements RecordLog {
  /** The newest row known to chain intact from the first. Kept in memory only. */
  private verified: Checkpoint | undefined;
  /**
   * The newest row any check has found intact. The checkpoint moves back to just before a break;
   * this never moves back, so cutting the record after a break is still seen.
   */
  private newest: Checkpoint | undefined;
  /** When the whole chain was last walked. */
  private fullAt: Date | undefined;
  /**
   * A row an earlier check found intact that later changed or went: the record was rewritten
   * while Steward ran. A fresh walk of a rewritten chain can pass, so this is kept until restart.
   */
  private rewrittenAt: number | undefined;
  /** Checks run one at a time, so two never move the checkpoint past each other. */
  private queue: Promise<unknown> = Promise.resolve();

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
      type: wellFormed(input.type),
      actorId: wellFormed(input.actorId || "system"),
      agentId: wellFormed(input.agentId),
      threadId: wellFormed(input.threadId),
      runId: wellFormed(input.runId),
      toolCallId: wellFormed(input.toolCallId),
      tool: input.tool,
      target: recordTarget(input.target),
      effect: wellFormed(input.effect),
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

  /** Hashes every row again, all at once. Blocks while it runs: the server uses `check`. */
  verify(opts: Pick<ChainCheckOptions, "anchor"> = {}): ChainCheck {
    const gen = this.fullWalk(opts.anchor);
    for (;;) {
      const step = gen.next();
      if (step.done) return step.value;
    }
  }

  /**
   * Checks the chain a page at a time, giving way to other work between pages. Without `full` or
   * an anchor it hashes only the rows added since the last full walk, once it has confirmed that
   * the newest row that walk reached is unchanged and the numbering has no gaps. Anything off, or
   * a last full walk over an hour old, walks the whole chain instead.
   */
  check(opts: ChainCheckOptions = {}): Promise<ChainCheck> {
    const run = () => this.drain(this.checkSteps(opts));
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Every row as stored, oldest first, a page at a time (rows numbered below 1 included). */
  *exportPages(pageSize = 500): Generator<AuditEvent[], void> {
    const size = Math.min(Math.max(Math.trunc(pageSize), 1), 5_000);
    let after = Number.MIN_SAFE_INTEGER;
    for (;;) {
      const rows = this.db.all<AuditRow>("SELECT * FROM gateway_audit WHERE seq > ? ORDER BY seq LIMIT ?", [
        after,
        size,
      ]);
      if (rows.length > 0) yield rows.map(rowToEvent);
      const last = rows[rows.length - 1];
      if (!last || rows.length < size) return;
      after = last.seq;
    }
  }

  private async drain(gen: Generator<void, ChainCheck>): Promise<ChainCheck> {
    for (;;) {
      const step = gen.next();
      if (step.done) return step.value;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private *checkSteps(opts: ChainCheckOptions): Generator<void, ChainCheck> {
    const from = this.verified;
    const stale = !this.fullAt || this.now().getTime() - this.fullAt.getTime() >= FULL_CHECK_EVERY_MS;
    if (opts.full || opts.anchor || !from || stale) return yield* this.fullWalk(opts.anchor);
    // The rows before the checkpoint are not hashed again, so check what can be checked cheaply:
    // nothing numbered below 1, no gaps, and the checkpoint row itself unchanged.
    const shape = this.shape();
    const row = this.db.get<AuditRow>("SELECT * FROM gateway_audit WHERE seq = ?", [from.seq]);
    if (shape.lo !== 1 || shape.n !== shape.hi || !row || row.hash !== from.hash || !rowIntact(row)) {
      return yield* this.fullWalk();
    }
    const walked = yield* this.walk(from);
    return this.result(walked, "recent");
  }

  private *fullWalk(anchor?: ChainAnchor): Generator<void, ChainCheck> {
    const shape = this.shape();
    // The chain starts at 1. A row numbered below it was put there by hand.
    const walked: Walked = shape.n > 0 && shape.lo < 1 ? { brokenAt: shape.lo } : yield* this.walk(undefined);
    this.fullAt = this.now();
    const check = this.result(walked, "full");
    if (!anchor) return check;
    const seal = { seq: anchor.seq, hash: anchor.hash.trim().toLowerCase() };
    const reached = walked.last !== undefined && seal.seq <= walked.last.seq;
    const ok = reached && this.matches(seal);
    return { ...check, ok: check.ok && ok, anchor: { ...seal, ok } };
  }

  /** Whether the row numbered `seq` still has this hash. */
  private matches(seal: ChainAnchor): boolean {
    const row = this.db.get<{ hash: string }>("SELECT hash FROM gateway_audit WHERE seq = ?", [seal.seq]);
    return row?.hash === seal.hash;
  }

  /** Hashes rows again after `from` (or from the first), giving way between pages. */
  private *walk(from: Checkpoint | undefined): Generator<void, Walked> {
    let prev = from?.hash ?? GENESIS_HASH;
    let expected = (from?.seq ?? 0) + 1;
    let last = from;
    for (;;) {
      const rows = this.db.all<AuditRow>("SELECT * FROM gateway_audit WHERE seq >= ? ORDER BY seq LIMIT ?", [
        expected,
        CHECK_PAGE,
      ]);
      for (const row of rows) {
        // A missing row (gap in seq), a row that does not chain from the one before, or one changed.
        if (row.seq !== expected || row.prev_hash !== prev || !rowIntact(row)) {
          return last ? { last, brokenAt: row.seq } : { brokenAt: row.seq };
        }
        prev = row.hash;
        expected++;
        last = { seq: row.seq, hash: row.hash, at: row.at };
      }
      if (rows.length < CHECK_PAGE) return last ? { last } : {};
      yield;
    }
  }

  private shape(): { n: number; lo: number; hi: number } {
    const row = this.db.get<{ n: number; lo: number | null; hi: number | null }>(
      "SELECT COUNT(*) AS n, MIN(seq) AS lo, MAX(seq) AS hi FROM gateway_audit",
    );
    return { n: row?.n ?? 0, lo: row?.lo ?? 0, hi: row?.hi ?? 0 };
  }

  /**
   * The newest row any check found intact must still be there with the same hash. If it changed or
   * went, the record was rewritten or cut while Steward ran, and that is kept until restart, even
   * when the chain that is left holds together.
   */
  private noteRewrite(walked: Walked): void {
    const top = this.newest;
    if (top && !this.matches(top)) this.rewrittenAt ??= Math.min(top.seq, (walked.last?.seq ?? 0) + 1);
    if (walked.last && (!top || walked.last.seq > top.seq)) this.newest = walked.last;
  }

  /** Moves the checkpoint to where the walk stopped, and says what it found. */
  private result(walked: Walked, scope: "full" | "recent"): ChainCheck {
    this.noteRewrite(walked);
    this.verified = walked.last;
    const breaks = [walked.brokenAt, this.rewrittenAt].filter((n): n is number => n !== undefined);
    const brokenAt = breaks.length > 0 ? Math.min(...breaks) : undefined;
    const count = Math.min(
      walked.last?.seq ?? 0,
      brokenAt === undefined ? Number.POSITIVE_INFINITY : brokenAt - 1,
    );
    const check: ChainCheck = { ok: brokenAt === undefined, count: Math.max(count, 0), scope };
    if (brokenAt !== undefined) check.brokenAt = brokenAt;
    if (this.fullAt) check.fullCheckAt = this.fullAt.toISOString();
    if (walked.last && check.ok) check.head = { ...walked.last };
    return check;
  }

  /** All rows for one tool call, oldest first. Handy for tests and the action card's history. */
  forToolCall(toolCallId: string): AuditEvent[] {
    return this.db
      .all<AuditRow>("SELECT * FROM gateway_audit WHERE tool_call_id = ? ORDER BY seq", [toolCallId])
      .map(rowToEvent);
  }
}
