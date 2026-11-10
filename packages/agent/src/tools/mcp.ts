import type { McpToolDefinition } from "@steward/shared";
import type { ObjectSchema, StewardTool, ToolArgs } from "./types.ts";

/** A server's schema, forced to the object root every provider and the AI SDK require. */
export function objectRoot(schema: Record<string, unknown> | undefined): ObjectSchema {
  if (schema?.type !== "object") return { type: "object", properties: {} };
  const properties =
    typeof schema.properties === "object" && schema.properties !== null && !Array.isArray(schema.properties)
      ? (schema.properties as ObjectSchema["properties"])
      : {};
  return { ...schema, type: "object", properties };
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keywords that only document a schema. Some providers refuse them; the model does not need them. */
const NOTES_ONLY: ReadonlySet<string> = new Set([
  "$schema",
  "$id",
  "$comment",
  "examples",
  "$defs",
  "definitions",
]);

/** Keywords whose value is one schema, or a list of schemas. */
const SUBSCHEMA: ReadonlySet<string> = new Set([
  "items",
  "additionalItems",
  "additionalProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "anyOf",
  "oneOf",
  "allOf",
  "prefixItems",
]);

/** Keywords whose value maps names to schemas. The names are the server's, never keywords. */
const SCHEMA_MAP: ReadonlySet<string> = new Set(["properties", "patternProperties", "dependentSchemas"]);

/** How deep local references are inlined. A schema that refers to itself is never sent. */
const MAX_REF_DEPTH = 5;

/**
 * How many nodes may be copied in from references in all. Fields that each refer to the next
 * level multiply: twenty of them four levels deep would be 160,000 copies, sent with every model
 * call and built again for every run.
 */
const MAX_INLINED_NODES = 10_000;

/** What a local reference such as `#/$defs/Address` points at in the schema it came from. */
function resolveRef(root: Record<string, unknown>, ref: string): Record<string, unknown> | undefined {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    let key: string;
    try {
      key = decodeURIComponent(raw).replaceAll("~1", "/").replaceAll("~0", "~");
    } catch {
      return undefined;
    }
    node = isPlain(node) ? node[key] : undefined;
  }
  return isPlain(node) ? node : undefined;
}

interface Walk {
  root: Record<string, unknown>;
  /** Set when a reference could not be inlined. Nothing more is walked after that. */
  unresolved: boolean;
  /** Nodes copied in from references so far. */
  inlined: number;
}

/** `path` holds the references being inlined around this node, outermost first. */
function portableNode(node: unknown, walk: Walk, path: readonly string[]): unknown {
  if (walk.unresolved) return node;
  if (Array.isArray(node)) return node.map((item) => portableNode(item, walk, path));
  if (!isPlain(node)) return node;
  if (path.length > 0 && ++walk.inlined > MAX_INLINED_NODES) {
    walk.unresolved = true;
    return node;
  }
  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    // A reference to one already being inlined around it is a loop: it would never end.
    const target =
      path.length < MAX_REF_DEPTH && !path.includes(ref) ? resolveRef(walk.root, ref) : undefined;
    if (!target) {
      walk.unresolved = true;
      return node;
    }
    const { $ref: _ref, ...siblings } = node;
    return portableNode({ ...target, ...siblings }, walk, [...path, ref]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (NOTES_ONLY.has(key)) continue;
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((t) => t !== "null");
      if (types.length === 1) out.type = types[0];
      else if (types.length > 1) out.anyOf = types.map((type) => ({ type }));
      continue;
    }
    if (SCHEMA_MAP.has(key) && isPlain(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, portableNode(schema, walk, path)]),
      );
    } else if (SUBSCHEMA.has(key)) {
      out[key] = portableNode(value, walk, path);
    } else {
      // enum, const, default and the rest are data, kept exactly as the server sent them.
      out[key] = value;
    }
  }
  return out;
}

/**
 * A server's schema in the form every provider takes, as Steward's own builders keep to: keywords
 * that only document it are dropped, local references (`#/$defs/…`, `#/definitions/…`) are inlined
 * a few levels deep, and a type such as `["string", "null"]` is read as `string`. One schema a
 * provider refuses fails every model call that offers it, so a schema that still refers elsewhere
 * after that (a remote reference, one that refers to itself, or one that would grow too big
 * inlined) gives `undefined`.
 */
export function portableSchema(schema: Record<string, unknown> | undefined): ObjectSchema | undefined {
  if (!isPlain(schema)) return objectRoot(undefined);
  const walk: Walk = { root: schema, unresolved: false, inlined: 0 };
  const out = portableNode(schema, walk, []);
  return walk.unresolved ? undefined : objectRoot(out as Record<string, unknown>);
}

/** Thrown for an MCP tool whose schema cannot be sent to the model. The catalogue leaves it out. */
export class UnportableSchemaError extends Error {
  constructor(readonly toolName: string) {
    super(
      `${toolName} was left out of the model's tools: its parameters refer to a schema Steward cannot inline.`,
    );
    this.name = "UnportableSchemaError";
  }
}

/** Every piece of text in the arguments, for the outbound check: an MCP write can carry anything out. */
export function textIn(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((v) => textIn(v, depth + 1));
  if (typeof value === "object" && value !== null)
    return Object.values(value).flatMap((v) => textIn(v, depth + 1));
  return [];
}

/**
 * An MCP tool the person granted to this agent. Its kind comes from the manager (the person marks
 * reads; everything else is a write) and its output is untrusted, like a web page. Throws an
 * `UnportableSchemaError` when its schema cannot be sent (see `portableSchema`).
 */
export function mcpTool(def: McpToolDefinition): StewardTool {
  const parameters = portableSchema(def.parameters);
  if (!parameters) throw new UnportableSchemaError(def.name);
  return {
    name: def.name,
    description: def.description || `The ${def.tool} tool from the ${def.server} connection.`,
    parameters,
    kind: def.kind === "read" ? "read" : "write",
    surface: "mcp",
    source: `mcp:${def.server}`,
    taints: true,
    toGateCall: async (args: ToolArgs) => {
      const target = { mcp: { server: def.server, tool: def.tool } };
      if (def.kind === "read") return { target };
      const outbound = textIn(args).join("\n").slice(0, 20_000);
      return outbound ? { target, outbound } : { target };
    },
    execute: async (args, ctx) => ctx.services.mcp.call(def.server, def.tool, args, { signal: ctx.signal }),
  };
}
