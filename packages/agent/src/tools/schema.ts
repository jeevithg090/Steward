import type { JsonSchema, ObjectSchema, ToolArgs } from "./types.ts";

/**
 * Small builders for tool parameter schemas. Plain JSON Schema (draft 7), kept to the subset every
 * OpenAI-compatible provider accepts: no `$ref`, no `type` arrays, `anyOf` only where unavoidable.
 */

export function object(properties: Record<string, JsonSchema>, required: string[] = []): ObjectSchema {
  return required.length > 0 ? { type: "object", properties, required } : { type: "object", properties };
}

export function str(description: string, extra: JsonSchema = {}): JsonSchema {
  return { type: "string", description, ...extra };
}

export function num(description: string, extra: JsonSchema = {}): JsonSchema {
  return { type: "number", description, ...extra };
}

export function int(description: string, extra: JsonSchema = {}): JsonSchema {
  return { type: "integer", description, ...extra };
}

export function bool(description: string): JsonSchema {
  return { type: "boolean", description };
}

export function oneOf(values: readonly string[], description: string): JsonSchema {
  return { type: "string", enum: [...values], description };
}

export function list(items: JsonSchema, description: string, extra: JsonSchema = {}): JsonSchema {
  return { type: "array", items, description, ...extra };
}

/** The optional one-line reason every acting tool accepts. It reaches the record and the approval card. */
export const INTENT = str(
  "One short line on why you are doing this, in plain words. Shown to the person and kept in the record.",
);

/** A readable error for bad arguments. The model sees the message and can try again. */
export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentError";
  }
}

export function readString(args: ToolArgs, key: string, opts: { max?: number } = {}): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ArgumentError(`"${key}" is required and must be text.`);
  }
  if (opts.max !== undefined && value.length > opts.max) {
    throw new ArgumentError(`"${key}" is too long: at most ${opts.max} characters.`);
  }
  return value;
}

export function readOptionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ArgumentError(`"${key}" must be text.`);
  return value.trim() === "" ? undefined : value;
}

export function readOptionalNumber(
  args: ToolArgs,
  key: string,
  range?: { min: number; max: number },
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ArgumentError(`"${key}" must be a number.`);
  if (range) return Math.min(range.max, Math.max(range.min, n));
  return n;
}

export function readOptionalBoolean(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ArgumentError(`"${key}" must be true or false.`);
  return value;
}

/** Accepts an array of strings, or one string, which some models send for a single value. */
export function readStringList(args: ToolArgs, key: string, opts: { required?: boolean } = {}): string[] {
  const value = args[key];
  let items: unknown[];
  if (value === undefined || value === null) items = [];
  else if (typeof value === "string") items = value.split(",");
  else if (Array.isArray(value)) items = value;
  else throw new ArgumentError(`"${key}" must be a list of text.`);
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") throw new ArgumentError(`"${key}" must be a list of text.`);
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  if (opts.required && out.length === 0) throw new ArgumentError(`"${key}" needs at least one item.`);
  return out;
}

export function readEnum<T extends string>(
  args: ToolArgs,
  key: string,
  values: readonly T[],
  fallback?: T,
): T {
  const value = args[key];
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
  throw new ArgumentError(`"${key}" must be one of: ${values.join(", ")}.`);
}

/** Copies the arguments without Steward's own bookkeeping field, for tools that pass them on. */
export function withoutIntent(args: ToolArgs): ToolArgs {
  const { intent: _intent, ...rest } = args;
  return rest;
}
