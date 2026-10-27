// Shapes and wording adapted from openbot/app/src/components/gallery (MIT, CopilotKit)
import { builtin } from "./define.ts";
import {
  ArgumentError,
  INTENT,
  list,
  num,
  object,
  oneOf,
  readEnum,
  readOptionalString,
  readString,
  str,
} from "./schema.ts";
import type { StewardTool, ToolArgs } from "./types.ts";

/**
 * Display tools draw a card in the chat. They have no side effects: the web app renders them from
 * the arguments, and the tool only checks the arguments make sense so a broken card is never drawn.
 */
const SHOWN = {
  shown: true,
  next: "It is on screen now. Do not repeat its contents; add at most one sentence.",
};

const BASIS = oneOf(
  ["read", "given", "own-knowledge"],
  "Where the figures come from: read (a tool returned them in this conversation), given (the person told you), or own-knowledge (unchecked, and the card says so).",
);

const CELL = { anyOf: [{ type: "string" }, { type: "number" }], description: "A cell: text, or a number." };

function array(args: ToolArgs, key: string, min: number, max: number): unknown[] {
  const value = args[key];
  if (!Array.isArray(value)) throw new ArgumentError(`"${key}" must be a list.`);
  if (value.length < min) throw new ArgumentError(`"${key}" needs at least ${min}.`);
  if (value.length > max) throw new ArgumentError(`"${key}" can have at most ${max}.`);
  return value;
}

function record(value: unknown, what: string): ToolArgs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArgumentError(`Each item in "${what}" must be an object.`);
  }
  return value as ToolArgs;
}

function texts(value: unknown, what: string, max = 8): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ArgumentError(`"${what}" must be a list of text.`);
  }
  if (value.length > max) throw new ArgumentError(`"${what}" can have at most ${max} items.`);
  return value as string[];
}

function checkSources(args: ToolArgs): void {
  if (args.basis !== "read") return;
  const sources = args.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new ArgumentError('With basis "read", list the sources you read the figures from.');
  }
}

const SOURCES = list(
  object({ title: str("What you read."), url: str("Its address, if it has one.") }, ["title"]),
  "Where the figures come from. Required when basis is read.",
);

export const showTable = builtin("show_table", {
  description:
    "Show rows of structured data as a sortable table in the chat, instead of writing a table in text. Use numbers for quantities so they sort as numbers. Show only data you have: never invent rows.",
  parameters: object(
    {
      title: str("A short title."),
      caption: str("Optional. One sentence on what the table shows and where it came from."),
      columns: list(str("A column heading."), "Column headings, one to eight.", { minItems: 1, maxItems: 8 }),
      rows: list(list(CELL, "One row: one cell per column."), "The rows, at most 100.", { maxItems: 100 }),
      basis: BASIS,
      sources: SOURCES,
    },
    ["title", "columns", "rows"],
  ),
  toGateCall: async () => ({ target: {} }),
  execute: async (args) => {
    readString(args, "title", { max: 120 });
    const columns = texts(args.columns, "columns");
    if (columns.length === 0) throw new ArgumentError('"columns" needs at least one heading.');
    const rows = array(args, "rows", 0, 100);
    rows.forEach((row, i) => {
      if (!Array.isArray(row) || row.length !== columns.length) {
        throw new ArgumentError(`Row ${i + 1} must have exactly ${columns.length} cells, one per column.`);
      }
      if (row.some((cell) => typeof cell !== "string" && typeof cell !== "number")) {
        throw new ArgumentError(`Row ${i + 1} has a cell that is not text or a number.`);
      }
    });
    checkSources(args);
    return SHOWN;
  },
});

export const showChart = builtin("show_chart", {
  description:
    "Show figures as a chart in the chat. bar compares a handful of named things; line and area show a trend over time; pie shows parts of a whole (six slices at most). Every series needs one value per label. Say where the figures come from with basis.",
  parameters: object(
    {
      title: str("A short title."),
      kind: oneOf(["bar", "line", "area", "pie"], "The kind of chart."),
      labels: list(str("A label."), "The labels along the axis, or the slices of a pie.", {
        minItems: 1,
        maxItems: 60,
      }),
      series: list(
        object({ name: str("The series name."), values: list(num("A value."), "One value per label.") }, [
          "name",
          "values",
        ]),
        "One or more series. A pie has exactly one.",
        { minItems: 1, maxItems: 6 },
      ),
      caption: str("Optional. One sentence on what it shows."),
      basis: BASIS,
      sources: SOURCES,
    },
    ["title", "kind", "labels", "series", "basis"],
  ),
  toGateCall: async () => ({ target: {} }),
  execute: async (args) => {
    readString(args, "title", { max: 120 });
    const kind = readEnum(args, "kind", ["bar", "line", "area", "pie"] as const);
    readEnum(args, "basis", ["read", "given", "own-knowledge"] as const);
    const labels = texts(args.labels, "labels", 60);
    if (labels.length === 0) throw new ArgumentError('"labels" needs at least one label.');
    const series = array(args, "series", 1, 6).map((s) => record(s, "series"));
    if (kind === "pie" && (series.length !== 1 || labels.length > 6)) {
      throw new ArgumentError("A pie has one series and at most six slices. Use a bar chart instead.");
    }
    for (const s of series) {
      const values = s.values;
      if (
        !Array.isArray(values) ||
        values.length !== labels.length ||
        values.some((v) => typeof v !== "number")
      ) {
        throw new ArgumentError(
          `Series "${String(s.name)}" needs exactly ${labels.length} numbers, one per label.`,
        );
      }
    }
    checkSources(args);
    return SHOWN;
  },
});

