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
  tool: { name: string; kind: string };
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
      if (args.submit === true) sentence += " and press Enter";
      break;
    }
    case "browser_press":
      sentence = `Press ${text(args.key, 30) ?? "a key"}${target.element?.name ? ` in ${element(target, "")}` : ""}${on(target)}`;
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
    default: {
      const mcp = target.mcp ?? parseMcpToolName(tool.name);
      sentence = mcp ? `Use ${mcp.tool} on ${mcp.server}` : `Use ${tool.name}`;
      if (recipients.length > 0) sentence += ` for ${listPeople(recipients)}`;
      else if (target.host) sentence += on(target);
    }
  }
  return truncate(sentence, 240);
}
