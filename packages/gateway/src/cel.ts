// Adapted from openbot/server/src/computer/policy.ts (MIT, CopilotKit)
/**
 * The rule language: CEL on cel-js 0.8.2, compiled once and cached.
 *
 * cel-js is small and fast but has sharp edges, handled here:
 * - It throws on any name it cannot find. Every variable is therefore always bound (see
 *   `context.ts`), and `args` answers a missing key with an empty marker instead of throwing, so a
 *   rule about `args.to` cannot refuse every call that has no `to`.
 * - It does not process escapes in string literals. We do, leniently: `\"`, `\\`, `\n`, `\t`, `\r`
 *   and `\uXXXX` are escapes; anything else (`\b`, `\s`, `\d`, `\.`) is kept as written, so a regex
 *   reads the same whether its author wrote `"\bsudo\b"` or `"\\bsudo\\b"`.
 * - It has no string methods. `contains`, `matches`, `startsWith`, `endsWith` and `lower` are global
 *   functions, case-insensitive like OpenBot's.
 * - Its error messages can quote the whole context. We never pass them on; `explain` rewrites them.
 */
import { evaluate, parse } from "cel-js";

/** The parse tree, as far as this module looks into it. */
interface CstNode {
  name: string;
  children: Record<string, Array<CstNode | CstToken>>;
}

interface CstToken {
  image: string;
  tokenType: { name: string };
}

function isToken(n: CstNode | CstToken): n is CstToken {
  return (n as CstToken).image !== undefined;
}

/**
 * Answer for a key that is not in `args`. Equal to nothing but itself, empty as text, a map with no
 * keys, and any field of it is itself. `has(args.x)` is false for it.
 */
export const MISSING: object = new Proxy(Object.freeze(Object.create(null)) as object, {
  get(_target, key) {
    return typeof key === "string" ? MISSING : undefined;
  },
});

/** Wraps an arguments map so unknown keys read as `MISSING` at any depth. */
export function safeMap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeMap);
  if (value === null || typeof value !== "object") return value;
  const wrapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) wrapped[k] = safeMap(v);
  return new Proxy(wrapped, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      return Object.hasOwn(target, key) ? target[key] : MISSING;
    },
  });
}

function asText(value: unknown): string {
  if (value === MISSING || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

const MAX_MATCH_INPUT = 100_000;
const regexCache = new Map<string, RegExp>();

function regexFor(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    try {
      re = new RegExp(pattern, "i");
    } catch {
      throw new RuleFunctionError(`"${pattern}" is not a valid pattern for matches()`);
    }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(pattern, re);
  }
  return re;
}

class RuleFunctionError extends Error {}

function anyOf(value: unknown, test: (s: string) => boolean): boolean {
  if (Array.isArray(value)) return value.some((v) => test(asText(v)));
  return test(asText(value));
}

/** The functions a rule may call. All string tests ignore case. */
export const RULE_FUNCTIONS: Record<string, CallableFunction> = {
  /** `contains(text, part)`; on a list, whether any item equals `part`. */
  contains: (haystack: unknown, needle: unknown) => {
    const n = asText(needle).toLowerCase();
    if (Array.isArray(haystack)) return haystack.some((h) => asText(h).toLowerCase() === n);
    return asText(haystack).toLowerCase().includes(n);
  },
  /** `matches(text, regex)`; on a list, whether any item matches. A bad pattern makes the rule fail. */
  matches: (value: unknown, pattern: unknown) => {
    const re = regexFor(asText(pattern));
    return anyOf(value, (s) => re.test(s.slice(0, MAX_MATCH_INPUT)));
  },
  startsWith: (value: unknown, prefix: unknown) => {
    const p = asText(prefix).toLowerCase();
    return anyOf(value, (s) => s.toLowerCase().startsWith(p));
  },
  endsWith: (value: unknown, suffix: unknown) => {
    const p = asText(suffix).toLowerCase();
    return anyOf(value, (s) => s.toLowerCase().endsWith(p));
  },
  lower: (value: unknown) => asText(value).toLowerCase(),
  /** Replaces cel-js's own `has` so a missing argument counts as absent. */
  has: (value: unknown) => value !== undefined && value !== MISSING,
};

/** Built into cel-js and still available. */
const BUILTIN_FUNCTIONS = ["size"];
/** Methods cel-js supports on lists and maps: `list.exists(x, p)`. */
const COLLECTION_MACROS = new Set(["all", "exists", "exists_one", "filter", "map"]);

export const FUNCTION_NAMES: readonly string[] = [
  ...Object.keys(RULE_FUNCTIONS),
  ...BUILTIN_FUNCTIONS,
].sort();

/** Turns a cel-js string literal's inside into the text it means. Unknown escapes stay as written. */
export function unescapeCelString(inner: string): string {
  return inner.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (all, esc: string) => {
    switch (esc[0]) {
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      case "`":
        return "`";
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "u":
      case "x":
        return esc.length > 1 ? String.fromCharCode(Number.parseInt(esc.slice(1), 16)) : all;
      default:
        return all;
    }
  });
}

