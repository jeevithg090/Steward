import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { isLoopbackHost } from "../config.ts";

/**
 * Steward has no sign-in: it is one person's assistant on one machine. These guards keep it that
 * way. They refuse
 * - requests addressed to a host name that is not this machine (DNS rebinding),
 * - state-changing requests sent by another site's page (cross-site request forgery),
 * - WebSocket upgrades from another site's page (browsers do not apply CORS to WebSockets),
 * - bodies that are not JSON on the REST API, and bodies that are too large.
 */
export interface SecurityOptions {
  /** The address the server is bound to. A specific non-loopback address is accepted as a Host. */
  bindHost: string;
  /** Extra Host names accepted (`STEWARD_ALLOWED_HOSTS`). */
  allowedHosts: string[];
  /** Origins allowed to call the API from another origin (the Vite dev and preview servers). */
  devOrigins: string[];
}

const WILDCARD_BINDS = new Set(["0.0.0.0", "::", "[::]", ""]);

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const colon = h.lastIndexOf(":");
  return colon > -1 && h.indexOf(":") === colon ? h.slice(0, colon) : h;
}

/** The Host the request was addressed to, falling back to the URL for in-process requests. */
export function requestHost(c: Context): string {
  return c.req.header("host") ?? new URL(c.req.url).host;
}

export function isAllowedHost(hostHeader: string, opts: SecurityOptions): boolean {
  const hostname = hostnameOf(hostHeader);
  if (isLoopbackHost(hostname)) return true;
  if (opts.allowedHosts.includes(hostname)) return true;
  const bind = opts.bindHost.toLowerCase();
  return !WILDCARD_BINDS.has(bind) && hostnameOf(bind) === hostname;
}

/** Same origin as the Host the request reached, or one of the dev origins. */
export function isAllowedOrigin(origin: string, hostHeader: string, opts: SecurityOptions): boolean {
  if (opts.devOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}

export function hostGuard(opts: SecurityOptions): MiddlewareHandler {
  return async (c, next) => {
    if (!isAllowedHost(requestHost(c), opts)) {
      return c.json({ error: "Steward only answers on this machine's own address." }, 403);
    }
    await next();
  };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** HTTP/1.1 frames every body with Content-Length or Transfer-Encoding; without either there is none. */
function hasBody(c: Context): boolean {
  const length = c.req.header("content-length");
  if (length !== undefined) return Number(length) > 0;
  return c.req.header("transfer-encoding") !== undefined;
}

/**
 * Refuses state-changing requests from other sites. Browsers send `Origin` on every cross-origin
 * POST (and `Sec-Fetch-Site`), so a page elsewhere cannot act through the person's own browser.
 * Requests without either header come from programs, not pages, and are allowed.
 */
export function originGuard(opts: SecurityOptions, requireJson = true): MiddlewareHandler {
  return async (c, next) => {
    if (!MUTATING.has(c.req.method)) return next();
    const origin = c.req.header("origin");
    if (origin && origin !== "null") {
      if (!isAllowedOrigin(origin, requestHost(c), opts)) {
        return c.json({ error: "Requests from other sites are refused." }, 403);
      }
    } else if (origin === "null" || c.req.header("sec-fetch-site") === "cross-site") {
      return c.json({ error: "Requests from other sites are refused." }, 403);
    }
    if (requireJson && hasBody(c)) {
      const type = c.req.header("content-type") ?? "";
      if (!type.toLowerCase().includes("application/json")) {
        return c.json({ error: "Send the request body as JSON." }, 415);
      }
    }
    await next();
  };
}

/** WebSocket upgrades: same origin or a dev origin only. A missing Origin means a program, not a page. */
export function isAllowedUpgrade(c: Context, opts: SecurityOptions): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true;
  return isAllowedOrigin(origin, requestHost(c), opts);
}

/** CORS for the Vite dev and preview servers only. Production serves the web app from the same origin. */
export function devCors(opts: SecurityOptions): MiddlewareHandler {
  if (opts.devOrigins.length === 0) return async (_c, next) => next();
  return cors({
    origin: opts.devOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
}

/**
 * Images load only from this server, `data:` and `blob:` (the live screen draws its JPEG frames from
 * data). An image in a reply that points elsewhere would otherwise send whatever its address carries
 * out of the machine with no tool call, past the gateway.
 */
export const CONTENT_SECURITY_POLICY = "frame-ancestors 'none'; img-src 'self' data: blob:";

/** Headers every response carries: no sniffing, no referrer, never framed (approval cards must not be clickjacked). */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("X-Frame-Options", "DENY");
    if (!c.res.headers.has("Content-Security-Policy")) {
      c.res.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    }
  };
}

export const BODY_LIMITS = {
  /** Conversations travel whole on every run. */
  agent: 10 * 1024 * 1024,
  api: 256 * 1024,
  demo: 1024 * 1024,
} as const;

export function limitBody(maxSize: number): MiddlewareHandler {
  return bodyLimit({
    maxSize,
    onError: (c) => c.json({ error: "That request is too large." }, 413),
  });
}
