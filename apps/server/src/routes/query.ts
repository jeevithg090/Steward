import type { Context } from "hono";
import { HttpError } from "../http/errors.ts";

/** An integer query parameter within bounds, or the fallback when absent. A bad value is a 400. */
export function intQuery(
  c: Context,
  name: string,
  opts: { min: number; max: number; fallback?: number },
): number | undefined {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return opts.fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < opts.min)
    throw new HttpError(400, `${name} must be a whole number of at least ${opts.min}.`);
  return Math.min(n, opts.max);
}

/** A query parameter that must be one of a few words. */
export function enumQuery<T extends string>(c: Context, name: string, allowed: readonly T[]): T | undefined {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new HttpError(400, `${name} must be one of: ${allowed.join(", ")}.`);
  }
  return raw as T;
}

/** A short free-text query parameter. */
export function textQuery(c: Context, name: string, max = 200): string | undefined {
  const raw = c.req.query(name)?.trim();
  if (!raw) return undefined;
  if (raw.length > max) throw new HttpError(400, `${name} is too long.`);
  return raw;
}

export const flagQuery = (c: Context, name: string): boolean => {
  const raw = c.req.query(name)?.toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
};
