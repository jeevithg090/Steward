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
    // The rest of a body too large is unread; a kept-alive socket would be reset under the next request.
    if (status === 413) c.header("Connection", "close");
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

const KINDS: Record<string, string> = {
  string: "text",
  number: "a number",
  int: "a whole number",
  bigint: "a whole number",
  boolean: "true or false",
  array: "a list",
  object: "a group of fields",
  date: "a date",
};

/** `a, b or c`. */
function inWords(items: readonly unknown[], last = "or"): string {
  const words = items.map(String);
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} ${last} ${words.at(-1)}`;
}

/**
 * What is wrong with one field, as a phrase a person can act on ("write at least 1 character",
 * "choose allow, ask or deny"), instead of zod's own messages and patterns. Pass it as the `error`
 * of a parse; a message the schema gives itself still wins.
 */
export const plainIssue: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return "this is needed";
      return `this should be ${KINDS[issue.expected] ?? issue.expected}`;
    case "too_small": {
      const n = Number(issue.minimum);
      if (issue.origin === "string") {
        if (issue.exact) return `write exactly ${n} characters`;
        return n <= 1 ? "write something" : `write at least ${n} characters`;
      }
      if (issue.origin === "array" || issue.origin === "set") return `choose at least ${n}`;
      return issue.inclusive === false ? `use more than ${n}` : `use ${n} or more`;
    }
    case "too_big": {
      const n = Number(issue.maximum);
      if (issue.origin === "string") {
        return issue.exact ? `write exactly ${n} characters` : `keep it to ${n} characters or fewer`;
      }
      if (issue.origin === "array" || issue.origin === "set") return `choose at most ${n}`;
      return issue.inclusive === false ? `use less than ${n}` : `use ${n} or less`;
    }
    case "invalid_value":
      return issue.values.length === 1 ? `use ${String(issue.values[0])}` : `choose ${inWords(issue.values)}`;
    case "invalid_format":
      if (issue.format === "url") return "use a web address that starts with http:// or https://";
      if (issue.format === "email") return "use an email address";
      return "this is not written the way Steward reads it";
    case "not_multiple_of":
      return `use a multiple of ${String(issue.divisor)}`;
    case "unrecognized_keys":
      return `${inWords(issue.keys, "and")} ${issue.keys.length === 1 ? "is" : "are"} not used here`;
    default:
      return "this is not written the way Steward reads it";
  }
};

/** The first problem of a failed parse as one sentence, led by the field it is about. */
export function firstProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "That request body is not valid.";
  if (issue.path.length === 0 && issue.code === "invalid_type") return "Send the details as a JSON object.";
  const text = issue.message.trim();
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
  return issue.path.length > 0
    ? `${issue.path.join(".")}: ${sentence}`
    : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

/** Validates a value already read, with plain messages. For bodies that are not read by `readBody`. */
export function checkValue<S extends z.ZodType>(
  schema: S,
  value: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; problem: string } {
  const parsed = schema.safeParse(value, { error: plainIssue });
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, problem: firstProblem(parsed.error) };
}

/** Reads a JSON body and validates it. A broken or wrong body is a 400 with the first problem named. */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
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
  const checked = checkValue(schema, raw);
  if (!checked.ok) throw new HttpError(400, checked.problem);
  return checked.data;
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
