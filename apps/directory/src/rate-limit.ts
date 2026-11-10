import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Env, MiddlewareHandler } from "hono";

/**
 * A sliding window per key, in memory. A key is the client address, and it is forgotten as soon as
 * its last hit leaves the window, which is all the privacy page promises about addresses. One
 * process, one map: a directory this size does not need more.
 */
export interface RateLimiterOptions {
  /** Hits allowed per key within the window. */
  limit: number;
  windowMs: number;
  now?: () => number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sinceSweep = 0;

  constructor(private readonly opts: RateLimiterOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** Records a hit. When refused, `retryAfterSec` says when the oldest hit leaves the window. */
  hit(key: string): { ok: boolean; remaining: number; retryAfterSec: number } {
    const now = this.now();
    const from = now - this.opts.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (++this.sinceSweep >= 1000) this.sweep();
    if (recent.length >= this.opts.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((oldest - from) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true, remaining: this.opts.limit - recent.length, retryAfterSec: 0 };
  }

  /** Forgets every key whose hits have all left the window. */
  sweep(): void {
    this.sinceSweep = 0;
    const from = this.now() - this.opts.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > from)) this.hits.delete(key);
    }
  }

  /** How many addresses are remembered right now. */
  get size(): number {
    return this.hits.size;
  }
}

/** An address as a proxy writes it, without a port or brackets, or undefined when it is not one. */
function plainAddress(entry: string | undefined): string | undefined {
  let a = entry?.trim() ?? "";
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
  if (bracketed) a = bracketed[1] ?? "";
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(":"));
  return isIP(a) ? a : undefined;
}

/**
 * The client's address. Behind `hops` proxies you run, it is that many entries from the right of
 * `X-Forwarded-For`: nginx, Fly and most load balancers append the address they saw to whatever the
 * visitor sent, so the left of the header is the visitor's own writing and never trusted. When the
 * entry is not an address, the socket's address is used.
 */
export function clientAddress<E extends Env>(c: Context<E>, hops: number): string {
  if (hops > 0) {
    const entries = (c.req.header("x-forwarded-for") ?? "").split(",").filter((e) => e.trim());
    // A visitor can only make the list longer, never shorter, so a short list is all from proxies.
    const chosen = plainAddress(entries[Math.max(0, entries.length - hops)]);
    if (chosen) return chosen;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // In-process requests (tests) have no socket.
    return "local";
  }
}

export function rateLimit<E extends Env = Env>(limiter: RateLimiter, hops: number): MiddlewareHandler<E> {
  return async (c, next) => {
    const verdict = limiter.hit(clientAddress(c, hops));
    if (!verdict.ok) {
      c.header("Retry-After", String(verdict.retryAfterSec));
      return c.json(
        { error: `Too many requests from this address. Try again in ${verdict.retryAfterSec}s.` },
        429,
      );
    }
    await next();
  };
}
