/**
 * Tool calls named the way the person watching would name them.
 *
 * The model calls `browser_navigate`; the person reads "Opening news.ycombinator.com". Every
 * built-in tool has a phrase for while it runs and one for once it is done, and MCP tools
 * (`mcp__notes__search_notes`) are humanised ("Search notes", with the server beside it). A raw
 * snake_case id never reaches the screen.
 *
 * Partly adapted from OpenBot's app/src/lib/plugins/tool-name.ts (MIT, CopilotKit).
 */
import { parseMcpToolName } from "@steward/shared";
import { hostOf, recipientsOf } from "@/gallery/format.ts";

export type ToolPhase = "running" | "done";

export interface ToolName {
  /** What was done, in a few words. */
  label: string;
  /** What it was done to, muted beside the label. */
  detail?: string;
}

type Args = Record<string, unknown>;

function str(value: unknown, max = 80): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean === "") return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Names an element the model pointed at: its description when it gave one, else "an element". */
function elementOf(args: Args): string {
  return (
    str(args.element, 50) ??
    str(args.name, 50) ??
    str(args.description, 50) ??
    str(args.label, 50) ??
    "an element"
  );
}

function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

/** Phrases per built-in tool: `[while running, once done]`, given the call's arguments. */
const OWN: Record<string, (args: Args) => [string, string, string?]> = {
  browser_navigate: (a) => {
    const host = hostOf(a.url) ?? "a page";
    return [`Opening ${host}`, `Opened ${host}`];
  },
  browser_snapshot: () => ["Reading the page", "Read the page"],
  browser_click: (a) => [`Clicking ${elementOf(a)}`, `Clicked ${elementOf(a)}`],
  browser_type: (a) => [`Typing into ${elementOf(a)}`, `Typed into ${elementOf(a)}`],
  browser_press: (a) => {
    const key = str(a.key, 30) ?? "a key";
    return [`Pressing ${key}`, `Pressed ${key}`];
  },
  browser_scroll: (a) => {
    const way = a.direction === "up" ? "up" : "down";
    return [`Scrolling ${way}`, `Scrolled ${way}`];
  },
  browser_back: () => ["Going back a page", "Went back a page"],
  request_help: () => ["Asking you for help", "Asked you for help"],
  request_secret: (a) => {
    const what = str(a.label, 60) ?? "a password";
    return [`Asking you for ${lowerFirst(what)}`, `Asked you for ${lowerFirst(what)}`];
  },
  file_list: (a) => {
    const dir = str(a.dir, 60) ?? str(a.path, 60);
    return dir ? [`Looking in ${dir}`, `Looked in ${dir}`] : ["Looking at its files", "Looked at its files"];
  },
  file_read: (a) => {
    const path = str(a.path, 60) ?? "a file";
    return [`Reading ${path}`, `Read ${path}`];
  },
  file_write: (a) => {
    const path = str(a.path, 60) ?? "a file";
    return [`Saving ${path}`, `Saved ${path}`];
  },
  shell_run: (a) => {
    const command = str(a.command, 60);
    return command ? [`Running ${command}`, `Ran ${command}`] : ["Running a command", "Ran a command"];
  },
  mail_list: () => ["Reading your mail", "Read your mail"],
  mail_read: () => ["Opening an email", "Read an email"],
  mail_send: (a) => {
    const to = recipientsOf(a.to);
    return to.length > 0
      ? [`Writing to ${listed(to)}`, `Email to ${listed(to)}`]
      : ["Writing an email", "Email"];
  },
  calendar_list: () => ["Checking your calendar", "Checked your calendar"],
  calendar_create: (a) => {
    const title = str(a.title, 60);
    return title
      ? [`Adding ${title} to your calendar`, `Added ${title} to your calendar`]
      : ["Adding to your calendar", "Added to your calendar"];
  },
  web_fetch: (a) => {
    const host = hostOf(a.url) ?? "a page";
    return [`Reading ${host}`, `Read ${host}`];
  },
  web_search: (a) => {
    const query = str(a.query, 60);
    return query
      ? [`Searching the web for “${query}”`, `Searched the web for “${query}”`]
      : ["Searching the web", "Searched the web"];
  },
  memory_remember: () => ["Saving to memory", "Saved to memory"],
  task_create: () => ["Adding a task", "Added a task"],
  task_update: () => ["Updating a task", "Updated a task"],
  routine_create: () => ["Setting up a routine", "Set up a routine"],
  brief_today: () => ["Reading your mail and calendar", "Read your mail and calendar"],
  triage_inbox: () => ["Sorting your mail", "Sorted your mail"],
  show_table: () => ["Putting a table together", "Showed a table"],
  show_chart: () => ["Drawing a chart", "Drew a chart"],
  show_comparison: () => ["Comparing the options", "Compared the options"],
  show_choices: () => ["Offering some choices", "Offered some choices"],
  make_page: () => ["Putting it together", "Made a page"],
};

/** "Password for example.com" as "password for example.com", but "PIN" stays "PIN". */
export function lowerFirst(text: string): string {
  const second = text.charAt(1);
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The words for one tool call, while it runs or once it is done. */
export function toolName(name: string, args: Args = {}, phase: ToolPhase = "done"): ToolName {
  const own = OWN[name];
  if (own) {
    const [running, done] = own(args);
    return { label: phase === "running" ? running : done };
  }
  const mcp = parseMcpToolName(name);
  if (mcp) {
    const label = humanise(mcp.tool);
    const server = serverName(mcp.server);
    return namesServer(label, mcp.server) ? { label } : { label, detail: server };
  }
  return { label: humanise(name) };
}

/** The phrase for the status pill while a call runs: "Opening news.ycombinator.com". */
export function runningLabel(name: string, args: Args = {}): string {
  const { label, detail } = toolName(name, args, "running");
  return detail ? `${label} (${detail})` : label;
}

/** `search_notes`, `searchNotes` and `search-notes` all as "Search notes". */
export function humanise(identifier: string): string {
  const words = wordsOf(identifier).join(" ");
  if (words === "") return identifier;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `google-drive` as "Google Drive". */
export function serverName(server: string): string {
  return wordsOf(server)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function wordsOf(text: string): string[] {
  return text
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function singular(word: string): string {
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/**
 * Whether the label already names the server, so "Search notes" is not followed by "Notes".
 * Whole words after the verb only, compared singular, as OpenBot does.
 */
function namesServer(label: string, server: string): boolean {
  const acted = label.toLowerCase().split(" ").slice(1).map(singular);
  const needle = wordsOf(server).map(singular);
  if (needle.length === 0) return false;
  for (let start = 0; start + needle.length <= acted.length; start++) {
    if (needle.every((word, offset) => acted[start + offset] === word)) return true;
  }
  return false;
}
