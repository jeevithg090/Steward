/**
 * One plain sentence for what a call would do, shown on approval cards and in the record:
 * "Send an email to sam@example.com: 'Re: Friday'", "Run a command: ls -la",
 * "Click 'Place order' on shop.example.com".
 *
 * Argument names follow the built-in tools' parameters (`to`, `subject`, `command`, `url`, `path`,
 * `text`, `title`, `query`); anything missing simply drops out of the sentence.
 */
import { parseMcpToolName, type Target } from "@steward/shared";
import { truncate } from "./redact.ts";

export interface SummaryInput {
  tool: { name: string; kind: string; surface?: string; source?: string };
  args: Record<string, unknown>;
  target: Target;
  /** Arguments that must not appear, such as text typed into a password field. */
  hidden?: ReadonlySet<string>;
}

function text(value: unknown, max = 80): string | undefined {
  if (typeof value !== "string") return undefined;
  const tidy = value.replace(/\s+/g, " ").trim();
  return tidy ? truncate(tidy, max) : undefined;
}

function quoted(value: unknown, max = 80): string | undefined {
  const t = text(value, max);
  return t ? `'${t}'` : undefined;
}

/** "sam@example.com", "sam@example.com and kim@example.com", "sam@example.com and 3 others". */
export function listPeople(people: readonly string[]): string {
  if (people.length === 0) return "";
  if (people.length === 1) return people[0] ?? "";
  if (people.length === 2) return `${people[0]} and ${people[1]}`;
  return `${people[0]} and ${people.length - 1} others`;
}

function on(target: Target): string {
  return target.host ? ` on ${target.host}` : "";
}

function element(target: Target, fallback: string): string {
  const name = text(target.element?.name, 60);
  if (name) return `'${name}'`;
  return target.element?.ref ? `${fallback} (${target.element.ref})` : fallback;
}

/** ", which clicks 'Place order'": what Enter or Space will press, when that is another control. */
function presses(target: Target): string {
  const name = text(target.element?.submitter?.name, 60);
  if (!name || name === text(target.element?.name, 60)) return "";
  return `, which clicks '${name}'`;
}

function when(value: unknown): string {
  const t = text(value, 40);
  if (!t) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(t);
  if (iso) return ` on ${iso[1]}${iso[2] ? ` at ${iso[2]}` : ""}`;
  return ` on ${t}`;
}

export function summarize(input: SummaryInput): string {
  const { tool, args, target } = input;
  const hidden = input.hidden ?? new Set<string>();
  const shown = (key: string) => (hidden.has(key) ? undefined : args[key]);
  const recipients = target.recipients ?? [];
  let sentence: string;

  if (tool.source?.startsWith("harness:")) return truncate(harnessSentence(tool, args, target), 240);

  switch (tool.name) {
    case "mail_send": {
      const to = listPeople(recipients);
      const subject = quoted(shown("subject"));
      sentence = `Send an email${to ? ` to ${to}` : ""}${subject ? `: ${subject}` : ""}`;
      break;
    }
    case "calendar_create": {
      const title = quoted(shown("title"));
      sentence = `Add ${title ?? "an event"} to your calendar${when(shown("start"))}`;
      if (recipients.length > 0) sentence += ` and invite ${listPeople(recipients)}`;
      break;
    }
    case "shell_run":
      sentence = `Run a command: ${text(target.command, 120) ?? "(none given)"}`;
      break;
    case "browser_navigate":
      sentence = `Open ${text(target.url, 120) ?? "a page"}`;
      break;
    case "browser_snapshot":
      sentence = `Read the page${on(target)}`;
      break;
    case "browser_click":
      sentence = `Click ${element(target, "an element")}${on(target)}`;
      break;
    case "browser_type": {
      const typed = quoted(shown("text"), 60);
      const field = element(target, "a field");
      sentence = typed ? `Type ${typed} into ${field}${on(target)}` : `Type into ${field}${on(target)}`;
      if (args.submit === true) sentence += ` and press Enter${presses(target)}`;
      break;
    }
    case "browser_press":
      sentence = `Press ${text(args.key, 30) ?? "a key"}${target.element?.name ? ` in ${element(target, "")}` : ""}${on(target)}${presses(target)}`;
      break;
    case "browser_scroll":
      sentence = `Scroll ${text(args.direction, 10) ?? "the page"}${on(target)}`;
      break;
    case "browser_back":
      sentence = `Go back${on(target)}`;
      break;
    case "request_help":
      sentence = `Ask you to take the wheel${text(args.reason) ? `: ${text(args.reason)}` : ""}`;
      break;
    case "request_secret":
      sentence = `Ask you for ${quoted(args.label) ?? "a secret"}${on(target)}`;
      break;
    case "file_list":
      sentence = `List files in ${text(target.path) ?? "the workspace"}`;
      break;
    case "file_read":
      sentence = `Read ${text(target.path) ?? "a file"}`;
      break;
    case "file_write":
      sentence = `Save ${text(target.path) ?? "a file"}`;
      break;
    case "make_page":
      sentence = `Make a page${quoted(shown("title")) ? `: ${quoted(shown("title"))}` : ""}`;
      break;
    case "mail_list":
      sentence = `Check your mail${quoted(shown("query")) ? ` for ${quoted(shown("query"))}` : ""}`;
      break;
    case "mail_read":
      sentence = "Read an email";
      break;
    case "calendar_list":
      sentence = "Check your calendar";
      break;
    case "web_fetch":
      sentence = `Fetch ${text(target.url, 120) ?? "a page"}`;
      break;
    case "web_search":
      sentence = `Search the web for ${quoted(shown("query")) ?? "something"}`;
      break;
    case "memory_remember":
      sentence = `Remember ${quoted(shown("text")) ?? "a fact"}`;
      break;
    case "task_create":
      sentence = `Create a task${quoted(shown("title")) ? `: ${quoted(shown("title"))}` : ""}`;
      break;
    case "task_update":
      sentence = "Update a task";
      break;
    case "routine_create":
      sentence = `Set up a routine${quoted(shown("title")) ? `: ${quoted(shown("title"))}` : ""}${text(args.schedule) ? ` (${text(args.schedule)})` : ""}`;
      break;
    case "brief_today":
      sentence = "Prepare today's brief";
      break;
    case "triage_inbox":
      sentence = "Sort your inbox";
      break;
    case "show_table":
      sentence = "Show a table";
      break;
    case "show_chart":
      sentence = "Show a chart";
      break;
    case "show_comparison":
      sentence = "Show a comparison";
      break;
    case "show_choices":
      sentence = "Show some choices";
      break;
    case "delegate_task": {
      const task = quoted(shown("task"), 120);
      const agent = text(args.agentId, 40);
      sentence = `Hand ${task ?? "a task"} to ${agent ?? "another agent"}`;
      break;
    }
    default: {
      const mcp = target.mcp ?? parseMcpToolName(tool.name);
      sentence = mcp ? `Use ${mcp.tool} on ${mcp.server}` : `Use ${tool.name}`;
      if (recipients.length > 0) sentence += ` for ${listPeople(recipients)}`;
      else if (target.host) sentence += on(target);
    }
  }
  return truncate(sentence, 240);
}

