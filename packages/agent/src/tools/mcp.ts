import type { McpToolDefinition, ToolKind } from "@steward/shared";
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

/** The kinds an MCP tool can have. Anything else from the manager is a write: fail closed. */
const MCP_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(["read", "write", "send", "delete"]);

/**
 * An MCP tool the person granted to this agent. Its kind comes from the manager (what the person
 * marked: read, write, send or delete, made stricter by the server's destructive hint), so a tool
 * that posts or deletes meets the same taint and routine rules as Steward's own sends and deletes.
 * Its output is untrusted, like a web page.
 */
export function mcpTool(def: McpToolDefinition): StewardTool {
  return {
    name: def.name,
    description: def.description || `The ${def.tool} tool from the ${def.server} connection.`,
    parameters: objectRoot(def.parameters),
    kind: MCP_KINDS.has(def.kind) ? def.kind : "write",
    surface: "mcp",
    source: `mcp:${def.server}`,
    taints: true,
    toGateCall: async (args: ToolArgs) => {
      const target = { mcp: { server: def.server, tool: def.tool } };
      // Every kind but a read can carry text out of Steward, so all of them get the outbound check.
      if (def.kind === "read") return { target };
      const outbound = textIn(args).join("\n").slice(0, 20_000);
      return outbound ? { target, outbound } : { target };
    },
    execute: async (args, ctx) => ctx.services.mcp.call(def.server, def.tool, args, { signal: ctx.signal }),
  };
}
