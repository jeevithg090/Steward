import type { ToolKind, ToolSurface } from "./governance.ts";

/**
 * The built-in tool catalogue: names, kinds and surfaces. The agent package defines each tool's
 * description, parameters and implementation; the gateway's presets and the web app's renderers key
 * off these names. MCP tools are named `mcp__<server>__<tool>` and default to kind `write`.
 */
export const TOOLS = {
  // The computer: browser
  browser_navigate: { kind: "read", surface: "browser", taints: true },
  browser_snapshot: { kind: "read", surface: "browser", taints: true },
  browser_click: { kind: "write", surface: "browser", taints: true },
  browser_type: { kind: "write", surface: "browser", taints: true },
  browser_press: { kind: "write", surface: "browser", taints: true },
  browser_scroll: { kind: "read", surface: "browser", taints: true },
  browser_back: { kind: "read", surface: "browser", taints: true },
  request_help: { kind: "ui", surface: "browser", taints: false },
  request_secret: { kind: "write", surface: "browser", taints: false },
  // The computer: files and shell
  file_list: { kind: "read", surface: "file", taints: false },
  file_read: { kind: "read", surface: "file", taints: true },
  file_write: { kind: "write", surface: "file", taints: false },
  shell_run: { kind: "shell", surface: "shell", taints: true },
  // Mail and calendar
  mail_list: { kind: "read", surface: "mail", taints: true },
  mail_read: { kind: "read", surface: "mail", taints: true },
  mail_send: { kind: "send", surface: "mail", taints: false },
  calendar_list: { kind: "read", surface: "calendar", taints: true },
  calendar_create: { kind: "write", surface: "calendar", taints: false },
  // The web, without the browser
  web_fetch: { kind: "read", surface: "web", taints: true },
  web_search: { kind: "read", surface: "web", taints: true },
  // Steward's own state
  memory_remember: { kind: "write", surface: "memory", taints: false },
  task_create: { kind: "write", surface: "task", taints: false },
  task_update: { kind: "write", surface: "task", taints: false },
  routine_create: { kind: "write", surface: "task", taints: false },
  // Hands a task to another agent. Its answer is another model's words, which may carry what that
  // agent read on the web or in mail, so it taints the conversation like any outside content.
  delegate_task: { kind: "write", surface: "task", taints: true },
  brief_today: { kind: "read", surface: "mail", taints: true },
  triage_inbox: { kind: "read", surface: "mail", taints: true },
  // Generative UI: display only, rendered by the web app, no side effects
  show_table: { kind: "ui", surface: "ui", taints: false },
  show_chart: { kind: "ui", surface: "ui", taints: false },
  show_comparison: { kind: "ui", surface: "ui", taints: false },
  show_choices: { kind: "ui", surface: "ui", taints: false },
  make_page: { kind: "write", surface: "file", taints: false },
  // The bot directory: listing text is third-party, so it taints
  directory_find: { kind: "read", surface: "web", taints: true },
} as const satisfies Record<string, { kind: ToolKind; surface: ToolSurface; taints: boolean }>;

export type BuiltinToolName = keyof typeof TOOLS;

export function isBuiltinTool(name: string): name is BuiltinToolName {
  return Object.hasOwn(TOOLS, name);
}

export const MCP_TOOL_PREFIX = "mcp__";

export function mcpToolName(server: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${server}__${tool}`;
}

export function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const i = rest.indexOf("__");
  if (i <= 0) return undefined;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

/**
 * What every governed tool returns to the model. `refused` and `parked` carry a sentence the model
 * should relay rather than retry around.
 */
export type ToolResultEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; refused: true; rule?: string; message: string }
  | { ok: false; parked: true; approvalId: string; message: string }
  | { ok: false; error: string };

/** AG-UI CUSTOM event names Steward emits during a run. */
export const CUSTOM_EVENTS = {
  /** value: { approval: Approval } — the run is waiting on the person. */
  approvalRequested: "steward.approval.requested",
  /** value: { approval: Approval } */
  approvalDecided: "steward.approval.decided",
  /** value: { item: ActivityItem } */
  activity: "steward.activity",
} as const;
