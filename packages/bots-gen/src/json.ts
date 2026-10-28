/**
 * Reading a JSON object out of a model's answer. Models wrap JSON in code fences, add a sentence
 * before it, and leave trailing commas; the pack is only refused when none of the repairs yields an
 * object.
 */

export class ModelJsonError extends Error {}

/** The text inside the first ```fence```, or the whole text when there is none. */
export function stripFences(text: string): string {
  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/** From the first `{` to the last `}`, so a sentence before or after the object does no harm. */
function outerObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

/** `, }` and `, ]` are the commonest model slip; removing them is safe outside strings. */
export function repairTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

/** Raw line breaks inside a string are not JSON; escape them. */
function escapeBareNewlines(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      if (ch === "\\") {
        out += ch + (text[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r" || ch === "\t") {
        out += ch === "\r" ? "" : "\\t";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function tryParse(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through to the next repair
  }
  return undefined;
}

/** The one JSON object in a model's answer, or a `ModelJsonError` saying why there is none. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const candidate = outerObject(stripFences(text)) ?? outerObject(text);
  if (!candidate) throw new ModelJsonError("The model's answer has no JSON object in it.");
  const attempts = [
    candidate,
    repairTrailingCommas(candidate),
    escapeBareNewlines(repairTrailingCommas(candidate)),
  ];
  for (const attempt of attempts) {
    const parsed = tryParse(attempt);
    if (parsed) return parsed;
  }
  throw new ModelJsonError("The model's answer is not valid JSON, even after repairs.");
}
