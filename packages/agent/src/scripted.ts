import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type ChatCompletionRequest,
  type ChatMessage,
  type FixtureResponse,
  LLMock,
} from "@copilotkit/aimock";
import { z } from "zod";

/**
 * The scripted demo model: an in-process aimock server that answers like a model would, from a
 * short script, so the whole product runs (and the end-to-end tests pass) with no key. It reads
 * tool results and answers from them, and it always says what it is.
 */

export const SCRIPTED_NOTE =
  "I'm the scripted demo model, so my answers are canned. Add a model key to talk to a real one.";

export const SCRIPTED_HELP = [
  "I'm the scripted demo model, so I only understand a few requests, such as “What needs me today?”, “Open news.ycombinator.com and tell me the top story”, “Remember that I prefer morning meetings”, “Every weekday at 8, check my mail”, “Email sam@example.com about Friday: see you at 10” or “Show me a table”.",
  "To talk to a real model, add a key to your .env file, such as OPENROUTER_API_KEY, and restart Steward.",
].join("\n\n");

export const DEFAULT_SCRIPT = fileURLToPath(new URL("../fixtures/scripted.json", import.meta.url));

// ── Reading the request ────────────────────────────────────────────────────────────────────────

function textContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
  return "";
}

function lastUserText(req: ChatCompletionRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m?.role === "user") return textContent(m.content).trim();
  }
  return "";
}

/** True once a tool has returned since the person last wrote. */
function turnHasToolResult(req: ChatCompletionRequest): boolean {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m?.role === "user") return false;
    if (m?.role === "tool") return true;
  }
  return false;
}

function offered(req: ChatCompletionRequest, name: string): boolean {
  return (req.tools ?? []).some((t) => t.function.name === name);
}

function systemText(req: ChatCompletionRequest): string {
  return req.messages
    .filter((m) => m.role === "system")
    .map((m) => textContent(m.content))
    .join("\n");
}

/** The agent's own name, from the system prompt's first line. Never the person's. */
function agentName(req: ChatCompletionRequest): string {
  return /You are ([A-Z][\w-]*(?: [A-Z][\w-]*)?)/.exec(systemText(req))?.[1] ?? "Steward";
}

function isDemoInbox(req: ChatCompletionRequest): boolean {
  return /Connected to the demo inbox/.test(systemText(req));
}

