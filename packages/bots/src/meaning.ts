import { CelEngine, CONTEXT_SCHEMA, ESCALATIONS, escalateKind, neutralContext } from "@steward/gateway";
import {
  type BotPack,
  type BotProblem,
  isBuiltinTool,
  parseMcpToolName,
  TOOLS,
  type ToolKind,
  type ToolSurface,
} from "@steward/shared";

/**
 * What a bot's rules mean, beyond compiling. The gateway's rule check only asks whether a
 * condition can be read; a pack can still bring a rule that never fires (`tool.kind ==
 * "calendar_create"` names a tool, not a kind), one that ignores the call (`true`), or one whose
 * name promises something its condition does not do. The last needs a reader; this finds the rest
 * by reading the literals a condition compares against, and by a dry run: each condition that only
 * reads the tool is tried against every tool the bot holds, in every kind the gateway could give
 * it (a click on "Pay" pays).
 */

/** Every kind and surface the gateway knows. A literal outside these can never match. */
const KINDS: Record<ToolKind, true> = {
  read: true,
  write: true,
  send: true,
  pay: true,
  sign: true,
  delete: true,
  shell: true,
  ui: true,
};
const SURFACES: Record<ToolSurface, true> = {
  browser: true,
  file: true,
  shell: true,
  mail: true,
  calendar: true,
  web: true,
  mcp: true,
  memory: true,
  task: true,
  ui: true,
  system: true,
};
const KIND_LIST = Object.keys(KINDS) as ToolKind[];

/** Kinds that change nothing: asking before them protects nothing. */
const HARMLESS: ReadonlySet<string> = new Set(["read", "ui"]);

/** Every variable a rule can read, and the names a condition may use that are not variables. */
const ROOTS = new Set(Object.keys(CONTEXT_SCHEMA));

const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);

/** A call the dry run tries: one tool in one kind. `own` is false for a kind it was raised to. */
interface Probe {
  name: string;
  kind: ToolKind;
  surface: string;
  source: string;
  own: boolean;
}

/** The kinds a browser action can be raised to, found by asking the gateway's own escalation. */
function raisedKinds(tool: string): ToolKind[] {
  const out = new Set<ToolKind>();
  for (const pattern of ESCALATIONS) {
    for (const args of [{}, { key: "Enter" }, { submit: true }]) {
      const raised = escalateKind(tool, args, { name: pattern.kind });
      if (raised) out.add(raised);
    }
  }
  return [...out];
}

function probesFor(tool: string): Probe[] {
  if (isBuiltinTool(tool)) {
    const entry = TOOLS[tool];
    const own: Probe = { name: tool, kind: entry.kind, surface: entry.surface, source: "builtin", own: true };
    return [
      own,
      ...raisedKinds(tool)
        .filter((k) => k !== entry.kind)
        .map((kind) => ({ ...own, kind, own: false })),
    ];
  }
  // An MCP tool's kind is whatever the person marked it; any kind is possible.
  const mcp = parseMcpToolName(tool);
  const source = mcp ? `mcp:${mcp.server}` : "unknown";
  return KIND_LIST.map((kind) => ({ name: tool, kind, surface: "mcp", source, own: kind === "write" }));
}

/** The condition with its string literals emptied, so a word inside quotes is not read as a name. */
function withoutStrings(when: string): string {
  return when.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
}

/** The variables a condition reads at its top level: `tool`, `target`, `args`… */
function rootsRead(when: string): Set<string> {
  const found = new Set<string>();
  for (const m of withoutStrings(when).matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) {
    const name = m[1] ?? "";
    if (ROOTS.has(name)) found.add(name);
  }
  return found;
}

