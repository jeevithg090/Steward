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

/** How many problems one explanation names: enough to fix a call, short enough to read. */
const MAX_PROBLEMS = 3;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSchema(value: unknown): JsonSchema | undefined {
  return isPlainObject(value) ? value : undefined;
}

function numeric(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function items(n: number): string {
  return n === 1 ? "1 item" : `${n} items`;
}

/** A value's kind, in the words the explanations use. */
function kindWords(schema: JsonSchema): string {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf
      .map((branch) => kindWords(asSchema(branch) ?? {}))
      .filter((words, i, all) => words && all.indexOf(words) === i)
      .join(" or ");
  }
  switch (schema.type) {
    case "string":
      return "text";
    case "number":
      return "a number";
    case "integer":
      return "a whole number";
    case "boolean":
      return "true or false";
    case "array":
      return "a list";
    case "object":
      return "an object";
    default:
      return "";
  }
}

function problemsIn(
  schema: JsonSchema,
  value: unknown,
  label: string,
  required: boolean,
  out: string[],
): void {
  if (out.length >= MAX_PROBLEMS) return;
  if (value === null) {
    out.push(
      required
        ? `"${label}" is required and cannot be null.`
        : `Leave out "${label}" instead of sending null.`,
    );
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    const fits = schema.anyOf.some((branch) => {
      const found: string[] = [];
      problemsIn(asSchema(branch) ?? {}, value, label, required, found);
      return found.length === 0;
    });
    if (!fits) out.push(`"${label}" must be ${kindWords(schema)}.`);
    return;
  }
  const allowed = Array.isArray(schema.enum) ? schema.enum : undefined;
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") out.push(`"${label}" must be text.`);
      else if (allowed && !allowed.includes(value)) {
        out.push(`"${label}" must be one of: ${allowed.join(", ")}.`);
      }
      return;
    case "number":
    case "integer": {
      const whole = schema.type === "integer";
      const words = whole ? "a whole number" : "a number";
      if (typeof value !== "number" || !Number.isFinite(value) || (whole && !Number.isInteger(value))) {
        const asNumber = typeof value === "string" ? numeric(value) : undefined;
        out.push(
          asNumber !== undefined && (!whole || Number.isInteger(asNumber))
            ? `"${label}" must be ${words}, such as ${asNumber}, not the text "${value}".`
            : `"${label}" must be ${words}.`,
        );
        return;
      }
      if (typeof schema.minimum === "number" && value < schema.minimum) {
        out.push(`"${label}" must be at least ${schema.minimum}.`);
      } else if (typeof schema.maximum === "number" && value > schema.maximum) {
        out.push(`"${label}" must be at most ${schema.maximum}.`);
      }
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") out.push(`"${label}" must be true or false.`);
      return;
    case "array": {
      if (!Array.isArray(value)) {
        out.push(
          typeof value === "string" && asSchema(schema.items)?.type === "string"
            ? `"${label}" must be a list, such as ${JSON.stringify([value])}.`
            : `"${label}" must be a list.`,
        );
        return;
      }
      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        out.push(`"${label}" needs at least ${items(schema.minItems)}.`);
        return;
      }
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        out.push(`"${label}" takes at most ${items(schema.maxItems)}.`);
        return;
      }
      const itemSchema = asSchema(schema.items);
      if (!itemSchema) return;
      for (const [i, item] of value.entries()) {
        const before = out.length;
        problemsIn(itemSchema, item, `${label}[${i}]`, true, out);
        if (out.length > before) return;
      }
      return;
    }
    case "object":
      if (!isPlainObject(value)) {
        out.push(`"${label}" must be an object.`);
        return;
      }
      objectProblems(schema, value, `${label}.`, out);
      return;
    default:
      if (allowed && !allowed.includes(value)) out.push(`"${label}" must be one of: ${allowed.join(", ")}.`);
  }
}

function objectProblems(
  schema: JsonSchema,
  value: Record<string, unknown>,
  prefix: string,
  out: string[],
): void {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  for (const key of required) {
    if (out.length >= MAX_PROBLEMS) return;
    if (value[key] === undefined) out.push(`"${prefix}${key}" is required.`);
  }
  for (const [key, field] of Object.entries(value)) {
    const fieldSchema = asSchema(properties[key]);
    if (fieldSchema && field !== undefined)
      problemsIn(fieldSchema, field, `${prefix}${key}`, required.has(key), out);
  }
}

/**
 * Why arguments do not fit a tool's parameters, in words the model can act on, or `undefined`
 * when they fit. It covers what the builders above emit: types, required, enum, minimum and
 * maximum, items, minItems and maxItems, and `anyOf` of simple types. Null is a wrong value, as it
 * is to the provider's validator.
 */
export function explainArgs(schema: JsonSchema, args: unknown): string | undefined {
  if (!isPlainObject(args)) return "The arguments must be a JSON object.";
  const out: string[] = [];
  objectProblems(schema, args, "", out);
  return out.length > 0 ? out.slice(0, MAX_PROBLEMS).join(" ") : undefined;
}

function forgiveValue(schema: JsonSchema, value: unknown): unknown {
  switch (schema.type) {
    case "number":
    case "integer": {
      const given = typeof value === "string" ? numeric(value) : value;
      if (typeof given !== "number" || !Number.isFinite(given)) return value;
      const low = typeof schema.minimum === "number" ? Math.max(schema.minimum, given) : given;
      return typeof schema.maximum === "number" ? Math.min(schema.maximum, low) : low;
    }
    case "array":
      return typeof value === "string" && asSchema(schema.items)?.type === "string" ? [value] : value;
    case "object":
      return isPlainObject(value) ? forgiveArgs(schema, value) : value;
    default:
      return value;
  }
}

/**
 * The arguments with the slips Steward's own readers already accept put right, so the call can
 * run: an optional field sent as null is left out, a number sent as text becomes the number, a
 * number outside its range is brought inside it, and one text where a list of text belongs becomes
 * a list of one. Nothing else changes; the caller checks the result with `explainArgs`.
 */
export function forgiveArgs(schema: JsonSchema, args: Record<string, unknown>): Record<string, unknown> {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const field = asSchema(properties[key]);
    if (value === null && !required.has(key)) continue;
    out[key] = field && value !== null ? forgiveValue(field, value) : value;
  }
  return out;
}