/** A CEL string literal for any text, for rules Steward writes itself. */
export function celString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** The variables a rule can read, as a tree of known fields. `true` marks a leaf; `"any"` an open map. */
export type FieldSchema = true | "any" | { [field: string]: FieldSchema };

export class RuleSyntaxError extends Error {}

/** What a compiled rule is. */
type Compiled = { ok: true; cst: CstNode } | { ok: false; error: string };

function walk(node: CstNode | CstToken, visit: (n: CstNode | CstToken) => void): void {
  visit(node);
  if (isToken(node)) return;
  for (const children of Object.values(node.children)) for (const child of children) walk(child, visit);
}

function firstIdentifier(node: CstNode | CstToken | undefined): string | undefined {
  let found: string | undefined;
  if (!node) return undefined;
  walk(node, (n) => {
    if (found === undefined && !isToken(n) && n.name === "identifierExpression") {
      const id = n.children.Identifier?.[0];
      if (id && isToken(id)) found = id.image;
    }
  });
  return found;
}

function tokenImage(node: CstNode, key: string): string | undefined {
  const t = node.children[key]?.[0];
  return t && isToken(t) ? t.image : undefined;
}

/** Simplifies a chevrotain parse message: "unexpected ')'" or "it ends too early". */
function explainParse(errors: string[]): string {
  const first = errors[0] ?? "";
  const extra = /^Redundant input, expecting EOF but found: (.*)$/m.exec(first);
  if (extra) return `there is something extra at the end, starting at '${truncateWord(extra[1] ?? "")}'`;
  const found = /but found: '([\s\S]*)'\s*$/.exec(first);
  if (found) {
    return found[1] === "" ? "it ends too early" : `there is an unexpected '${truncateWord(found[1] ?? "")}'`;
  }
  return first.split("\n")[0] ?? "it could not be read";
}

function truncateWord(s: string): string {
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}

/**
 * Checks names and fields against the schema without running anything, so a typo in the right
 * half of an `&&` is caught when the rule is saved, not when it first refuses a real call.
 */
function staticCheck(cst: CstNode, schema: Record<string, FieldSchema>): void {
  const bound = new Set<string>();
  walk(cst, (n) => {
    if (isToken(n) || n.name !== "identifierDotExpression") return;
    const method = tokenImage(n, "Identifier");
    if (n.children.OpenParenthesis && method && COLLECTION_MACROS.has(method)) {
      const variable = firstIdentifier(n.children.arg?.[0]);
      if (variable) bound.add(variable);
    }
  });

  walk(cst, (n) => {
    if (isToken(n)) return;
    if (n.name === "macrosExpression") {
      const fn = tokenImage(n, "Identifier") ?? "";
      if (!FUNCTION_NAMES.includes(fn)) {
        throw new RuleSyntaxError(
          `there is no function called ${fn}(). Rules can use ${FUNCTION_NAMES.join(", ")}`,
        );
      }
      return;
    }
    if (n.name === "identifierDotExpression") {
      const method = tokenImage(n, "Identifier") ?? "";
      if (n.children.OpenParenthesis && !COLLECTION_MACROS.has(method)) {
        const hint = FUNCTION_NAMES.includes(method) ? `; write ${method}(value, …) instead` : "";
        throw new RuleSyntaxError(`.${method}() is not supported${hint}`);
      }
      return;
    }
    if (n.name !== "identifierExpression") return;
    const root = tokenImage(n, "Identifier") ?? "";
    if (bound.has(root)) return;
    let node: FieldSchema | undefined = schema[root];
    if (node === undefined) {
      throw new RuleSyntaxError(
        `there is nothing called '${root}'. Rules can read ${Object.keys(schema).sort().join(", ")}`,
      );
    }
    // Follow plain field access (a.b.c) until an index or a method call.
    const steps = [
      ...(n.children.identifierDotExpression ?? []),
      ...(n.children.identifierIndexExpression ?? []),
    ]
      .filter((s): s is CstNode => !isToken(s))
      .sort((a, b) => offsetOf(a) - offsetOf(b));
    let path = root;
    for (const step of steps) {
      if (step.name !== "identifierDotExpression" || step.children.OpenParenthesis) break;
      if (node === "any") break;
      const field = tokenImage(step, "Identifier") ?? "";
      if (node === true) throw new RuleSyntaxError(`${path} is a single value; it has no field '${field}'`);
      const next: FieldSchema | undefined = node[field];
      if (next === undefined) {
        throw new RuleSyntaxError(`${path} has no field '${field}'. It has ${Object.keys(node).join(", ")}`);
      }
      node = next;
      path = `${path}.${field}`;
    }
  });
}