/** Tool results can arrive JSON-encoded twice; parse until it is not a string. */
function parseResult(content: string): unknown {
  let value: unknown = content;
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function call(name: string, args: Record<string, unknown>): FixtureResponse {
  return { toolCalls: [{ name, arguments: JSON.stringify(args) }] };
}

function say(...paragraphs: (string | undefined | false)[]): FixtureResponse {
  return {
    content: paragraphs.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n\n"),
  };
}

function unavailable(): FixtureResponse {
  return say("I can't do that here: the tool for it isn't available to me.", SCRIPTED_NOTE);
}

// ── After a tool returns ───────────────────────────────────────────────────────────────────────

function firstLongLink(snapshot: string): string | undefined {
  for (const match of snapshot.matchAll(/\blink "((?:[^"\\]|\\.)+)"/g)) {
    const name = match[1]?.replace(/\\"/g, '"').trim() ?? "";
    if (name.split(/\s+/).length >= 4) return name;
  }
  return undefined;
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? clean.slice(0, end + 1) : clean;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describeResult(tool: string, data: unknown, req: ChatCompletionRequest): string[] {
  const value = isRecord(data) && data.untrusted === true ? data.data : data;
  const v = isRecord(value) ? value : {};
  switch (tool) {
    case "brief_today": {
      const needs = Array.isArray(v.needsYou) ? (v.needsYou as Record<string, unknown>[]) : [];
      const calendar = Array.isArray(v.calendar) ? v.calendar.length : 0;
      const missing = Array.isArray(v.couldNotCheck) ? (v.couldNotCheck as string[]) : [];
      const top = needs[0];
      return [
        needs.length === 0
          ? "Nothing needs you today."
          : `${count(needs.length, "thing needs", "things need")} you today. The first: ${String(top?.subject ?? "an email")}. ${String(top?.reason ?? "")}`.trim(),
        calendar > 0 ? `You have ${count(calendar, "event", "events")} on the calendar.` : "",
        missing.length > 0 ? `I couldn't check: ${missing.join("; ")}.` : "",
        isDemoInbox(req) ? "This is the demo inbox, not your real mail." : "",
      ];
    }
    case "browser_navigate":
    case "browser_snapshot":
    case "browser_click":
    case "browser_type":
    case "browser_press":
    case "browser_scroll":
    case "browser_back": {
      const title = typeof v.title === "string" && v.title ? v.title : String(v.url ?? "the page");
      const headline = typeof v.snapshot === "string" ? firstLongLink(v.snapshot) : undefined;
      return headline
        ? [
            `The page is open: ${title}. The first headline I can see is “${headline}”.`,
            "I picked the first long link on the page rather than reading it properly.",
          ]
        : [`The page is open: ${title}.`];
    }
    case "web_fetch":
      return [
        `I read ${typeof v.title === "string" && v.title ? v.title : String(v.url ?? "the page")}.`,
        typeof v.text === "string" && v.text.trim() ? `It starts: “${firstSentence(v.text)}”` : "",
      ];
    case "web_search": {
      const results = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      const first = results[0];
      return results.length === 0
        ? ["The search found nothing."]
        : [`The first result is “${String(first?.title ?? "")}” (${String(first?.url ?? "")}).`];
    }
    case "mail_send":
      return [Array.isArray(v.to) && v.to.length > 0 ? `Sent to ${v.to.join(", ")}.` : "Sent."];
    case "mail_list":
      return [
        Array.isArray(value) ? `There are ${count(value.length, "recent email", "recent emails")}.` : "Done.",
      ];
    case "calendar_list":
      return [Array.isArray(value) ? `${count(value.length, "event", "events")} on the calendar.` : "Done."];
    case "memory_remember":
      return ["Got it. I'll remember that."];
    case "routine_create":
      return [
        `Done. “${String(v.title ?? "The routine")}” will run ${String(v.scheduleText ?? v.schedule ?? "on its schedule").toLowerCase()}.`,
      ];
    case "task_create":
      return ["It's on your Tasks page."];
    case "make_page":
      return [`It's saved as ${String(v.path ?? "a page")}.`];
    case "show_table":
    case "show_chart":
    case "show_comparison":
    case "show_choices":
      return ["It's on screen above."];
    default:
      return ["Done."];
  }
}

function afterTool(req: ChatCompletionRequest, result: ChatMessage): FixtureResponse {
  const toolName =
    req.messages.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === result.tool_call_id)?.function
      .name ?? "";
  const envelope = parseResult(textContent(result.content));
  if (isRecord(envelope) && envelope.ok === false) {
    if (envelope.refused === true) {
      return say(
        typeof envelope.rule === "string"
          ? `I didn't do that: the rule “${envelope.rule}” doesn't allow it.`
          : "OK, I didn't do that.",
        SCRIPTED_NOTE,
      );
    }
    return say(
      `That didn't work: ${String(envelope.error ?? envelope.message ?? "something went wrong")}`,
      SCRIPTED_NOTE,
    );
  }
  if (typeof envelope === "string" && envelope.startsWith("Error:"))
    return say(`That didn't work. ${envelope}`, SCRIPTED_NOTE);
  const data = isRecord(envelope) && envelope.ok === true ? envelope.data : envelope;
  return say(...describeResult(toolName, data, req), SCRIPTED_NOTE);
}

