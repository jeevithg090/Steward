import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/** An error whose message is written for the person and safe to send. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "that"): HttpError => new HttpError(404, `Couldn't find ${what}.`);

const GENERIC = "Something went wrong on Steward's side. Try again.";

/**
 * Every error leaves as `{ error: "<sentence>" }`. Messages a person can act on pass through;
 * anything unexpected is logged here and answered with a generic sentence, never a stack trace.
 */
export const onError: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof HTTPException) {
    const status = err.status;
    const message =
      status === 413
        ? "That request is too large."
        : status === 400
          ? "That request could not be read."
          : err.message || GENERIC;
    return c.json({ error: message }, status as ContentfulStatusCode);
  }
  console.error(`[steward] ${c.req.method} ${c.req.path} failed:`, err instanceof Error ? err.message : err);
  return c.json({ error: GENERIC }, 500);
};

/** Reads a JSON body and validates it. A broken or wrong body is a 400 with the first problem named. */
export async function readBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  const text = await c.req.text();
  if (text.trim() === "") raw = {};
  else {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "That request body is not valid JSON.");
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${issue?.message ?? "That request body is not valid."}`);
  }
  return parsed.data;
}

/**
 * Turns an error thrown by a package's store into a 400 when it reads like a sentence meant for the
 * person (a refused schedule, a rule that does not compile), and lets anything else become a 500.
 */
export function asUserError(err: unknown, status: ContentfulStatusCode = 400): never {
  if (err instanceof HttpError) throw err;
  if (err instanceof Error && isPersonFacing(err.message)) throw new HttpError(status, err.message);
  throw err;
}

function isPersonFacing(message: string): boolean {
  if (!message || message.length > 400) return false;
  return !/SQLITE|constraint|undefined|null|TypeError|ReferenceError|\bat\s+\S+\s+\(|stack|ENOENT|ECONN/i.test(
    message,
  );
}