/** "a.ts", "a.ts and b.ts", "a.ts, b.ts and 2 others". */
function listFiles(files: readonly string[]): string {
  const shown = files.slice(0, 2).map((f) => text(f, 60) ?? f);
  const rest = files.length - shown.length;
  if (rest === 0) return shown.join(" and ");
  return `${shown.join(", ")} and ${rest === 1 ? "1 other" : `${rest} others`}`;
}

/** An absolute path: one outside the agent's own folder (paths inside it are relative). */
function absolute(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * What an external coding agent wants to do, from structured fields only: the command it would
 * run, the files it would change, the address it would fetch, a wider sandbox it asks for. Never
 * from the harness's own title.
 */
function harnessSentence(tool: SummaryInput["tool"], args: Record<string, unknown>, target: Target): string {
  const path = text(target.path, 160);
  const files = Array.isArray(args.files)
    ? args.files.filter((f): f is string => typeof f === "string" && f.trim() !== "")
    : [];
  const several = files.length > 1;
  // A change to several paths is judged by the folder that holds them all, which ends in a separator.
  const folder = path !== undefined && /[\\/]$/.test(path);
  const where = several
    ? `${files.length} files: ${listFiles(files)}`
    : folder
      ? /^\.[\\/]$/.test(path)
        ? "files in its own folder"
        : `files in ${path}`
      : (path ?? files[0]);
  const outside = tool.surface === "system" && [path, ...files].some((p) => p && absolute(p));
  const grantRoot = text(args.grantRoot, 160);
  let sentence: string;
  switch (tool.kind) {
    case "shell":
      return `Run a command: ${text(target.command, 120) ?? "(none given)"}`;
    case "read":
      if (target.url) return `Fetch ${text(target.url, 120)}`;
      return path ? `Read ${path}` : "Read files";
    case "ui":
      return "Think it through";
    case "delete":
      // A Codex patch is a delete when it deletes or moves any of its files.
      sentence =
        tool.name === "apply_patch" && several
          ? `Change ${where}, deleting or moving some`
          : where
            ? `Delete ${where}`
            : "Delete files it did not name";
      break;
    default: {
      const mcp = target.mcp ?? parseMcpToolName(tool.name);
      if (mcp && tool.surface === "mcp") return `Use ${mcp.tool} on ${mcp.server}`;
      if (where && (tool.surface === "file" || tool.surface === "system")) sentence = `Change ${where}`;
      else if (tool.name === "harness_edit" || tool.name === "harness_move")
        sentence = "Change files it did not name";
      else if (tool.name === "harness_switch_mode") sentence = "Change how it works";
      else if (tool.name.startsWith("harness_")) sentence = "Use a tool it did not name";
      else sentence = `Use ${text(tool.name, 60) ?? "a tool"}`;
    }
  }
  if (outside) sentence += ", outside its own folder";
  if (grantRoot) sentence += `. It also asks to change anything in ${grantRoot} for the rest of this session`;
  return sentence;
}
