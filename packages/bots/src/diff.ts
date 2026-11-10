import { type BotPack, parseMcpToolName, TOOL_PLAIN_WORDS } from "@steward/shared";

/**
 * What an update changes, in plain words, before it is applied (plan: "updating shows the diff
 * in plain words"). One line per change, the ones that widen what the bot may do first: new
 * tools, new connections, rules it drops. An empty list means nothing but the version changed.
 */

export interface DiffOptions {
  /**
   * The tools the gateway would run for this bot without asking. New tools are split into those
   * and the ones that ask first; without it, every new tool is listed together.
   */
  runsWithoutAsking?: ReadonlySet<string>;
}

/** Plain words for a tool, without the "(asks first)" note. */
function words(tool: string): string {
  const known = TOOL_PLAIN_WORDS[tool];
  if (known) return known.replace(/\s*\(asks first\)\s*$/, "");
  const mcp = parseMcpToolName(tool);
  if (mcp) return `use ${mcp.tool} on ${mcp.server}`;
  return tool.replace(/_/g, " ");
}

function phrases(tools: readonly string[]): string {
  return [...new Set(tools.map(words))].join(", ");
}

function connector(id: string): string {
  if (id === "mail") return "your mail";
  if (id === "calendar") return "your calendar";
  return `${id} (a connected app)`;
}

function quote(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return `“${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}”`;
}

/** The first sentence of `next` that `old` does not have, for a short excerpt of what is new. */
function firstNewSentence(old: string, next: string): string | undefined {
  const split = (text: string) =>
    text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  const before = new Set(split(old));
  return split(next).find((s) => !before.has(s));
}

function added<T>(next: readonly T[], old: readonly T[]): T[] {
  const had = new Set(old);
  return [...new Set(next)].filter((x) => !had.has(x));
}

/** Ends a line with a full stop, unless it already ends with one (inside a quote or not). */
function sentence(line: string): string {
  return /[.!?]”?$/.test(line) ? line : `${line}.`;
}

function effectWords(effect: "ask" | "deny"): string {
  return effect === "deny" ? "refuses" : "asks first";
}

export function diffPacks(old: BotPack, next: BotPack, opts: DiffOptions = {}): string[] {
  const lines: string[] = [];
  const out = { push: (line: string) => lines.push(sentence(line)) };

  // What it may reach: new tools and connections first, since they widen what it does.
  const newTools = added(next.needs.tools, old.needs.tools);
  if (newTools.length > 0) {
    const free = opts.runsWithoutAsking;
    if (free) {
      const runs = newTools.filter((t) => free.has(t));
      const asks = newTools.filter((t) => !free.has(t));
      if (runs.length > 0) out.push(`New: it may ${phrases(runs)} without asking.`);
      if (asks.length > 0) out.push(`New: it may ${phrases(asks)}, after asking you.`);
    } else {
      out.push(`New tools: it may ${phrases(newTools)}.`);
    }
  }
  const newConnectors = added(next.needs.connectors, old.needs.connectors);
  if (newConnectors.length > 0) out.push(`Now needs ${newConnectors.map(connector).join(" and ")}.`);

  // Rules, by name: a dropped or changed rule may loosen what it does.
  const oldRules = new Map(old.rules.map((r) => [r.name, r]));
  const nextRules = new Map(next.rules.map((r) => [r.name, r]));
  for (const [name, rule] of oldRules) {
    if (!nextRules.has(name)) out.push(`Drops the rule “${name}” (it ${effectWords(rule.effect)}).`);
  }
  for (const [name, rule] of nextRules) {
    const before = oldRules.get(name);
    if (!before) out.push(`Adds the rule “${name}” (it ${effectWords(rule.effect)}).`);
    else if (before.effect !== rule.effect || before.when !== rule.when) {
      out.push(
        before.effect !== rule.effect
          ? `Changes the rule “${name}”: it ${effectWords(rule.effect)} instead of ${before.effect === "deny" ? "refusing" : "asking first"}.`
          : `Changes when the rule “${name}” applies.`,
      );
    }
  }

  // Its own words.
  if (old.instructions.trim() !== next.instructions.trim()) {
    const fresh = firstNewSentence(old.instructions, next.instructions);
    out.push(fresh ? `Its instructions change, for example ${quote(fresh)}` : "Its instructions change.");
  }
  const oldSkills = new Map(old.skills.map((s) => [s.name, s]));
  const nextSkills = new Map(next.skills.map((s) => [s.name, s]));
  for (const name of oldSkills.keys()) if (!nextSkills.has(name)) out.push(`Drops the skill /${name}.`);
  for (const [name, skill] of nextSkills) {
    const before = oldSkills.get(name);
    if (!before) out.push(`Adds the skill /${name}: ${quote(skill.description, 80)}`);
    else if (
      before.body !== skill.body ||
      before.description !== skill.description ||
      (before.allowedTools ?? []).join(" ") !== (skill.allowedTools ?? []).join(" ")
    ) {
      out.push(`Changes what /${name} does.`);
    }
  }
  const oldRoutines = new Map(old.routines.map((r) => [r.title, r]));
  const nextRoutines = new Map(next.routines.map((r) => [r.title, r]));
  for (const title of oldRoutines.keys()) {
    if (!nextRoutines.has(title)) out.push(`Drops the routine “${title}”.`);
  }
  for (const [title, routine] of nextRoutines) {
    const before = oldRoutines.get(title);
    if (!before) out.push(`Adds the routine “${title}”, switched off.`);
    else if (before.prompt !== routine.prompt || before.schedule !== routine.schedule) {
      out.push(`Changes the routine “${title}”. It is switched off again after the update.`);
    }
  }
  const newShortcuts = added(
    next.shortcuts.map((s) => s.title),
    old.shortcuts.map((s) => s.title),
  );
  if (newShortcuts.length > 0) {
    out.push(`Adds phone shortcuts: ${newShortcuts.map((t) => quote(t, 60)).join(", ")}`);
  }

  // Who it says it is.
  if (old.name !== next.name) out.push(`Its name changes from ${quote(old.name)} to ${quote(next.name)}`);
  if (old.pitch.trim() !== next.pitch.trim()) out.push(`Its pitch changes to ${quote(next.pitch)}`);
  const author = (a: BotPack["author"]) => (a.kind === "ai" ? "AI-made" : `by ${a.handle}`);
  if (author(old.author) !== author(next.author)) {
    out.push(`It is now credited ${next.author.kind === "ai" ? "as AI-made" : author(next.author)}.`);
  }
  if (old.readme.trim() !== next.readme.trim()) out.push("Its description changes.");

  // What it no longer reaches, last: these only narrow it.
  const goneTools = added(old.needs.tools, next.needs.tools);
  if (goneTools.length > 0) out.push(`No longer uses the tools to ${phrases(goneTools)}.`);
  const goneConnectors = added(old.needs.connectors, next.needs.connectors);
  if (goneConnectors.length > 0) {
    out.push(`No longer needs ${goneConnectors.map(connector).join(" or ")}.`);
  }
  return lines;
}