function offsetOf(node: CstNode): number {
  const first = node.children.Dot?.[0] ?? node.children.OpenBracket?.[0];
  return first && isToken(first) ? ((first as unknown as { startOffset?: number }).startOffset ?? 0) : 0;
}

/** Rewrites raw cel-js error text into a short sentence that never quotes the context. */
export function explainEvaluationError(err: unknown): string {
  if (err instanceof RuleFunctionError || err instanceof RuleSyntaxError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  let m: RegExpExecArray | null = /^Identifier "([^"]+)" not found/.exec(msg);
  if (m) return `there is nothing called '${m[1]}' here`;
  m = /^Macros (\S+) not recognized/.exec(msg);
  if (m) return `there is no function called ${m[1]}()`;
  m = /^Unknown method: (\S+)/.exec(msg);
  if (m) return `.${m[1]}() is not supported`;
  m = /^Cannot obtain "([^"]+)" from non-object/.exec(msg);
  if (m) return `'${m[1]}' was read from something that has no fields`;
  if (err instanceof Error && err.name === "CelTypeError") {
    const pair = /cannot be applied to \((\w+), (\w+)\)/.exec(msg);
    if (pair) return `it compares or combines values of different kinds (${pair[1]} and ${pair[2]})`;
    const single = /type (\w+)/.exec(msg);
    return `it applies an operator to the wrong kind of value${single ? ` (${single[1]})` : ""}`;
  }
  if (/Division by zero|Modulus by zero/.test(msg)) return "it divides by zero";
  return "it could not be evaluated";
}

/**
 * Compiles CEL rules and evaluates them against a context. One engine per gateway; compiled trees
 * are cached by their text.
 */
export class CelEngine {
  private readonly cache = new Map<string, Compiled>();

  constructor(
    private readonly schema: Record<string, FieldSchema>,
    private readonly neutral: () => Record<string, unknown>,
  ) {}

  private compile(expression: string): Compiled {
    const cached = this.cache.get(expression);
    if (cached) return cached;
    let compiled: Compiled;
    try {
      const parsed = parse(expression);
      if (!parsed.isSuccess) {
        compiled = { ok: false, error: `it is not valid CEL: ${explainParse(parsed.errors)}` };
      } else {
        const cst = parsed.cst as unknown as CstNode;
        walk(cst, (n) => {
          if (isToken(n) && n.tokenType.name === "StringLiteral") {
            const quote = n.image[0] ?? '"';
            n.image = quote + unescapeCelString(n.image.slice(1, -1)) + quote;
          }
        });
        staticCheck(cst, this.schema);
        compiled = { ok: true, cst };
      }
    } catch (err) {
      compiled = { ok: false, error: explainEvaluationError(err) };
    }
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(expression, compiled);
    return compiled;
  }

  /**
   * Throws a readable `RuleSyntaxError` when `expression` cannot be a rule: it does not parse, names
   * something that does not exist, calls an unknown function, or does not answer true or false.
   */
  validate(expression: string): void {
    if (typeof expression !== "string" || expression.trim() === "") {
      throw new RuleSyntaxError('A rule needs a condition, for example: tool.kind == "send"');
    }
    const compiled = this.compile(expression);
    if (!compiled.ok) throw new RuleSyntaxError(`This rule cannot be used: ${compiled.error}.`);
    let result: unknown;
    try {
      result = evaluate(compiled.cst as never, this.neutral(), RULE_FUNCTIONS);
    } catch (err) {
      throw new RuleSyntaxError(`This rule cannot be used: ${explainEvaluationError(err)}.`);
    }
    if (typeof result !== "boolean") {
      throw new RuleSyntaxError(
        `This rule cannot be used: it must answer true or false, but it gives ${describeValue(result)}.`,
      );
    }
  }

  /**
   * True or false, or a thrown `RuleEvaluationError` with a readable reason. The context is copied so
   * cel-js's macro bindings never leak between rules.
   */
  test(expression: string, context: Record<string, unknown>): boolean {
    const compiled = this.compile(expression);
    if (!compiled.ok) throw new RuleEvaluationError(compiled.error);
    let result: unknown;
    try {
      result = evaluate(compiled.cst as never, { ...context }, RULE_FUNCTIONS);
    } catch (err) {
      throw new RuleEvaluationError(explainEvaluationError(err));
    }
    if (typeof result !== "boolean") {
      throw new RuleEvaluationError(`it gave ${describeValue(result)} instead of true or false`);
    }
    return result;
  }
}

export class RuleEvaluationError extends Error {}

function describeValue(value: unknown): string {
  if (value === null || value === MISSING) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "a number";
  if (typeof value === "object") return "a map";
  return typeof value;
}
