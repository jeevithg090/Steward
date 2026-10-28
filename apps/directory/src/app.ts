import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Db } from "@steward/db";
import { Hono, type Context as HonoContext, type MiddlewareHandler as HonoMiddleware } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { Catalogue, MAX_LIMIT, type SortKey } from "./catalogue.ts";
import { type DirectoryConfig, publicInfo } from "./config.ts";
import { GitHub, GitHubError } from "./github.ts";
import { mcpRequestHandler, UNTRUSTED, VIA } from "./mcp.ts";
import { clientAddress, RateLimiter, rateLimit } from "./rate-limit.ts";
import { RetirementTask } from "./retirement.ts";
import {
  adminPage,
  browsePage,
  feedXml,
  homePage,
  listingPage,
  llmsTxt,
  messagePage,
  privacyPage,
  type SiteContext,
  submitPage,
} from "./site.ts";
import { DirectoryStore, type Session, type Submission } from "./store.ts";
import { type PackReader, Submissions, submissionProblem } from "./submissions.ts";

export { Catalogue } from "./catalogue.ts";
export { type DirectoryConfig, describeConfig, loadConfig, publicInfo } from "./config.ts";
export { GitHub, parsePackUrl } from "./github.ts";
export { createMcpServer, UNTRUSTED, VIA } from "./mcp.ts";
export { RetirementTask } from "./retirement.ts";
export { DirectoryStore } from "./store.ts";
export { Submissions } from "./submissions.ts";

/**
 * The directory server (plan §3.2): one Hono process that publishes `index.json`, the packs, a
 * browse site, RSS and `llms.txt`, and adds search, the MCP connector, install and "I use this"
 * counts, GitHub sign-in, submissions, claims, reports and a review page. Everything a Steward
 * needs is a GET with CORS open; everything that changes state is rate limited per address.
 */

/** `signedIn` marks a response that used the sign-in cookie, so it never gets open CORS. */
export type Env = { Variables: { signedIn?: boolean } };

export const SESSION_COOKIE = "sd_session";
const STATE_COOKIE = "sd_oauth";

export interface RateLimits {
  /** Pages, the API and MCP: per address per minute. */
  perMinute: number;
  /** One install of a bot counts once per address per hour. */
  installWindowMs: number;
  /** Submissions, claims and reports: per address per hour. */
  writesPerHour: number;
}

export const DEFAULT_LIMITS: RateLimits = { perMinute: 120, installWindowMs: 60 * 60_000, writesPerHour: 20 };

export interface DirectoryDeps {
  /** The GitHub client; built from the config when left out. */
  github?: GitHub;
  /** What reads submitted packs; the GitHub client when left out. */
  packReader?: PackReader;
  limits?: Partial<RateLimits>;
  now?: () => Date;
}

export interface DirectoryServer {
  app: Hono<Env>;
  config: DirectoryConfig;
  catalogue: Catalogue;
  store: DirectoryStore;
  submissions: Submissions;
  retirement: RetirementTask;
  listen(opts?: { port?: number; host?: string }): Promise<{ url: string; port: number }>;
  close(): Promise<void>;
}

/**
 * No scripts anywhere; styles inline; never framed. Forms post only here, plus GitHub, because
 * browsers apply `form-action` to the redirect a sign-in form post ends in.
 */
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'";

const BODY_LIMIT = 64 * 1024;
const MCP_BODY_LIMIT = 256 * 1024;

const DayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const BotIdParam = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
  .max(64);

