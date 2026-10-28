import {
  type BuiltinToolName,
  type GateCall,
  type Initiator,
  isBuiltinTool,
  newId,
  parseMcpToolName,
  type Target,
  TOOLS,
} from "@steward/shared";

/**
 * What each built-in tool does, in words for the person (the Connections page). The model's own
 * descriptions live in `@steward/agent`; these are shorter and say what it means for you.
 */
export const TOOL_DESCRIPTIONS = {
  browser_navigate: "Opens a web page on its computer.",
  browser_snapshot: "Reads the page on its screen.",
  browser_click: "Clicks something on a page.",
  browser_type: "Types into a field on a page.",
  browser_press: "Presses a key on a page.",
  browser_scroll: "Scrolls a page.",
  browser_back: "Goes back to the page before.",
  request_help: "Asks you to take the wheel when it is stuck.",
  request_secret: "Asks you to type a password into the secret box. It never sees what you type.",
  file_list: "Lists the files in its workspace.",
  file_read: "Reads a file in its workspace.",
  file_write: "Saves a file in its workspace.",
  shell_run: "Runs a command in its workspace.",
  mail_list: "Lists your recent mail.",
  mail_read: "Reads an email.",
  mail_send: "Sends an email.",
  calendar_list: "Reads your calendar.",
  calendar_create: "Adds an event to your calendar.",
  web_fetch: "Reads a public web page without opening the browser.",
  web_search: "Searches the web.",
  memory_remember: "Remembers something about you.",
  task_create: "Adds a task to your Tasks page.",
  task_update: "Updates a task.",
  routine_create: "Sets up a routine that runs on a schedule.",
  brief_today: "Prepares today's brief.",
  triage_inbox: "Sorts your mail into needs you and can wait.",
  show_table: "Shows a table.",
  show_chart: "Shows a chart.",
  show_comparison: "Shows a side-by-side comparison.",
  show_choices: "Shows choices for you to pick from.",
  make_page: "Makes a page you can read or keep.",
  directory_find: "Looks up ready-made bots in the directory.",
} as const satisfies Record<BuiltinToolName, string>;

export function builtinToolList(): { name: string; description: string; kind: string; surface: string }[] {
  return (Object.keys(TOOLS) as BuiltinToolName[]).map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    kind: TOOLS[name].kind,
    surface: TOOLS[name].surface,
  }));
}

/**
 * The gateway's view of a tool by name. Unknown tools are treated as writes (fail closed); MCP
 * tools are writes unless the person marked them as reads.
 */
export function describeTool(
  name: string,
  mcpKind?: (server: string, tool: string) => "read" | "write" | undefined,
): GateCall["tool"] {
  if (isBuiltinTool(name))
    return { name, kind: TOOLS[name].kind, surface: TOOLS[name].surface, source: "builtin" };
  const mcp = parseMcpToolName(name);
  if (mcp) {
    return {
      name,
      kind: mcpKind?.(mcp.server, mcp.tool) ?? "write",
      surface: "mcp",
      source: `mcp:${mcp.server}`,
    };
  }
  return { name, kind: "write", surface: "system", source: "unknown" };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function emailsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === "string")
      out.push(
        ...item
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (item && typeof item === "object" && "email" in item && typeof item.email === "string")
      out.push(item.email);
  }
  return out;
}

/**
 * A minimal target resolver for the "would this be allowed?" tester: it reads the usual argument
 * names (`url`, `path`, `command`, `to`/`cc`/`bcc`, `ref`, `amount`). The agent's own resolver may
 * know more; this one only has to agree on what the rules look at.
 */
export function resolveTarget(name: string, args: Record<string, unknown>): Target {
  const target: Target = {};
  const url = str(args.url);
  if (url) {
    target.url = url;
    try {
      target.host = new URL(url.includes("://") ? url : `https://${url}`).hostname;
    } catch {
      // Leave the host out; rules on host then simply do not match.
    }
  }
  const path = str(args.path);
  if (path) target.path = path;
  const command = str(args.command);
  if (command) target.command = command;
  const recipients = [...emailsOf(args.to), ...emailsOf(args.cc), ...emailsOf(args.bcc)];
  if (recipients.length > 0) target.recipients = recipients;
  const ref = str(args.ref);
  if (ref) {
    target.element = { ref };
    const elementName = str(args.element) ?? str(args.name);
    if (elementName) target.element.name = elementName;
  }
  const amount = args.amount;
  if (amount && typeof amount === "object" && "value" in amount && "currency" in amount) {
    const { value, currency } = amount as { value: unknown; currency: unknown };
    if (typeof value === "number" && typeof currency === "string") target.amount = { value, currency };
  }
  const mcp = parseMcpToolName(name);
  if (mcp) target.mcp = mcp;
  return target;
}

/** Text that would leave Steward if the call ran, for the gateway's sensitive-data check. */
export function outboundOf(name: string, args: Record<string, unknown>): string | undefined {
  if (name === "mail_send")
    return [str(args.subject), str(args.body)].filter(Boolean).join("\n") || undefined;
  if (name === "browser_type") return str(args.text);
  if (name === "shell_run") return str(args.command);
  if (parseMcpToolName(name)) return JSON.stringify(args);
  return undefined;
}

export function buildDryRunCall(
  input: { tool: string; args: Record<string, unknown>; tainted: boolean; initiator: Initiator["kind"] },
  ctx: {
    agentId: string;
    actorId: string;
    mcpKind?: (server: string, tool: string) => "read" | "write" | undefined;
  },
): GateCall {
  const outbound = outboundOf(input.tool, input.args);
  return {
    toolCallId: newId("dry"),
    runId: "dry-run",
    threadId: "dry-run",
    agentId: ctx.agentId,
    actorId: ctx.actorId,
    initiator: { kind: input.initiator, id: input.initiator === "person" ? ctx.actorId : "dry-run" },
    tool: describeTool(input.tool, ctx.mcpKind),
    args: input.args,
    target: resolveTarget(input.tool, input.args),
    tainted: input.tainted,
    ...(outbound ? { outbound } : {}),
  };
}
