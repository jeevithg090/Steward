// Adapted from openduet/openbot/scripts/fake-google/server.ts matchesQuery (MIT, CopilotKit)

import { DEMO_TIME_ZONE } from "./demo-constants.ts";
import { type Header, headerValue } from "./mime.ts";
import { zonedTime } from "./time.ts";

/** What the matcher needs to know about one message. */
export interface QueryableMessage {
  labelIds: string[];
  /** Milliseconds since the epoch. */
  internalDate: number;
  headers: Header[];
  /** The readable body, for bare words. */
  text: string;
}

interface Term {
  negated: boolean;
  operator: string;
  value: string;
}
type Node = Term | { any: Node[] };

/**
 * Parses a Gmail search into terms. Terms are ANDed; `a OR b` binds the two terms either side of it,
 * as in Gmail. Quoted phrases stay whole. Unknown operators narrow nothing.
 */
export function parseQuery(query: string): Node[] {
  const tokens = query.match(/-?(?:[a-z_]+:)?(?:"[^"]*"|\S+)/gi) ?? [];
  const nodes: Node[] = [];
  let pendingOr = false;
  for (const raw of tokens) {
    if (raw === "OR" || raw === "|") {
      pendingOr = nodes.length > 0;
      continue;
    }
    if (/^and$/i.test(raw)) continue;
    const negated = raw.startsWith("-") && raw.length > 1;
    const body = negated ? raw.slice(1) : raw;
    const colon = body.search(/:/);
    const isOperator = colon > 0 && /^[a-z_]+$/i.test(body.slice(0, colon));
    const term: Term = {
      negated,
      operator: isOperator ? body.slice(0, colon).toLowerCase() : "",
      value: (isOperator ? body.slice(colon + 1) : body).replace(/^"|"$/g, "").toLowerCase(),
    };
    if (pendingOr) {
      const previous = nodes.pop();
      if (previous) nodes.push({ any: "any" in previous ? [...previous.any, term] : [previous, term] });
      else nodes.push(term);
      pendingOr = false;
    } else {
      nodes.push(term);
    }
  }
  return nodes;
}

export function matchesQuery(
  message: QueryableMessage,
  query: string,
  now: number,
  labelNames: ReadonlyMap<string, string> = new Map(),
): boolean {
  return parseQuery(query).every((node) => matchNode(message, node, now, labelNames));
}

function matchNode(
  message: QueryableMessage,
  node: Node,
  now: number,
  labelNames: ReadonlyMap<string, string>,
): boolean {
  if ("any" in node) return node.any.some((n) => matchNode(message, n, now, labelNames));
  const result = matchTerm(message, node, now, labelNames);
  return node.negated ? !result : result;
}

const UNIT_MS = {
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  m: 30 * 86_400_000,
  y: 365 * 86_400_000,
} as const;

function matchTerm(
  message: QueryableMessage,
  term: Term,
  now: number,
  labelNames: ReadonlyMap<string, string>,
): boolean {
  const field = (name: string) => (headerValue(message.headers, name) ?? "").toLowerCase();
  const has = (label: string) => message.labelIds.includes(label);
  const { operator, value } = term;

  switch (operator) {
    case "in":
      if (value === "anywhere" || value === "all") return true;
      return has(value.toUpperCase()) || hasNamedLabel(message, value, labelNames);
    case "label":
      return (
        message.labelIds.some((id) => id.toLowerCase() === value) || hasNamedLabel(message, value, labelNames)
      );
    case "category":
      if (value === "primary")
        return has("CATEGORY_PERSONAL") || !message.labelIds.some((l) => l.startsWith("CATEGORY_"));
      return has(`CATEGORY_${value.toUpperCase()}`);
    case "is":
      if (value === "read") return !has("UNREAD");
      return has(value.toUpperCase());
    case "from":
    case "to":
    case "cc":
    case "bcc":
    case "subject":
      return field(operator).includes(value);
    case "deliveredto":
      return field("delivered-to").includes(value) || field("to").includes(value);
    case "list":
      return field("list-id").includes(value);
    case "rfc822msgid":
      return field("message-id").replace(/^<|>$/g, "") === value.replace(/^<|>$/g, "");
    case "after":
    case "before": {
      const instant = instantOf(value);
      if (instant === undefined) return true;
      return operator === "after" ? message.internalDate >= instant : message.internalDate < instant;
    }
    case "newer_than":
    case "older_than": {
      const m = /^(\d+)([hdwmy])$/.exec(value);
      if (!m) return true;
      const span = Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
      return operator === "newer_than"
        ? message.internalDate >= now - span
        : message.internalDate < now - span;
    }
    case "has":
      // The demo mailbox has no attachments; other `has:` values narrow nothing.
      return value !== "attachment" && value !== "drive" && value !== "document" && value !== "spreadsheet";
    case "filename":
      return false;
    case "":
      return [field("from"), field("to"), field("cc"), field("subject"), message.text.toLowerCase()].some(
        (t) => t.includes(value),
      );
    default:
      return true;
  }
}

function hasNamedLabel(
  message: QueryableMessage,
  value: string,
  labelNames: ReadonlyMap<string, string>,
): boolean {
  return message.labelIds.some(
    (id) => labelNames.get(id)?.toLowerCase().replace(/\s+/g, "-") === value.replace(/\s+/g, "-"),
  );
}

/** `after:`/`before:` values: Unix seconds, or `YYYY/MM/DD` meaning the start of that day in the demo's zone. */
function instantOf(value: string): number | undefined {
  if (/^\d{9,}$/.test(value)) return Number(value) * 1000;
  const d = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
  if (!d) return undefined;
  const key = `${d[1]}-${d[2]?.padStart(2, "0")}-${d[3]?.padStart(2, "0")}`;
  return zonedTime(key, "00:00", DEMO_TIME_ZONE).getTime();
}
