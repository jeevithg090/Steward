// Adapted from openbot/server/src/plugins/mcp.ts (MIT, CopilotKit)

/**
 * The most result text a call may return. A tool result goes straight into the model's context, so
 * an unbounded one is somebody else's server deciding how much of it to spend. Cut visibly, never
 * silently.
 */
export const MAX_RESULT_CHARS = 20_000;
const LINK_FIELD_CHARS = 400;

export interface McpCallOutput {
  /** The result as text, which is what the model reads. */
  text: string;
  /** The server's `structuredContent`, when it sent one. */
  structured?: unknown;
  truncated: boolean;
}

/**
 * An MCP `tools/call` result as text a model can read.
 *
 * Text parts are joined; an embedded resource with text is its text; a resource link becomes its
 * URI and title; anything else is named (`[image]`) rather than dropped, so the model knows something
 * arrived. An empty result says so in words: an empty string reads as "the tool had nothing to say"
 * and the model fills the gap from memory.
 */
export function resultText(content: unknown, structuredContent?: unknown): McpCallOutput {
  const parts = Array.isArray(content) ? content : [];
  let joined = parts.map(partText).join("\n");
  const structured =
    structuredContent !== null && typeof structuredContent === "object" ? structuredContent : undefined;

  if (joined.trim() === "") {
    // Tools with an output schema often answer only in structuredContent.
    joined = structured ? JSON.stringify(structured, null, 2) : "";
    if (joined === "") {
      return {
        text: "The tool returned no content. Nothing was found, so there is nothing here to answer from.",
        truncated: false,
      };
    }
  }
  const out: McpCallOutput = { text: joined, truncated: false };
  if (structured) out.structured = structured;
  if (joined.length <= MAX_RESULT_CHARS) return out;
  let end = MAX_RESULT_CHARS;
  const code = joined.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return {
    ...out,
    text: `${joined.slice(0, end)}\n\n[truncated: the tool returned ${joined.length} characters]`,
    truncated: true,
  };
}

function partText(part: unknown): string {
  if (!part || typeof part !== "object") return "[unknown]";
  const item = part as {
    type?: string;
    text?: unknown;
    uri?: unknown;
    name?: unknown;
    title?: unknown;
    description?: unknown;
    resource?: { text?: unknown; uri?: unknown } | null;
  };
  if (item.type === "text" && typeof item.text === "string") return item.text;
  if (item.type === "resource" && typeof item.resource?.text === "string") return item.resource.text;
  if (item.type === "resource_link") {
    const field = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);
    const bounded = (v: string) => (v.length > LINK_FIELD_CHARS ? `${v.slice(0, LINK_FIELD_CHARS)}…` : v);
    const lines: string[] = [];
    const uri = field(item.uri);
    if (uri) lines.push(`uri: ${uri}`);
    const title = field(item.title) ?? field(item.name);
    if (title) lines.push(`title: ${bounded(title)}`);
    const description = field(item.description);
    if (description) lines.push(`description: ${bounded(description)}`);
    if (lines.length) return lines.join("\n");
  }
  return `[${item.type ?? "unknown"}]`;
}