const SearchParams = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(40).optional(),
  needs: z.string().max(200).optional(),
  sort: z.enum(["match", "new", "used", "installs"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

const ReportBody = z.object({
  reason: z.string().trim().min(1).max(200),
  details: z.string().max(2000).optional(),
});
const RemovalBody = z.object({
  reason: z.string().trim().min(1).max(2000),
  contact: z.string().max(200).optional(),
});
const SubmitBody = z.object({
  url: z.string().trim().min(8).max(2048),
  confirmItsMine: z.literal(true, {
    errorMap: () => ({ message: "Confirm the pack is yours before submitting it." }),
  }),
});
const ClaimBody = z.object({
  confirmItsMine: z.literal(true, {
    errorMap: () => ({ message: "Confirm the bot is yours before claiming it." }),
  }),
});
const DecisionBody = z.object({ note: z.string().max(500).optional() });

class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Context = HonoContext<Env>;
type MiddlewareHandler = HonoMiddleware<Env>;

const isApi = (path: string) => path.startsWith("/api/") || path === "/mcp";

function needsList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

/** Copies the seed folder into the directory folder on first start, so a volume starts full. */
export async function seedDirectory(config: DirectoryConfig): Promise<boolean> {
  if (!config.seedDir) return false;
  if (existsSync(join(config.directoryDir, "index.json"))) return false;
  if (resolve(config.seedDir) === resolve(config.directoryDir)) return false;
  await cp(config.seedDir, config.directoryDir, { recursive: true });
  return true;
}

export async function createDirectoryApp(
  config: DirectoryConfig,
  deps: DirectoryDeps = {},
): Promise<DirectoryServer> {
  await seedDirectory(config);
  const now = deps.now ?? (() => new Date());
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const db = new Db(config.dbPath);
  const store = new DirectoryStore(db);
  const catalogue = new Catalogue({
    dir: config.directoryDir,
    store,
    site: config.siteUrl,
    name: config.name,
  });
  await catalogue.load();
  const github =
    deps.github ??
    new GitHub(config.github, { ...(config.github?.token ? { token: config.github.token } : {}) });
  const submissions = new Submissions({ store, catalogue, github: deps.packReader ?? github, now });
  const retirement = new RetirementTask({
    settings: config.retirement,
    catalogue,
    store,
    dataDir: config.dataDir,
  });

  const secure = config.siteUrl.startsWith("https://");
  const siteOrigin = new URL(config.siteUrl).origin;
  const callbackUrl = `${config.siteUrl}/auth/github/callback`;

  const general = new RateLimiter({ limit: limits.perMinute, windowMs: 60_000 });
  const installs = new RateLimiter({ limit: 1, windowMs: limits.installWindowMs });
  const writes = new RateLimiter({ limit: limits.writesPerHour, windowMs: 60 * 60_000 });
  const mcpSubmits = new RateLimiter({
    limit: Math.max(1, Math.floor(limits.writesPerHour / 2)),
    windowMs: 60 * 60_000,
  });
  const handleMcp = mcpRequestHandler({
    catalogue,
    submissions,
    siteUrl: config.siteUrl,
    submitLimiter: mcpSubmits,
  });

  const app = new Hono<Env>();
  const address = (c: Context) => clientAddress(c, config.trustProxy);
  const userOf = (c: Context): Session | undefined =>
    store.session(getCookie(c, SESSION_COOKIE) ?? "", now());
  const isAdmin = (user: Session | undefined) =>
    user !== undefined && config.adminLogins.includes(user.login.toLowerCase());
  const site = (c: Context): SiteContext => {
    const user = userOf(c);
    return { config, catalogue, ...(user ? { user } : {}) };
  };

  // ── Every response ────────────────────────────────────────────────────────────────────────────

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!c.res.headers.has("Content-Security-Policy")) c.res.headers.set("Content-Security-Policy", CSP);
    if ((c.res.headers.get("content-type") ?? "").startsWith("text/html"))
      c.res.headers.set("X-Frame-Options", "DENY");
  });

  // Anyone may read the directory from anywhere: Steward servers, other agents, other sites.
  const openCors: MiddlewareHandler = async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
          "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
          "Access-Control-Max-Age": "600",
        },
      });
    }
    await next();
    // Only routes that need no cookie are open; signed-in routes stay same-origin.
    if (!c.get("signedIn")) {
      c.res.headers.set("Access-Control-Allow-Origin", "*");
      c.res.headers.set("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
    }
  };
  for (const path of ["/index.json", "/packs/*", "/feed.xml", "/llms.txt", "/api/*", "/mcp"])
    app.use(path, openCors);

  app.use("*", rateLimit(general, config.trustProxy));

  /**
   * A state-changing request that relies on the sign-in cookie must come from this site: browsers
   * send `Origin` on cross-site POSTs, and the cookie is `SameSite=Lax` as a second lock.
   */
  const sameSite: MiddlewareHandler = async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
    const origin = c.req.header("origin");
    if (origin && origin !== "null" && origin !== siteOrigin) {
      try {
        if (new URL(origin).host !== (c.req.header("host") ?? new URL(c.req.url).host))
          throw new Error("other");
      } catch {
        throw new ApiError(403, "Requests from other sites are refused.");
      }
    } else if (origin === "null" || c.req.header("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "Requests from other sites are refused.");
    }
    await next();
  };

  const limitBody = (max: number) =>
    bodyLimit({ maxSize: max, onError: (c) => c.json({ error: "That request is too large." }, 413) });

  const writeLimit: MiddlewareHandler = async (c, next) => {
    const verdict = writes.hit(address(c));
    if (!verdict.ok) {
      c.header("Retry-After", String(verdict.retryAfterSec));
      throw new ApiError(429, `Too many requests from this address. Try again in ${verdict.retryAfterSec}s.`);
    }
    await next();
  };

  const requireUser = (c: Context): Session => {
    const user = userOf(c);
    if (!user)
      throw new ApiError(401, "Sign in with GitHub first.", { signIn: `${config.siteUrl}/auth/github` });
    c.set("signedIn", true);
    return user;
  };

  const requireAdmin = (c: Context): Session => {
    const user = requireUser(c);
    if (!isAdmin(user)) throw new ApiError(403, "Only this directory's reviewers can do that.");
    return user;
  };

  async function readJson<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
    const text = await c.req.text();
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new ApiError(400, "That request body is not valid JSON.");
      }
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(
        400,
        `${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "not valid"}`,
      );
    }
    return parsed.data;
  }

  async function readForm(c: Context): Promise<Record<string, string>> {
    const body = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  }

  const botIdOf = (c: Context): string => {
    const id = c.req.param("id") ?? "";
    const retired = catalogue.retired.get(id);
    if (retired && !catalogue.listing(id)) {
      throw new ApiError(
        410,
        `"${id}" was retired on ${retired.retiredAt.slice(0, 10)}: nobody installed it.`,
        { retired },
      );
    }
    if (!BotIdParam.safeParse(id).success || !catalogue.listing(id)) {
      throw new ApiError(404, `There is no bot "${id.slice(0, 64)}" in the directory.`);
    }
    return id;
  };

  const htmlPage = (c: Context, html: string, status: ContentfulStatusCode = 200) =>
    c.html(html, status, { "Cache-Control": "no-cache" });

  // ── Files Steward and other tools read ────────────────────────────────────────────────────────

  app.get("/index.json", (c) => c.json(catalogue.index(), 200, { "Cache-Control": "public, max-age=60" }));
  app.get("/api/bots.json", (c) => c.json(catalogue.index(), 200, { "Cache-Control": "public, max-age=60" }));

  app.get("/packs/:file", async (c) => {
    const file = c.req.param("file");
    const id = file.endsWith(".json") ? file.slice(0, -5) : "";
    if (!BotIdParam.safeParse(id).success || !catalogue.listing(id)) {
      throw new ApiError(404, `There is no pack "${file.slice(0, 80)}".`);
    }
    const path = join(catalogue.dir, "packs", `${id}.json`);
    // The file as built, byte for byte: its hash is what Steward checks before installing.
    const body = existsSync(path) ? await readFile(path, "utf8") : JSON.stringify(catalogue.pack(id));
    return c.body(body, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
  });

  app.get("/feed.xml", (c) =>
    c.body(feedXml(site(c)), 200, {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    }),
  );
  app.get("/llms.txt", (c) =>
    c.body(llmsTxt(site(c)), 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    }),
  );
  app.get("/robots.txt", (c) =>
    c.text(`User-agent: *\nDisallow: /admin\nDisallow: /auth/\nSitemap: ${config.siteUrl}/feed.xml\n`),
  );

  // ── The JSON API ──────────────────────────────────────────────────────────────────────────────

  app.get("/api/info", (c) => c.json({ ...publicInfo(config), bots: catalogue.size, via: VIA }));

  app.get("/api/bots", (c) => {
    const parsed = SearchParams.safeParse(c.req.query());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(
        400,
        `${issue?.path.join(".") ?? "query"}: ${issue?.message ?? "could not be read"}`,
      );
    }
    const q = parsed.data;
    if (q.category && !catalogue.categories[q.category]) {
      throw new ApiError(
        400,
        `category: "${q.category}" is not one of ${Object.keys(catalogue.categories).join(", ")}`,
      );
    }
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    const found = catalogue.search({
      ...(q.q ? { q: q.q } : {}),
      ...(q.category ? { category: q.category } : {}),
      needs: needsList(q.needs),
      sort: (q.sort ?? "match") as SortKey,
      limit,
      offset,
    });
    return c.json({ ...found, limit, offset, categories: catalogue.categories, via: VIA, note: UNTRUSTED });
  });

  app.get("/api/categories", (c) => c.json({ categories: catalogue.categoryCounts(), via: VIA }));

  // Retired bots, so a fork or a generator can avoid making them again.
  app.get("/api/retired", (c) => c.json({ retired: [...catalogue.retired.values()], via: VIA }));

  app.get("/api/bots/:id", (c) => {
    const id = botIdOf(c);
    return c.json({
      bot: { ...catalogue.listing(id), packUrl: catalogue.packUrlOf(id) },
      pack: catalogue.pack(id),
      via: VIA,
      note: UNTRUSTED,
    });
  });

  // Sent by Steward on install, with no identity. Counted once per address per bot per hour, so a
  // reinstall loop does not inflate the shelf; the address is forgotten when the hour is up.
  app.post("/api/bots/:id/installed", limitBody(1024), (c) => {
    const id = botIdOf(c);
    const day = c.req.query("day");
    if (day !== undefined && !DayParam.safeParse(day).success)
      throw new ApiError(400, "day: use YYYY-MM-DD.");
    const verdict = installs.hit(`${address(c)}\u0000${id}`);
    const total = verdict.ok ? catalogue.installed(id) : catalogue.listing(id)?.installs;
    return c.json({ id, installs: total ?? 0, counted: verdict.ok });
  });

  app.post("/api/bots/:id/used", sameSite, limitBody(1024), (c) => {
    const user = requireUser(c);
    const id = botIdOf(c);
    const result = catalogue.used(id, user.githubId)!;
    return c.json({ id, usedBy: result.usedBy, added: result.added });
  });

  app.delete("/api/bots/:id/used", sameSite, (c) => {
    const user = requireUser(c);
    const id = botIdOf(c);
    const result = catalogue.unused(id, user.githubId)!;
    return c.json({ id, usedBy: result.usedBy, removed: result.removed });
  });

  app.post("/api/bots/:id/report", sameSite, writeLimit, limitBody(BODY_LIMIT), async (c) => {
    const id = botIdOf(c);
    const body = await readJson(c, ReportBody);
    const user = userOf(c);
    const report = store.addReport({
      botId: id,
      kind: "report",
      reason: body.reason,
      details: body.details ?? "",
      contact: "",
      ...(user ? { login: user.login } : {}),
      createdAt: now().toISOString(),
    });
    return c.json(
      { id: report.id, recorded: true, note: "Recorded for a reviewer. Nothing was emailed." },
      201,
    );
  });

  app.post("/api/bots/:id/removal-request", sameSite, writeLimit, limitBody(BODY_LIMIT), async (c) => {
    const id = botIdOf(c);
    const body = await readJson(c, RemovalBody);
    const user = userOf(c);
    const report = store.addReport({
      botId: id,
      kind: "removal",
      reason: body.reason,
      details: "",
      contact: body.contact ?? "",
      ...(user ? { login: user.login } : {}),
      createdAt: now().toISOString(),
    });
    return c.json(
      { id: report.id, recorded: true, note: "Recorded for a reviewer. Nothing was emailed." },
      201,
    );
  });

  app.post("/api/submissions", sameSite, writeLimit, limitBody(BODY_LIMIT), async (c) => {
    const user = requireUser(c);
    const body = await readJson(c, SubmitBody);
    const submission = await submissions.submit({
      url: body.url,
      confirmItsMine: body.confirmItsMine,
      submitter: { githubId: user.githubId, login: user.login, verified: true },
    });
    return c.json({ submission: publicSubmission(submission) }, 201);
  });

  app.get("/api/submissions/mine", (c) => {
    const user = requireUser(c);
    return c.json({ submissions: submissions.mine(user.githubId).map(publicSubmission) });
  });

  app.post("/api/bots/:id/claim", sameSite, writeLimit, limitBody(BODY_LIMIT), async (c) => {
    const user = requireUser(c);
    const id = botIdOf(c);
    const body = await readJson(c, ClaimBody);
    const submission = await submissions.claim({
      botId: id,
      confirmItsMine: body.confirmItsMine,
      submitter: { githubId: user.githubId, login: user.login, verified: true },
    });
    return c.json({ submission: publicSubmission(submission) }, 201);
  });

  app.get("/api/admin/submissions", (c) => {
    requireAdmin(c);
    return c.json({ submissions: submissions.pending(), reports: store.reports("open") });
  });

  app.post("/api/admin/retire", sameSite, limitBody(1024), async (c) => {
    requireAdmin(c);
    return c.json({ run: await retirement.run(now()) });
  });

  app.post("/api/admin/submissions/:sid/approve", sameSite, limitBody(BODY_LIMIT), async (c) => {
    const admin = requireAdmin(c);
    const body = await readJson(c, DecisionBody);
    const submission = await submissions.approve(c.req.param("sid"), admin.login, body.note ?? "");
    return c.json({ submission: publicSubmission(submission), listing: catalogue.listing(submission.botId) });
  });

  app.post("/api/admin/submissions/:sid/reject", sameSite, limitBody(BODY_LIMIT), async (c) => {
    const admin = requireAdmin(c);
    const body = await readJson(c, DecisionBody);
    const submission = await submissions.reject(c.req.param("sid"), admin.login, body.note ?? "");
    return c.json({ submission: publicSubmission(submission) });
  });

  // ── MCP ───────────────────────────────────────────────────────────────────────────────────────

  app.on(["GET", "POST", "DELETE"], "/mcp", limitBody(MCP_BODY_LIMIT), (c) =>
    handleMcp(c.req.raw, { address: address(c) }),
  );

  // ── GitHub sign-in ────────────────────────────────────────────────────────────────────────────

  const safeNext = (next: string | undefined) =>
    next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next.slice(0, 300) : "/submit";

  app.get("/auth/github", (c) => {
    if (!github.signInEnabled) {
      return htmlPage(
        c,
        messagePage(site(c), "Sign-in is off", "This directory has no GitHub sign-in set up.", 404),
        404,
      );
    }
    const state = randomBytes(24).toString("base64url");
    const next = safeNext(c.req.query("next"));
    setCookie(c, STATE_COOKIE, `${state}.${encodeURIComponent(next)}`, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/auth/github",
      maxAge: 600,
    });
    return c.redirect(github.authorizeUrl(state, callbackUrl), 302);
  });

  app.get("/auth/github/callback", async (c) => {
    const saved = getCookie(c, STATE_COOKIE) ?? "";
    deleteCookie(c, STATE_COOKIE, { path: "/auth/github" });
    const [state, nextRaw] = saved.split(".");
    const given = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    const matches =
      Boolean(state) &&
      given.length === state!.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(state!));
    if (!matches || !code) {
      return htmlPage(
        c,
        messagePage(
          site(c),
          "Sign-in did not finish",
          "The sign-in link was old or came from somewhere else. Start again from the directory.",
          400,
        ),
        400,
      );
    }
    try {
      const token = await github.exchangeCode(code, callbackUrl);
      // The token reads the public profile once and is then dropped; nothing keeps it.
      const user = await github.user(token);
      const session = store.createSession(user, now());
      setCookie(c, SESSION_COOKIE, session.id, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: Math.floor((Date.parse(session.expiresAt) - now().getTime()) / 1000),
      });
      return c.redirect(safeNext(nextRaw ? decodeURIComponent(nextRaw) : undefined), 303);
    } catch (error) {
      const message =
        error instanceof GitHubError ? error.message : "GitHub could not be reached. Try again.";
      return htmlPage(c, messagePage(site(c), "Sign-in did not finish", message, 502), 502);
    }
  });

  app.post("/auth/logout", sameSite, (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) store.deleteSession(id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/", 303);
  });

  // ── The browse site ───────────────────────────────────────────────────────────────────────────

  app.get("/", (c) => htmlPage(c, homePage(site(c))));

  app.get("/bots", (c) => {
    const q = c.req.query();
    const sort = (["match", "new", "used", "installs"] as const).find((s) => s === q.sort) ?? "match";
    return htmlPage(
      c,
      browsePage(site(c), {
        ...(q.q ? { q: q.q.slice(0, 200) } : {}),
        ...(q.category ? { category: q.category } : {}),
        sort,
        needs: needsList(q.needs),
        page: Number(q.page) || 1,
      }),
    );
  });

  const MESSAGES: Record<string, string> = {
    used: "Thanks: recorded that you use this bot.",
    unused: "Done: you no longer say you use this bot.",
    reported: "Thanks: your report was recorded for a reviewer. Nothing was emailed.",
    removal: "Your removal request was recorded for a reviewer. Nothing was emailed.",
    claimed: "Your claim was recorded. A reviewer will check it.",
  };

  app.get("/bots/:id", (c) => {
    const id = c.req.param("id");
    const listing = BotIdParam.safeParse(id).success ? catalogue.listing(id) : undefined;
    const pack = listing ? catalogue.pack(id) : undefined;
    const retired = !listing ? catalogue.retired.get(id) : undefined;
    if (retired) {
      return htmlPage(
        c,
        messagePage(
          site(c),
          `${retired.name} was retired`,
          `${retired.name} was an AI-made bot. It was retired on ${retired.retiredAt.slice(0, 10)} because nobody installed it or said they use it in its first ${config.retirement.days || 90} days. A copy you already added keeps working.`,
          410,
        ),
        410,
      );
    }
    if (!listing || !pack) {
      return htmlPage(c, messagePage(site(c), "No such bot", "That bot is not in the directory.", 404), 404);
    }
    const ctx = site(c);
    const message = MESSAGES[c.req.query("m") ?? ""];
    return htmlPage(
      c,
      listingPage(ctx, listing, pack, {
        voted: ctx.user ? store.hasVoted(id, ctx.user.githubId) : false,
        ...(message ? { message } : {}),
      }),
    );
  });

  const formRoute = (
    path: string,
    handler: (c: Context, id: string, form: Record<string, string>) => Promise<string> | string,
    extra: MiddlewareHandler[] = [],
  ) =>
    app.post(path, sameSite, ...extra, limitBody(BODY_LIMIT), async (c) => {
      const id = botIdOf(c);
      const message = await handler(c, id, await readForm(c));
      return c.redirect(`/bots/${id}?m=${message}#main`, 303);
    });

  formRoute("/bots/:id/used", (c, id) => {
    const user = userOf(c);
    if (!user) return Promise.reject(new ApiError(401, "Sign in with GitHub first."));
    catalogue.used(id, user.githubId);
    return "used";
  });
  formRoute("/bots/:id/unused", (c, id) => {
    const user = userOf(c);
    if (!user) return Promise.reject(new ApiError(401, "Sign in with GitHub first."));
    catalogue.unused(id, user.githubId);
    return "unused";
  });
  formRoute(
    "/bots/:id/report",
    (c, id, form) => {
      const parsed = ReportBody.safeParse(form);
      if (!parsed.success) throw new ApiError(400, "Say why you are reporting this bot.");
      const user = userOf(c);
      store.addReport({
        botId: id,
        kind: "report",
        reason: parsed.data.reason,
        details: parsed.data.details ?? "",
        contact: "",
        ...(user ? { login: user.login } : {}),
        createdAt: now().toISOString(),
      });
      return "reported";
    },
    [writeLimit],
  );
  formRoute(
    "/bots/:id/removal-request",
    (c, id, form) => {
      const parsed = RemovalBody.safeParse(form);
      if (!parsed.success) throw new ApiError(400, "Say why the listing should be removed.");
      const user = userOf(c);
      store.addReport({
        botId: id,
        kind: "removal",
        reason: parsed.data.reason,
        details: "",
        contact: parsed.data.contact ?? "",
        ...(user ? { login: user.login } : {}),
        createdAt: now().toISOString(),
      });
      return "removal";
    },
    [writeLimit],
  );
  formRoute(
    "/bots/:id/claim",
    async (c, id, form) => {
      const user = userOf(c);
      if (!user) throw new ApiError(401, "Sign in with GitHub to claim a bot.");
      await submissions.claim({
        botId: id,
        confirmItsMine: form.confirm === "1",
        submitter: { githubId: user.githubId, login: user.login, verified: true },
      });
      return "claimed";
    },
    [writeLimit],
  );

  app.get("/submit", (c) => {
    const ctx = site(c);
    return htmlPage(c, submitPage(ctx, ctx.user ? { mine: submissions.mine(ctx.user.githubId) } : {}));
  });

  app.post("/submit", sameSite, writeLimit, limitBody(BODY_LIMIT), async (c) => {
    const ctx = site(c);
    if (!ctx.user) return c.redirect("/auth/github?next=%2Fsubmit", 303);
    const form = await readForm(c);
    const url = (form.url ?? "").trim();
    try {
      const submission = await submissions.submit({
        url,
        confirmItsMine: form.confirm === "1",
        submitter: { githubId: ctx.user.githubId, login: ctx.user.login, verified: true },
      });
      return htmlPage(
        c,
        submitPage(ctx, {
          message: `Thanks. "${submission.pack.name}" is waiting for a reviewer.`,
          mine: submissions.mine(ctx.user.githubId),
        }),
        201,
      );
    } catch (error) {
      const problem = submissionProblem(error);
      if (!problem) throw error;
      return htmlPage(
        c,
        submitPage(ctx, {
          message: problem.problems.length
            ? "The pack was refused. Fix these and submit again:"
            : problem.message,
          error: true,
          problems: problem.problems.map((p) => `${p.path}: ${p.message}`),
          url,
          mine: submissions.mine(ctx.user.githubId),
        }),
        problem.status as ContentfulStatusCode,
      );
    }
  });

  app.get("/privacy", (c) => htmlPage(c, privacyPage(site(c))));

  app.get("/admin", (c) => {
    const ctx = site(c);
    if (!ctx.user) return c.redirect("/auth/github?next=%2Fadmin", 303);
    if (!isAdmin(ctx.user)) {
      return htmlPage(
        c,
        messagePage(ctx, "Reviewers only", "Only this directory's reviewers can open this page.", 403),
        403,
      );
    }
    const message = c.req.query("m");
    return htmlPage(
      c,
      adminPage(ctx, {
        pending: submissions.pending(),
        reports: store.reports("open"),
        retirement: { settings: config.retirement, last: store.lastRetirement() },
        ...(message === "approved"
          ? { message: "Approved and listed." }
          : message === "rejected"
            ? { message: "Rejected." }
            : message === "closed"
              ? { message: "Report closed." }
              : {}),
      }),
    );
  });

  app.post("/admin/submissions/:sid/approve", sameSite, limitBody(BODY_LIMIT), async (c) => {
    const admin = requireAdmin(c);
    const form = await readForm(c);
    await submissions.approve(c.req.param("sid"), admin.login, (form.note ?? "").slice(0, 500));
    return c.redirect("/admin?m=approved", 303);
  });
  app.post("/admin/submissions/:sid/reject", sameSite, limitBody(BODY_LIMIT), async (c) => {
    const admin = requireAdmin(c);
    const form = await readForm(c);
    await submissions.reject(c.req.param("sid"), admin.login, (form.note ?? "").slice(0, 500));
    return c.redirect("/admin?m=rejected", 303);
  });
  app.post("/admin/reports/:rid/close", sameSite, limitBody(BODY_LIMIT), (c) => {
    requireAdmin(c);
    store.closeReport(c.req.param("rid"));
    return c.redirect("/admin?m=closed", 303);
  });

  // ── Errors ────────────────────────────────────────────────────────────────────────────────────

  app.notFound((c) =>
    isApi(c.req.path)
      ? c.json({ error: "There is nothing at that address." }, 404)
      : htmlPage(c, messagePage(site(c), "Not found", "There is nothing at that address.", 404), 404),
  );

  app.onError((err, c) => {
    let status: ContentfulStatusCode = 500;
    let message = "Something went wrong on the directory's side. Try again.";
    let extra: Record<string, unknown> = {};
    const problem = submissionProblem(err);
    if (err instanceof ApiError) {
      status = err.status;
      message = err.message;
      extra = err.extra;
    } else if (problem) {
      status = problem.status as ContentfulStatusCode;
      message = problem.message;
      if (problem.problems.length) extra = { problems: problem.problems };
    } else if (err instanceof HTTPException) {
      status = err.status as ContentfulStatusCode;
      message = status === 413 ? "That request is too large." : "That request could not be read.";
    } else {
      console.error(
        `[directory] ${c.req.method} ${c.req.path} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (isApi(c.req.path)) return c.json({ error: message, ...extra }, status);
    return htmlPage(
      c,
      messagePage(site(c), status === 401 ? "Sign in first" : "That did not work", message, status),
      status,
    );
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────

  let server: ReturnType<typeof serve> | undefined;
  const sweep = setInterval(() => {
    store.sweepSessions(now());
    general.sweep();
    installs.sweep();
    writes.sweep();
    mcpSubmits.sweep();
  }, 10 * 60_000);
  sweep.unref();

  return {
    app,
    config,
    catalogue,
    store,
    submissions,
    retirement,
    listen(opts = {}) {
      return new Promise((resolveListen, reject) => {
        const host = opts.host ?? config.host;
        try {
          retirement.start();
          server = serve({ fetch: app.fetch, port: opts.port ?? config.port, hostname: host }, (info) => {
            const shown = host.includes(":") ? `[${host}]` : host;
            resolveListen({
              url: `http://${shown === "0.0.0.0" ? "127.0.0.1" : shown}:${info.port}`,
              port: info.port,
            });
          });
          server.on("error", reject);
        } catch (error) {
          reject(error);
        }
      });
    },
    async close() {
      clearInterval(sweep);
      retirement.stop();
      if (server) await new Promise<void>((done) => server!.close(() => done()));
      catalogue.close();
      db.close();
    },
  };
}

/** A submission as its submitter sees it: no GitHub id, the pack summarised. */
function publicSubmission(s: Submission) {
  return {
    id: s.id,
    botId: s.botId,
    kind: s.kind,
    name: s.pack.name,
    version: s.pack.version,
    sourceUrl: s.sourceUrl,
    login: s.submitter.login,
    verified: s.submitter.verified,
    status: s.status,
    note: s.note,
    warnings: s.warnings,
    createdAt: s.createdAt,
    ...(s.decidedAt ? { decidedAt: s.decidedAt } : {}),
  };
}
