/**
 * A fixed-window counter per key, in memory. The device listener is the one part of Steward that
 * may be reachable from outside this machine, so pairing, failed tokens and each device's calls are
 * all limited. A restart forgets the counts, which is fine: codes and tokens are not guessable.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Counts one call. False when the key is over its limit for this window. */
  take(key: string): boolean {
    const at = this.now();
    const current = this.windows.get(key);
    if (!current || at - current.start >= this.windowMs) {
      if (this.windows.size > 10_000) this.sweep(at);
      this.windows.set(key, { start: at, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }

  /** True when the key has used its limit for this window. Does not count a call. */
  blocked(key: string): boolean {
    const current = this.windows.get(key);
    return !!current && this.now() - current.start < this.windowMs && current.count >= this.limit;
  }

  /** Seconds until the key's window resets, for `Retry-After`. */
  retryAfter(key: string): number {
    const current = this.windows.get(key);
    if (!current) return 0;
    return Math.max(1, Math.ceil((current.start + this.windowMs - this.now()) / 1000));
  }

  private sweep(at: number): void {
    for (const [key, w] of this.windows) if (at - w.start >= this.windowMs) this.windows.delete(key);
  }
}
