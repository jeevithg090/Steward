import type { z } from "zod";

/**
 * Plain messages for a YAML configuration file that is wrong: `tenants/<id>/*.yaml`. Every loader
 * says what is wrong the same way, in words a newcomer can act on, with the line it is on:
 *
 *   agents.yaml line 3: agents[0].name: is missing
 *
 * The YAML parser is the loader's own (`yaml`'s `parseDocument`); this module only reads the parts
 * of its document that give a position, so the contracts package needs no parser.
 */

/** What line numbers need from a parsed `yaml` Document. */
export interface YamlDocumentLike {
  getIn(path: Iterable<unknown>, keepScalar?: boolean): unknown;
}

/** The parsed file a message is about: its text, its document and the plain value it gave. */
export interface ConfigSource {
  text: string;
  doc: YamlDocumentLike;
  value: unknown;
}

type Path = readonly PropertyKey[];

/** `agents[0].skills[2]`. */
export function configPath(path: Path): string {
  return path.reduce<string>(
    (out, part) =>
      typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part),
    "",
  );
}

function startOf(node: unknown): number | undefined {
  const range = (node as { range?: unknown } | null | undefined)?.range;
  return Array.isArray(range) && typeof range[0] === "number" ? range[0] : undefined;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * The line `path` is on, or the line of the nearest thing above it that is there (a missing field
 * is reported on its entry's line). With `key`, the line of that key inside the map at `path`.
 */
export function configLine(source: ConfigSource | undefined, path: Path, key?: string): number | undefined {
  if (!source) return undefined;
  if (key !== undefined) {
    const map =
      path.length === 0 ? (source.doc as { contents?: unknown }).contents : source.doc.getIn(path, true);
    const items = (map as { items?: unknown } | undefined)?.items;
    if (Array.isArray(items)) {
      for (const pair of items) {
        const k = (pair as { key?: { value?: unknown } }).key;
        if (k && String(k.value) === key) {
          const at = startOf(k);
          if (at !== undefined) return lineAt(source.text, at);
        }
      }
    }
  }
  for (let n = path.length; n > 0; n--) {
    const at = startOf(source.doc.getIn(path.slice(0, n), true));
    if (at !== undefined) return lineAt(source.text, at);
  }
  return undefined;
}

function valueAt(value: unknown, path: Path): unknown {
  let here = value;
  for (const part of path) {
    if (here === null || typeof here !== "object") return undefined;
    here = (here as Record<PropertyKey, unknown>)[part];
  }
  return here;
}

const TYPE_WORDS: Record<string, string> = {
  string: "must be text",
  number: "must be a number",
  int: "must be a whole number",
  boolean: "must be true or false",
  array: "must be a list, with each item on its own line starting with -",
  object: "must be a set of fields, such as name: value",
  record: "must be a set of fields, such as name: value",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One zod issue in plain words, without its path. */
export function plainIssueMessage(issue: z.core.$ZodIssue, source?: ConfigSource): string {
  switch (issue.code) {
    case "invalid_type": {
      const given = source ? valueAt(source.value, issue.path) : undefined;
      if (source && (given === undefined || given === null)) return "is missing";
      return TYPE_WORDS[issue.expected] ?? issue.message;
    }
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string")
        return min <= 1 ? "needs some text" : `needs at least ${plural(min, "character")}`;
      if (issue.origin === "array" || issue.origin === "set") return `needs at least ${plural(min, "item")}`;
      return `must be at least ${min}`;
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return `can be at most ${plural(max, "character")}`;
      if (issue.origin === "array" || issue.origin === "set")
        return `can have at most ${plural(max, "item")}`;
      return `must be at most ${max}`;
    }
    case "invalid_value":
      if (source && valueAt(source.value, issue.path) === undefined) return "is missing";
      return issue.values.length === 1
        ? `must be ${String(issue.values[0])}`
        : `must be one of ${issue.values.map(String).join(", ")}`;
    case "invalid_format":
      // A pattern with its own message keeps it; zod's default quotes the regular expression.
      return issue.message.startsWith("Invalid string") ? "is not written the right way" : issue.message;
    case "unrecognized_keys":
      return `unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
    default:
      return issue.message;
  }
}

/** "agents.yaml line 3: agents[0].name: is missing", for any problem a loader finds itself. */
export function configMessage(
  file: string,
  path: Path,
  message: string,
  source?: ConfigSource,
  opts: { key?: string; where?: string } = {},
): string {
  const line = configLine(source, path, opts.key);
  const where = opts.where ?? configPath(path);
  return `${file}${line ? ` line ${line}` : ""}: ${where ? `${where}: ` : ""}${message}`;
}

/**
 * Every issue (up to `max`), in plain words and with its line: the first after the file's name,
 * the rest after "; line N:".
 */
export function describeConfigIssues(
  file: string,
  issues: readonly z.core.$ZodIssue[],
  source?: ConfigSource,
  max = 8,
): string {
  const parts = issues.slice(0, max).map((issue) => {
    const key = issue.code === "unrecognized_keys" ? issue.keys[0] : undefined;
    const line = configLine(source, issue.path, key);
    const where = configPath(issue.path);
    return { line, text: `${where ? `${where}: ` : ""}${plainIssueMessage(issue, source)}` };
  });
  const more = issues.length > max ? `; and ${plural(issues.length - max, "more problem")}` : "";
  return parts
    .map((part, i) =>
      i === 0
        ? `${file}${part.line ? ` line ${part.line}` : ""}: ${part.text}`
        : `${part.line ? `line ${part.line}: ` : ""}${part.text}`,
    )
    .join("; ")
    .concat(more);
}
