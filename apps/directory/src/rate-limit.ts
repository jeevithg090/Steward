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

/** The client's address: the socket's, or the first `X-Forwarded-For` entry behind a trusted proxy. */
export function clientAddress<E extends Env>(c: Context<E>, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // In-process requests (tests) have no socket.
    return "local";
  }
}

export function rateLimit<E extends Env = Env>(
  limiter: RateLimiter,
  trustProxy: boolean,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const verdict = limiter.hit(clientAddress(c, trustProxy));
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