// ── A new request from the person ──────────────────────────────────────────────────────────────

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Every weekday at 8, check my mail" → a cron schedule and the work of one run. */
export function parseRoutine(text: string): { schedule: string; prompt: string; title: string } | undefined {
  const every =
    /\b(every\s+(weekday|day|morning|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|daily|each\s+(?:week)?day)(?:\s+(morning|afternoon|evening|night))?\b/i.exec(
      text,
    );
  if (!every) return undefined;
  const word = (every[2] ?? every[1] ?? "").toLowerCase();
  const partOfDay = (every[3] ?? word).toLowerCase();
  const at = /\bat\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i.exec(text);
  let hour = partOfDay === "evening" || partOfDay === "night" ? 18 : partOfDay === "afternoon" ? 14 : 8;
  let minute = 0;
  if (at) {
    hour = Number(at[1]) % 24;
    minute = Math.min(59, Number(at[2] ?? 0));
    const meridiem = at[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  const dayIndex = DAYS.indexOf(word.replace(/s$/, ""));
  const dow = word.startsWith("weekday")
    ? "1-5"
    : word === "week"
      ? "1"
      : dayIndex >= 0
        ? String(dayIndex)
        : "*";
  const prompt = text
    .replace(every[0], "")
    .replace(at?.[0] ?? "\u0000", "")
    .replace(/^\s*(please|can you|could you)\s+/i, "")
    .replace(/^[\s,:;-]+|[\s,:;-]+$/g, "")
    .replace(/\s{2,}/g, " ");
  if (!prompt) return undefined;
  const title = capitalise(
    prompt
      .split(/\s+/)
      .slice(0, 5)
      .join(" ")
      .replace(/[.,;:!?]+$/, ""),
  );
  return { schedule: `${minute} ${hour} * * ${dow}`, prompt: capitalise(prompt), title };
}

/** "Email sam@example.com about Friday: see you at 10" → recipients, a subject and a body. */
export function parseEmail(text: string): { to: string[]; subject: string; body: string } | undefined {
  const to = [...new Set(text.match(EMAIL) ?? [])];
  if (to.length === 0) return undefined;
  const about = /\babout\s+([^:.\n]+?)(?=[:.\n]|\s+saying\b|$)/i.exec(text)?.[1]?.trim();
  const colon = text.indexOf(":");
  const saying = /\b(?:saying|to say|that says)\s+(.+)$/is.exec(text)?.[1];
  const body = (colon >= 0 ? text.slice(colon + 1) : (saying ?? "")).trim();
  return {
    to,
    subject: about ? capitalise(about) : "A quick note",
    body: body ? capitalise(body) : "Just a quick note.",
  };
}

/** "open bbc.co.uk" → https://bbc.co.uk; "top story" with no site → Hacker News. */
export function parseSite(text: string): string | undefined {
  const named = /\b(?:open|go to|visit|browse to|load)\s+(\S+)/i.exec(text)?.[1]?.replace(/[.,;:!?)]+$/, "");
  if (named && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(named)) {
    return /^https?:\/\//i.test(named) ? named : `https://${named}`;
  }
  if (/\b(top story|hacker news)\b/i.test(text)) return "https://news.ycombinator.com";
  return undefined;
}

const DEFAULTS_TABLE = {
  title: "What Steward does without asking",
  caption: "Steward's built-in defaults. Your rules can change them, but paying always asks.",
  columns: ["Kind of action", "By default", "For example"],
  rows: [
    ["Read", "Runs", "Open a page, list mail"],
    ["Write", "Runs; asks for the calendar and connections", "Save a file, add a task"],
    ["Send", "Asks you", "Send an email"],
    ["Pay", "Always asks you", "Pay an invoice"],
    ["Sign", "Asks you", "Sign a form"],
    ["Delete", "Asks you", "Delete a file"],
    ["Shell", "Asks you", "Run a command"],
  ],
};

const MODELS_COMPARISON = {
  title: "Scripted demo model or a real model",
  options: [
    {
      name: "Scripted demo model",
      summary: "Built in, and needs no key.",
      pros: ["Works without a key", "Free", "Predictable, for demos and tests"],
      cons: ["Understands only a few requests", "Canned answers"],
    },
    {
      name: "A real model",
      summary: "Any OpenAI-compatible provider, such as OpenRouter or Ollama.",
      pros: ["Understands what you ask", "Plans work of several steps"],
      cons: ["Needs a key or a local server", "Most providers charge per use"],
    },
  ],
  recommendation: "Add a key for real work, and keep the scripted model for demos.",
};

function respondToPerson(req: ChatCompletionRequest): FixtureResponse {
  const text = lastUserText(req).replace(/^\s*\/[a-z0-9-]+\s*/i, "");
  const lower = text.toLowerCase();
  const name = agentName(req);

  if (
    /^(hi|hello|hey|hiya|howdy|good (morning|afternoon|evening))\b[\s!.,]*\S{0,20}[\s!.]*$/i.test(text) ||
    lower === ""
  ) {
    return say(
      `Hi. I'm ${name}, running on the scripted demo model, so I can only do a few things.`,
      "Try “What needs me today?” or “Open news.ycombinator.com and tell me the top story.”",
    );
  }
  if (/\b(what needs me|my brief|morning brief|today'?s brief|brief me|my day)\b/.test(lower)) {
    return offered(req, "brief_today") ? call("brief_today", {}) : unavailable();
  }
  const remember = /\bremember(?:\s+that)?\s+(.+)$/is.exec(text)?.[1]?.trim();
  if (remember) {
    return offered(req, "memory_remember")
      ? call("memory_remember", { text: capitalise(remember.replace(/[.!]+$/, "")), source: "you" })
      : unavailable();
  }
  const routine = parseRoutine(text);
  if (routine) {
    return offered(req, "routine_create")
      ? call("routine_create", { ...routine, intent: "Set up the routine you asked for" })
      : unavailable();
  }
  if (/\b(send|email|e-mail|mail)\b/.test(lower) && !/\b(list|check|read)\b/.test(lower)) {
    const email = parseEmail(text);
    if (!email) return say("Who should I send it to? Give me their email address.", SCRIPTED_NOTE);
    return offered(req, "mail_send")
      ? call("mail_send", { ...email, intent: "Send the email you asked for" })
      : unavailable();
  }
  const site = parseSite(text);
  if (site) {
    return offered(req, "browser_navigate")
      ? call("browser_navigate", { url: site, intent: "Open the page you asked for" })
      : unavailable();
  }
  const search = /\b(?:search(?: the web)?(?: for)?|look up)\s+(.+)$/i.exec(text)?.[1]?.trim();
  if (search)
    return offered(req, "web_search") ? call("web_search", { query: search, limit: 5 }) : unavailable();
  if (/\b(compare|comparison)\b/.test(lower)) {
    return offered(req, "show_comparison") ? call("show_comparison", MODELS_COMPARISON) : unavailable();
  }
  if (/\btable\b/.test(lower)) {
    return offered(req, "show_table") ? call("show_table", DEFAULTS_TABLE) : unavailable();
  }
  return say(SCRIPTED_HELP);
}

/** The scripted model's answer to one Chat Completions request. Pure: no clock, no network. */
export function scriptedReply(req: ChatCompletionRequest): FixtureResponse {
  // Triage and brief summaries (no tools offered) get no made-up verdicts: callers fall back to rules.
  if ((req.tools ?? []).length === 0) return say("Scripted demo model: no answer for this.");
  const last = req.messages.at(-1);
  if (last?.role === "tool") return afterTool(req, last);
  return respondToPerson(req);
}

// ── The script file ────────────────────────────────────────────────────────────────────────────

const scriptFile = z.object({
  fixtures: z.array(
    z.object({
      match: z.object({ userMessage: z.string().min(1) }),
      response: z.union([
        z.object({ content: z.string().min(1) }),
        z.object({
          toolCalls: z
            .array(
              z.object({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) }),
            )
            .min(1),
        }),
      ]),
    }),
  ),
});

export interface ScriptEntry {
  matches: (req: ChatCompletionRequest) => boolean;
  response: FixtureResponse;
}

/**
 * Reads a script in aimock's fixture shape. Entries match the person's last message ignoring case,
 * only before a tool has returned in that turn (so a tool call never repeats), and only when every
 * tool they call is offered.
 */
export function loadScript(path: string = DEFAULT_SCRIPT): ScriptEntry[] {
  const parsed = scriptFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues[0]?.message ?? "not a script"}`);
  return parsed.data.fixtures.map(({ match, response }) => {
    const needle = match.userMessage.toLowerCase();
    const tools = "toolCalls" in response ? response.toolCalls.map((c) => c.name) : [];
    return {
      matches: (req) =>
        (req.tools ?? []).length > 0 &&
        !turnHasToolResult(req) &&
        lastUserText(req).toLowerCase().includes(needle) &&
        tools.every((t) => offered(req, t)),
      response:
        "toolCalls" in response
          ? {
              toolCalls: response.toolCalls.map((c) => ({
                name: c.name,
                arguments: JSON.stringify(c.arguments),
              })),
            }
          : { content: response.content },
    };
  });
}

export interface ScriptedServer {
  /** The server's origin, such as http://127.0.0.1:53121. The API is under /v1. */
  url: string;
  close(): Promise<void>;
}

/** Starts the scripted model on a free loopback port. */
export async function startScriptedModel(opts: { script?: string } = {}): Promise<ScriptedServer> {
  const llm = new LLMock({ port: 0, host: "127.0.0.1", logLevel: "silent" });
  for (const entry of loadScript(opts.script)) llm.on({ predicate: entry.matches }, entry.response);
  llm.on({ predicate: () => true }, (req) => scriptedReply(req));
  const url = await llm.start();
  let closed = false;
  return {
    url,
    close: async () => {
      if (closed) return;
      closed = true;
      await llm.stop();
    },
  };
}
