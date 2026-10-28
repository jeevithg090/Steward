import type { AuditType, Effect, Rule, Target, TaskState, ToolKind, ToolSurface } from "@steward/shared";
import { parseMcpToolName } from "@steward/shared";

/**
 * Plain words for every internal name the screens show. A person never sees `browser_navigate` or
 * `tool.decided`; they see "Open a web page" and "Decided".
 */

export type Tone = "neutral" | "accent" | "done" | "needs" | "working" | "problem";

const TOOL_LABELS: Record<string, string> = {
  browser_navigate: "Open a web page",
  browser_snapshot: "Read the page",
  browser_click: "Click on the page",
  browser_type: "Type on the page",
  browser_press: "Press a key",
  browser_scroll: "Scroll the page",
  browser_back: "Go back a page",
  request_help: "Ask you to take the wheel",
  request_secret: "Ask you for a secret",
  file_list: "List files",
  file_read: "Read a file",
  file_write: "Save a file",
  shell_run: "Run a command",
  mail_list: "Check your mail",
  mail_read: "Read an email",
  mail_send: "Send an email",
  calendar_list: "Check your calendar",
  calendar_create: "Add a calendar event",
  web_fetch: "Read a web page",
  web_search: "Search the web",
  memory_remember: "Remember something",
  task_create: "Add a task",
  task_update: "Update a task",
  routine_create: "Set up a routine",
  brief_today: "Make the morning brief",
  triage_inbox: "Sort your inbox",
  show_table: "Show a table",
  show_chart: "Show a chart",
  show_comparison: "Show a comparison",
  show_choices: "Offer choices",
  make_page: "Make a page",
  directory_find: "Look up bots in the directory",
};

/** "Send an email"; MCP tools read "notion: search pages"; unknown names are humanised, never raw. */
export function toolLabel(name: string): string {
  const known = TOOL_LABELS[name];
  if (known) return known;
  const mcp = parseMcpToolName(name);
  if (mcp) return `${mcp.server}: ${humanise(mcp.tool)}`;
  return humanise(name);
}

/** `search_pages` → "Search pages". */
export function humanise(id: string): string {
  const words = id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
}

export const KIND_LABELS: Record<ToolKind, string> = {
  read: "Reads",
  write: "Changes something",
  send: "Sends",
  pay: "Pays",
  sign: "Signs",
  delete: "Deletes",
  shell: "Runs commands",
  ui: "Shows on screen",
};

export const SURFACE_LABELS: Record<ToolSurface, string> = {
  browser: "Browser",
  file: "Files",
  shell: "Shell",
  mail: "Mail",
  calendar: "Calendar",
  web: "Web",
  mcp: "Connected app",
  memory: "Memory",
  task: "Tasks",
  ui: "Screen",
  system: "System",
};

export const EFFECT_LABELS: Record<Effect, { label: string; verb: string; tone: Tone }> = {
  allow: { label: "Permitted", verb: "Allow without asking", tone: "done" },
  ask: { label: "Asked", verb: "Ask me first", tone: "needs" },
  deny: { label: "Refused", verb: "Never allow", tone: "problem" },
};

export const RULE_SOURCE_LABELS: Record<Rule["source"], string> = {
  preset: "Built in",
  tenant: "From your setup",
  person: "Yours",
  always: "Always allowed",
  bot: "From a bot",
};

/** Model providers as people read them. The id itself for one the app does not know. */
export const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  nvidia: "NVIDIA",
  gemini: "Gemini",
  xai: "xAI",
  ollama: "Ollama",
  "openai-compatible": "OpenAI-compatible server",
  scripted: "Scripted demo model",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  "tool.decided": "Decided",
  "tool.completed": "Done",
  "tool.failed": "Failed",
  "approval.requested": "Asked you",
  "approval.decided": "You answered",
  "approval.expired": "Request expired",
  "secret.requested": "Asked for a secret",
  "secret.filled": "Secret filled",
  "computer.help_requested": "Asked you to take the wheel",
  "computer.control_taken": "You took the wheel",
  "computer.control_released": "You gave the wheel back",
  "policy.changed": "Rules changed",
  "routine.ran": "Routine ran",
  "routine.disabled": "Routine switched off",
  "run.started": "Started work",
  "run.finished": "Finished work",
  "harness.started": "Coding agent started",
  "harness.stopped": "Coding agent stopped",
  "delegation.started": "Handed a task on",
  "delegation.finished": "Handed-on task finished",
  "bot.installed": "Bot added",
  "bot.updated": "Bot updated",
  "bot.removed": "Bot removed",
  "device.paired": "Phone paired",
  "device.changed": "Phone access changed",
  "device.revoked": "Phone removed",
  "device.refused": "Phone refused",
};

/**
 * "iPhone (Shortcuts)" for a record row a paired phone made, from its `via` detail; undefined for
 * everything done at Steward's own screen.
 */
export function deviceVia(detail: Record<string, unknown> | undefined): string | undefined {
  const via = detail?.via;
  if (typeof via !== "string" || !via.startsWith("device:")) return undefined;
  const name = typeof detail?.device === "string" && detail.device ? detail.device : "a phone";
  const kind = detail?.deviceKind;
  const how =
    kind === "shortcut" ? "Shortcuts" : kind === "pwa" ? "phone app" : kind === "app" ? "Steward app" : "";
  const checked = detail?.verified === "webauthn" ? ", Face ID checked" : "";
  return how ? `${name} (${how}${checked})` : name;
}

export const TASK_STATES: Record<TaskState, { label: string; tone: Tone }> = {
  needs_you: { label: "Needs you", tone: "needs" },
  suggested: { label: "Suggested", tone: "accent" },
  working: { label: "Working", tone: "working" },
  ready_for_review: { label: "Ready for review", tone: "done" },
  needs_input: { label: "Needs input", tone: "needs" },
  resolved: { label: "Resolved", tone: "neutral" },
  failed: { label: "Couldn't finish", tone: "problem" },
  hidden: { label: "Hidden", tone: "neutral" },
};

/** One line naming what a call acts on: a host, a recipient list, a command, an amount. */
export function targetSummary(target: Target | undefined): string {
  if (!target) return "";
  const parts: string[] = [];
  if (target.recipients?.length) parts.push(`To ${target.recipients.join(", ")}`);
  if (target.amount) parts.push(formatMoney(target.amount.value, target.amount.currency));
  if (target.url) parts.push(target.url);
  else if (target.host) parts.push(target.host);
  if (target.path) parts.push(target.path);
  if (target.command) parts.push(`$ ${target.command}`);
  if (target.element?.name)
    parts.push(`“${target.element.name}”${target.element.role ? ` ${target.element.role}` : ""}`);
  if (target.mcp) parts.push(`${target.mcp.server} · ${target.mcp.tool}`);
  return parts.join(" · ");
}

/** Minor units to a readable amount: `formatMoney(1999, "GBP")` → "£19.99". */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}