const LITERAL = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`;
const FIELD = String.raw`tool\.(kind|surface|name)`;
const COMPARED = [
  new RegExp(`${FIELD}\\s*(?:==|!=)\\s*${LITERAL}`, "g"),
  new RegExp(`${LITERAL}\\s*(?:==|!=)\\s*${FIELD}`, "g"),
];
const LISTED = new RegExp(`${FIELD}\\s+in\\s+\\[([^\\]]*)\\]`, "g");

/** Each literal a condition compares `tool.kind`, `tool.surface` or `tool.name` with. */
function comparedLiterals(when: string): { field: "kind" | "surface" | "name"; value: string }[] {
  const out: { field: "kind" | "surface" | "name"; value: string }[] = [];
  const unquote = (s: string) => s.slice(1, -1);
  for (const m of when.matchAll(COMPARED[0]!)) {
    out.push({ field: m[1] as "kind", value: unquote(m[2] ?? '""') });
  }
  for (const m of when.matchAll(COMPARED[1]!)) {
    out.push({ field: m[2] as "kind", value: unquote(m[1] ?? '""') });
  }
  for (const m of when.matchAll(LISTED)) {
    for (const item of (m[2] ?? "").matchAll(new RegExp(LITERAL, "g"))) {
      out.push({ field: m[1] as "kind", value: unquote(item[1] ?? '""') });
    }
  }
  return out;
}

function list(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique.join("");
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

function literalProblems(path: string, when: string, tools: ReadonlySet<string>): BotProblem[] {
  const out: BotProblem[] = [];
  for (const { field, value } of comparedLiterals(when)) {
    if (field === "kind" && !Object.hasOwn(KINDS, value)) {
      const hint =
        isBuiltinTool(value) || tools.has(value) ? `; for that tool, write tool.name == "${value}"` : "";
      out.push({
        path,
        severity: "error",
        message: `"${value}" is not a kind of tool, so this rule never applies. Kinds are ${list(KIND_LIST)}${hint}`,
      });
    } else if (field === "surface" && !Object.hasOwn(SURFACES, value)) {
      out.push({
        path,
        severity: "error",
        message: `"${value}" is not a place a tool acts, so this rule never applies. Places are ${list(Object.keys(SURFACES))}`,
      });
    } else if (field === "name" && !tools.has(value)) {
      out.push(
        value.startsWith("mcp__")
          ? {
              path,
              severity: "warn",
              message: `"${value}" is not connected here, so this rule does nothing yet`,
            }
          : {
              path,
              severity: "error",
              message: `"${value}" is not a tool this Steward has, so this rule never applies`,
            },
      );
    }
  }
  return out;
}

/** True or false for one probe, or undefined when the condition cannot be tried on it. */
function tryOn(when: string, probe: Probe): boolean | undefined {
  const context = neutralContext();
  context.tool = { name: probe.name, kind: probe.kind, surface: probe.surface, source: probe.source };
  try {
    return engine.test(when, context);
  } catch {
    return undefined;
  }
}

/**
 * Rule problems `validatePack` adds once each condition compiles. Errors: a condition that reads
 * nothing about the call, or compares the tool with a kind, place or tool that does not exist.
 * Warnings: an ask rule that no tool of the bot can trigger, or that only covers reading or
 * showing; a deny rule that refuses a tool the bot itself needs; the same rule twice.
 */
export function checkRuleMeaning(pack: BotPack, ctx: { tools: readonly string[] }): BotProblem[] {
  const problems: BotProblem[] = [];
  const tools = new Set(ctx.tools);
  const held = [...new Set(pack.needs.tools)].filter((t) => t !== "*" && tools.has(t));
  const probes = held.flatMap(probesFor);
  const seen = new Map<string, number>();

  pack.rules.forEach((rule, i) => {
    const path = `rules[${i}].when`;
    try {
      engine.validate(rule.when);
    } catch {
      return; // It does not compile: validatePack says why, through the context's own check.
    }
    const key = `${rule.effect} ${withoutSpace(rule.when)}`;
    const twin = seen.get(key);
    if (twin !== undefined) {
      problems.push({ path: `rules[${i}]`, severity: "warn", message: `is the same rule as rules[${twin}]` });
      return;
    }
    seen.set(key, i);

    const roots = rootsRead(rule.when);
    if (roots.size === 0) {
      problems.push({
        path,
        severity: "error",
        message:
          "does not look at the call at all, so it would apply to everything or to nothing. Name the tool, its kind or its target",
      });
      return;
    }
    const literal = literalProblems(path, rule.when, tools);
    problems.push(...literal);
    // The dry run is exact only when the condition reads nothing but the tool.
    if (literal.length > 0 || roots.size !== 1 || !roots.has("tool")) return;

    const hits = probes.filter((p) => tryOn(rule.when, p) === true);
    if (rule.effect === "ask") {
      if (hits.length === 0) {
        problems.push({
          path,
          severity: "warn",
          message: `never applies: none of this bot's tools (${list(held) || "none"}) is one it covers`,
        });
      } else if (hits.every((p) => HARMLESS.has(p.kind))) {
        problems.push({
          path,
          severity: "warn",
          message: `only asks before reading or showing things (${list(hits.map((p) => p.name))}), which changes nothing. Advice about what to say belongs in the instructions`,
        });
      }
    } else if (rule.effect === "deny") {
      const refused = hits.filter((p) => p.own).map((p) => p.name);
      if (refused.length > 0) {
        problems.push({
          path,
          severity: "warn",
          message: `refuses ${list(refused)}, which this bot needs; drop the rule or the tool`,
        });
      }
    }
  });
  return problems;
}

function withoutSpace(when: string): string {
  return when.replace(/'/g, '"').replace(/\s+/g, "");
}
