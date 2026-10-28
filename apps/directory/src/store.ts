import { randomBytes, randomUUID } from "node:crypto";
import { type Db, fromJson, type Migration, toJson } from "@steward/db";
import type { BotPack, BotProblem } from "@steward/shared";

/**
 * What the directory server keeps, and nothing more (see the privacy page): install counts per bot
 * per day, "I use this" votes by GitHub id, sign-in sessions, submissions and claims waiting for a
 * reviewer, and reports. No addresses are stored; the rate limiter holds them in memory for its
 * window only.
 */
export const migrations: Migration[] = [
  {
    id: "directory.001_counts",
    sql: `
      CREATE TABLE IF NOT EXISTS installs (
        bot_id TEXT NOT NULL,
        day TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (bot_id, day)
      );
      CREATE TABLE IF NOT EXISTS used_votes (
        bot_id TEXT NOT NULL,
        github_id INTEGER NOT NULL,
        at TEXT NOT NULL,
        PRIMARY KEY (bot_id, github_id)
      );`,
  },
  {
    id: "directory.002_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        github_id INTEGER NOT NULL,
        login TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);`,
  },
  {
    id: "directory.003_submissions",
    sql: `
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('new', 'update', 'claim')),
        pack_json TEXT NOT NULL,
        source_url TEXT NOT NULL,
        github_id INTEGER,
        login TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        owner_matches INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      );
      CREATE INDEX IF NOT EXISTS submissions_by_status ON submissions (status, created_at);
      CREATE INDEX IF NOT EXISTS submissions_by_bot ON submissions (bot_id, status);`,
  },
  {
    id: "directory.004_reports",
    sql: `
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('report', 'removal')),
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        login TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_by_status ON reports (status, created_at);`,
  },
];

export interface SessionUser {
  githubId: number;
  login: string;
  name?: string;
  avatarUrl?: string;
  /** The GitHub profile page. */
  url: string;
}

export interface Session extends SessionUser {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export type SubmissionKind = "new" | "update" | "claim";
export type SubmissionStatus = "pending" | "approved" | "rejected";

export interface Submitter {
  /** Set when the person signed in; a submission through MCP carries only a handle. */
  githubId?: number;
  login: string;
  verified: boolean;
}

export interface Submission {
  id: string;
  botId: string;
  kind: SubmissionKind;
  pack: BotPack;
  sourceUrl: string;
  submitter: Submitter;
  /** The repository or gist belongs to the submitter's GitHub account. */
  ownerMatches: boolean;
  warnings: BotProblem[];
  status: SubmissionStatus;
  note: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export type ReportKind = "report" | "removal";

export interface Report {
  id: string;
  botId: string;
  kind: ReportKind;
  reason: string;
  details: string;
  contact: string;
  login?: string;
  status: "open" | "closed";
  createdAt: string;
}

interface SessionRow {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  url: string;
  created_at: string;
  expires_at: string;
}

interface SubmissionRow {
  id: string;
  bot_id: string;
  kind: SubmissionKind;
  pack_json: string;
  source_url: string;
  github_id: number | null;
  login: string;
  verified: number;
  owner_matches: number;
  warnings_json: string;
  status: SubmissionStatus;
  note: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

interface ReportRow {
  id: string;
  bot_id: string;
  kind: ReportKind;
  reason: string;
  details: string;
  contact: string;
  login: string | null;
  status: "open" | "closed";
  created_at: string;
}

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  githubId: row.github_id,
  login: row.login,
  ...(row.name ? { name: row.name } : {}),
  ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  url: row.url,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

const toSubmission = (row: SubmissionRow): Submission => ({
  id: row.id,
  botId: row.bot_id,
  kind: row.kind,
  pack: fromJson<BotPack>(row.pack_json, {} as BotPack),
  sourceUrl: row.source_url,
  submitter: {
    ...(row.github_id === null ? {} : { githubId: row.github_id }),
    login: row.login,
    verified: row.verified === 1,
  },
  ownerMatches: row.owner_matches === 1,
  warnings: fromJson<BotProblem[]>(row.warnings_json, []),
  status: row.status,
  note: row.note,
  createdAt: row.created_at,
  ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
  ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
});

const toReport = (row: ReportRow): Report => ({
  id: row.id,
  botId: row.bot_id,
  kind: row.kind,
  reason: row.reason,
  details: row.details,
  contact: row.contact,
  ...(row.login ? { login: row.login } : {}),
  status: row.status,
  createdAt: row.created_at,
});

/** `YYYY-MM-DD` in UTC: the only time resolution the install counts keep. */
export function dayOf(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class DirectoryStore {
  constructor(readonly db: Db) {
    db.migrate(migrations);
  }

  // ── Counts ───────────────────────────────────────────────────────────────────────────────────

  /** One more install of a bot today. Returns the bot's total. */
  countInstall(botId: string, day = dayOf()): number {
    this.db.run(
      `INSERT INTO installs (bot_id, day, n) VALUES (?, ?, 1)
       ON CONFLICT(bot_id, day) DO UPDATE SET n = n + 1`,
      [botId, day],
    );
    return this.installsOf(botId);
  }

  installsOf(botId: string): number {
    const row = this.db.get<{ total: number | null }>(
      "SELECT SUM(n) AS total FROM installs WHERE bot_id = ?",
      [botId],
    );
    return Number(row?.total ?? 0);
  }

  installsByBot(): Map<string, number> {
    const rows = this.db.all<{ bot_id: string; total: number }>(
      "SELECT bot_id, SUM(n) AS total FROM installs GROUP BY bot_id",
    );
    return new Map(rows.map((r) => [r.bot_id, Number(r.total)]));
  }

  /** Installs per day for one bot, newest first: what the privacy page says is kept. */
  installsPerDay(botId: string): { day: string; n: number }[] {
    return this.db.all<{ day: string; n: number }>(
      "SELECT day, n FROM installs WHERE bot_id = ? ORDER BY day DESC",
      [botId],
    );
  }

  /** Records "I use this" for one account. False when the account had already said so. */
  vote(botId: string, githubId: number, at = new Date().toISOString()): boolean {
    const result = this.db.run("INSERT OR IGNORE INTO used_votes (bot_id, github_id, at) VALUES (?, ?, ?)", [
      botId,
      githubId,
      at,
    ]);
    return result.changes > 0;
  }

  unvote(botId: string, githubId: number): boolean {
    return (
      this.db.run("DELETE FROM used_votes WHERE bot_id = ? AND github_id = ?", [botId, githubId]).changes > 0
    );
  }

  hasVoted(botId: string, githubId: number): boolean {
    return (
      this.db.get<{ n: number }>("SELECT 1 AS n FROM used_votes WHERE bot_id = ? AND github_id = ?", [
        botId,
        githubId,
      ]) !== undefined
    );
  }

  usedBy(botId: string): number {
    const row = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM used_votes WHERE bot_id = ?", [botId]);
    return Number(row?.n ?? 0);
  }

  usedByBot(): Map<string, number> {
    const rows = this.db.all<{ bot_id: string; n: number }>(
      "SELECT bot_id, COUNT(*) AS n FROM used_votes GROUP BY bot_id",
    );
    return new Map(rows.map((r) => [r.bot_id, Number(r.n)]));
  }

  /** Everything the directory counts, in the shape `buildIndex` reads from `counts.json`. */
  counts(): Record<string, { installs: number; usedBy: number }> {
    const out: Record<string, { installs: number; usedBy: number }> = {};
    for (const [id, installs] of this.installsByBot()) out[id] = { installs, usedBy: 0 };
    for (const [id, usedBy] of this.usedByBot()) out[id] = { installs: out[id]?.installs ?? 0, usedBy };
    return out;
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────────────────────

  createSession(user: SessionUser, now = new Date(), ttlMs = SESSION_TTL_MS): Session {
    const session: Session = {
      id: randomBytes(32).toString("base64url"),
      ...user,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.db.run(
      `INSERT INTO sessions (id, github_id, login, name, avatar_url, url, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.githubId,
        session.login,
        session.name ?? null,
        session.avatarUrl ?? null,
        session.url,
        session.createdAt,
        session.expiresAt,
      ],
    );
    return session;
  }

  /** The live session for a cookie, or nothing. An expired one is removed on the way. */
  session(id: string, now = new Date()): Session | undefined {
    if (!id) return undefined;
    const row = this.db.get<SessionRow>("SELECT * FROM sessions WHERE id = ?", [id]);
    if (!row) return undefined;
    if (row.expires_at <= now.toISOString()) {
      this.deleteSession(id);
      return undefined;
    }
    return toSession(row);
  }

  deleteSession(id: string): void {
    this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }

  sweepSessions(now = new Date()): number {
    return this.db.run("DELETE FROM sessions WHERE expires_at <= ?", [now.toISOString()]).changes;
  }

  // ── Submissions and claims ───────────────────────────────────────────────────────────────────

  addSubmission(
    input: Omit<Submission, "id" | "status" | "note" | "createdAt"> & { createdAt?: string },
  ): Submission {
    const submission: Submission = {
      ...input,
      id: randomUUID(),
      status: "pending",
      note: "",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db.run(
      `INSERT INTO submissions
         (id, bot_id, kind, pack_json, source_url, github_id, login, verified, owner_matches, warnings_json,
          status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?)`,
      [
        submission.id,
        submission.botId,
        submission.kind,
        toJson(submission.pack),
        submission.sourceUrl,
        submission.submitter.githubId ?? null,
        submission.submitter.login,
        submission.submitter.verified ? 1 : 0,
        submission.ownerMatches ? 1 : 0,
        toJson(submission.warnings),
        submission.createdAt,
      ],
    );
    return submission;
  }

  submission(id: string): Submission | undefined {
    const row = this.db.get<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [id]);
    return row ? toSubmission(row) : undefined;
  }

  submissions(filter: { status?: SubmissionStatus; githubId?: number; botId?: string } = {}): Submission[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.githubId !== undefined) {
      where.push("github_id = ?");
      params.push(filter.githubId);
    }
    if (filter.botId) {
      where.push("bot_id = ?");
      params.push(filter.botId);
    }
    const sql = `SELECT * FROM submissions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, rowid`;
    return this.db.all<SubmissionRow>(sql, params).map(toSubmission);
  }

  /** The newest approved submission for a bot: who owns the listing now. */
  approvedFor(botId: string): Submission | undefined {
    const row = this.db.get<SubmissionRow>(
      "SELECT * FROM submissions WHERE bot_id = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1",
      [botId],
    );
    return row ? toSubmission(row) : undefined;
  }

  decideSubmission(
    id: string,
    status: "approved" | "rejected",
    by: string,
    note = "",
    at = new Date().toISOString(),
  ): Submission | undefined {
    this.db.run(
      "UPDATE submissions SET status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      [status, by, note, at, id],
    );
    return this.submission(id);
  }

  // ── Reports and removal requests ─────────────────────────────────────────────────────────────

  addReport(input: Omit<Report, "id" | "status" | "createdAt"> & { createdAt?: string }): Report {
    const report: Report = {
      ...input,
      id: randomUUID(),
      status: "open",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db.run(
      `INSERT INTO reports (id, bot_id, kind, reason, details, contact, login, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        report.id,
        report.botId,
        report.kind,
        report.reason,
        report.details,
        report.contact,
        report.login ?? null,
        report.createdAt,
      ],
    );
    return report;
  }

  reports(status?: "open" | "closed"): Report[] {
    const rows = status
      ? this.db.all<ReportRow>("SELECT * FROM reports WHERE status = ? ORDER BY created_at, rowid", [status])
      : this.db.all<ReportRow>("SELECT * FROM reports ORDER BY created_at, rowid");
    return rows.map(toReport);
  }

  closeReport(id: string): boolean {
    return (
      this.db.run("UPDATE reports SET status = 'closed' WHERE id = ? AND status = 'open'", [id]).changes > 0
    );
  }
}