export const showComparison = builtin("show_comparison", {
  description:
    "Compare two to four options side by side in the chat: each with a short summary, pros, cons and key facts, and your recommendation if you have one. Use it instead of writing a comparison in prose. Use only facts you have read or been given.",
  parameters: object(
    {
      title: str("A short title."),
      options: list(
        object(
          {
            name: str("The option's name."),
            summary: str("One sentence."),
            pros: list(str("A strength."), "Up to five strengths."),
            cons: list(str("A weakness."), "Up to five weaknesses."),
            facts: list(
              object({ label: str("What"), value: str("Its value") }, ["label", "value"]),
              "Key facts.",
            ),
          },
          ["name"],
        ),
        "Two to four options.",
        { minItems: 2, maxItems: 4 },
      ),
      recommendation: str("Optional. Which you would pick, and why, in one sentence."),
      caption: str("Optional. Where the facts come from."),
    },
    ["title", "options"],
  ),
  toGateCall: async () => ({ target: {} }),
  execute: async (args) => {
    readString(args, "title", { max: 120 });
    for (const option of array(args, "options", 2, 4).map((o) => record(o, "options"))) {
      readString(option, "name", { max: 120 });
      texts(option.pros, "pros", 5);
      texts(option.cons, "cons", 5);
    }
    return SHOWN;
  },
});

export const showChoices = builtin("show_choices", {
  description:
    "Show two to four short answers as buttons when you ask the person to choose between clear options, such as which email to handle first. Give your answer or recommendation in words first, and ask the question in words too; a tap arrives as their next message. Never use it for an open question. Never use it to ask whether to send, pay, sign or delete: call the tool that does it, and that call asks them itself.",
  parameters: object(
    {
      question: str("The question, in a few words."),
      choices: list(
        object(
          {
            label: str("One to four words, as the person would say it."),
            description: str("Optional detail."),
          },
          ["label"],
        ),
        "Two to four choices.",
        { minItems: 2, maxItems: 4 },
      ),
    },
    ["question", "choices"],
  ),
  toGateCall: async () => ({ target: {} }),
  execute: async (args) => {
    readString(args, "question", { max: 200 });
    const labels = array(args, "choices", 2, 4).map((c) =>
      readString(record(c, "choices"), "label", { max: 40 }),
    );
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
      throw new ArgumentError("Each choice needs a different label.");
    }
    if (labels.some((l) => /^(send|pay|sign|delete|buy|approve)\b/i.test(l))) {
      throw new ArgumentError(
        "Choices cannot ask whether to send, pay, sign or delete. Call the tool that does it; it asks the person itself.",
      );
    }
    return { shown: true, next: "The buttons are on screen. Stop here and wait for their answer." };
  },
});

/** `made/<slug>.md` from a title: lower case, letters, digits and hyphens. */
export function pageSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "page";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Removes the obvious ways a page could run code. A made page can be built from untrusted content,
 * so the web app must still show it in a sandboxed frame; this is a second line, not the first.
 */
export function stripActiveContent(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/<(iframe|object|embed|base|meta\s+http-equiv)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}

function htmlDocument(title: string, body: string): string {
  if (/<html[\s>]/i.test(body)) return body;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>body{font:1rem/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1b1b1b;background:#fff}@media (prefers-color-scheme:dark){body{color:#eee;background:#151515}}table{border-collapse:collapse}td,th{border:1px solid #8884;padding:.3rem .6rem}</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

export const makePage = builtin("make_page", {
  description:
    "Make something the person can read, keep or present, such as prep notes, a plan, a summary or a report, and save it in your workspace under made/. Use markdown unless they asked for a designed web page. The app shows it as a card that opens it, so never paste its content into the chat: say one or two sentences about it. To revise a page, call this again with the same title and the whole new content.",
  parameters: object(
    {
      title: str("The page's title."),
      format: oneOf(["markdown", "html"], "markdown for documents; html for a designed page."),
      content: str("The whole page. For html, the body is enough; Steward adds the rest."),
      summary: str("Optional. One sentence on what it is."),
      intent: INTENT,
    },
    ["title", "format", "content"],
  ),
  toGateCall: async (args) => {
    const format = args.format === "html" ? "html" : "md";
    const title = typeof args.title === "string" ? args.title : "page";
    return { target: { path: `made/${pageSlug(title)}.${format}` } };
  },
  execute: async (args, ctx) => {
    const title = readString(args, "title", { max: 200 }).trim();
    const format = readEnum(args, "format", ["markdown", "html"] as const, "markdown");
    const raw = readString(args, "content", { max: 400_000 });
    const path = `made/${pageSlug(title)}.${format === "html" ? "html" : "md"}`;
    const content =
      format === "html"
        ? htmlDocument(title, stripActiveContent(raw))
        : /^\s*#\s/.test(raw)
          ? raw
          : `# ${title}\n\n${raw}`;
    const computer = await ctx.services.computers.get(ctx.agentId);
    const file = await computer.writeFile(path, content);
    const summary = readOptionalString(args, "summary");
    return {
      made: true,
      title,
      format,
      path: file.path,
      size: file.size,
      ...(summary ? { summary } : {}),
      next: "The page is saved and shown as a card. Say one or two sentences about it; do not paste it.",
    };
  },
});

export const DISPLAY_TOOLS: StewardTool[] = [showTable, showChart, showComparison, showChoices, makePage];
