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
 * reads; everything else is a write) and its output is untrusted, like a web page.
 */
export function mcpTool(def: McpToolDefinition): StewardTool {
  return {
    name: def.name,
    description: def.description || `The ${def.tool} tool from the ${def.server} connection.`,
    parameters: objectRoot(def.parameters),
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
