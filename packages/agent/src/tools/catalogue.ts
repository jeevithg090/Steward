import type { Tool } from "@ag-ui/client";
import { isBuiltinTool, type McpManager } from "@steward/shared";
import { BROWSER_TOOLS } from "./browser.ts";
import { DISPLAY_TOOLS } from "./display.ts";
import { FILE_TOOLS } from "./files.ts";
import { MAIL_TOOLS } from "./mail.ts";
import { mcpTool } from "./mcp.ts";
import { STEWARD_TOOLS } from "./steward.ts";
import type { StewardTool } from "./types.ts";
import { WEB_TOOLS } from "./web.ts";

/** Every built-in tool, one per entry in the shared `TOOLS` catalogue. */
export const BUILTIN_TOOLS: readonly StewardTool[] = [
  ...BROWSER_TOOLS,
  ...FILE_TOOLS,
  ...MAIL_TOOLS,
  ...WEB_TOOLS,
  ...STEWARD_TOOLS,
  ...DISPLAY_TOOLS,
];

/** The built-in tools a profile's `tools` list grants. `*` grants all of them; unknown names grant nothing. */
export function grantedBuiltins(granted: readonly string[]): StewardTool[] {
  if (granted.includes("*")) return [...BUILTIN_TOOLS];
  const names = new Set<string>(granted.filter(isBuiltinTool));
  return BUILTIN_TOOLS.filter((tool) => names.has(tool.name));
}

/**
 * The tools offered to the model for one run: the profile's built-ins, then the MCP tools the person
 * granted to this agent. MCP grants change while Steward runs, so this is built per run. A manager
 * that fails offers no MCP tools rather than failing the run.
 */
export function buildToolCatalogue(opts: {
  agentId: string;
  granted: readonly string[];
  mcp?: McpManager;
  onError?: (error: unknown) => void;
}): StewardTool[] {
  const tools = grantedBuiltins(opts.granted);
  const names = new Set(tools.map((t) => t.name));
  if (opts.mcp) {
    let defs: ReturnType<McpManager["grantedTools"]> = [];
    try {
      defs = opts.mcp.grantedTools(opts.agentId);
    } catch (error) {
      opts.onError?.(error);
    }
    for (const def of defs) {
      if (names.has(def.name)) continue;
      names.add(def.name);
      tools.push(mcpTool(def));
    }
  }
  return tools;
}

/** The AG-UI tool definition the model sees. No executor: the governed middleware runs it. */
export function toAgUiTool(tool: StewardTool): Tool {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
