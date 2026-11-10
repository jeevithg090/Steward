import { type BotPack, type BotProblem, TOOLS } from "@steward/shared";

/**
 * Content checks that need a reader's eye but can be found by rule: a tool the text names that the
 * bot does not hold, a tool used for what it cannot do, a password asked for in the chat, starters
 * a person could not type as they are, and a health or money bot that never sends the person to
 * someone qualified. All warnings: an
 * author sees them and a reviewer decides. None replaces a person reading the bot.
 */

/**
 * Health, money and investing bots should tell the agent to say it is not a doctor or an adviser.
 * A money bot only when it touches what an adviser would (tax, pensions, debt, a mortgage…): an
 * invoice chaser or a bill calendar has no one to refer to. The generator's judge scores the same
 * categories for safety (`SAFETY_CATEGORIES` in bots-gen).
 */
const ADVISER =
  /\b(?:financial (?:advis[eo]rs?|planners?|professionals?|advice)|advis[eo]rs?|accountants?|tax (?:professionals?|preparers?)|not (?:\w+ )?advice|qualified professionals?|solicitors?|lawyers?|debt (?:charity|charities|advice))\b/i;
const REFERRAL: Partial<Record<string, { words: RegExp; ask: string; topic?: RegExp }>> = {
  health: {
    words:
      /\b(?:doctors?|GPs?|physicians?|pharmacists?|nurses?|midwi(?:fe|ves)|dieti[ct]ians?|physio(?:therapist)?s?|clinicians?|care team|medical (?:professionals?|team|advice)|health ?care (?:professionals?|providers?|team)|health (?:professionals?|providers?)|specialists?|dentists?|opticians?|therapists?|counsell?ors?|qualified professionals?)\b/i,
    ask: "a doctor, pharmacist or other health professional",
  },
  money: {
    words: ADVISER,
    ask: "a qualified adviser, and to say it is not financial advice",
    topic:
      /\b(?:tax(?:es)?|mortgages?|pensions?|retire\w*|invest\w*|loans?|debts?|credit (?:cards?|scores?|reports?)|insurance|annuit\w*|401\(?k\)?|403\(?b\)?|IRAs?|ISAs?|portfolios?|home equity|estates?|(?:a|your|their) will|power of attorney|benefits?)\b/i,
  },
  investing: { words: ADVISER, ask: "a qualified adviser, and to say it is not financial advice" },
};

/** Tools that only add something. Text that has them look things up asks for what they cannot do. */
const WRITE_ONLY: Record<string, string> = {
  memory_remember:
    'only saves a fact. What the bot remembers is already in front of it: write "check what you remember about the person"',
  task_create: "only adds a task; it cannot list or find tasks",
};

const LOOKUP =
  "(?:check|checking|ask|asking|retrieve|retrieving|query|querying|search|searching|look in|looking in|read|reading|recall|recalling|run|running)";
const READ_VERB = "(?:list|retrieve|recall|read|find|get|check|look|see|show)";
/** The phrasings that have a write-only tool look something up. */
const AS_LOOKUP = (tool: string) => {
  const name = `\`?${tool}\`?`;
  return [
    // "Check memory_remember for…", "asking memory_remember to list…", "Run memory_remember to retrieve…"
    new RegExp(String.raw`\b${LOOKUP}\s+(?:\w+\s+){0,2}?${name}\s+(?:for\b|to\s+${READ_VERB})`, "i"),
    // "If memory_remember has no schedule…"
    new RegExp(String.raw`${name}\s+(?:has\s+no(?:thing)?|returns\s+nothing|is\s+empty)\b`, "i"),
    // "Use memory_remember to list all past entries", "using memory_remember (recall)"
    new RegExp(String.raw`\b(?:use|using)\s+${name}\s+(?:to\s+${READ_VERB}\b|\(recall\))`, "i"),
    // "Retrieve the schedule from memory_remember", "a record for today in memory_remember"
    new RegExp(
      String.raw`\b(?:retriev|read|recall|list|check|look|find|pull)\w*\b(?:(?!\b(?:sav|stor|record|keep|kept|not|writ|add)\w*\b)[^.\n]){0,60}\b(?:from|in)\s+${name}\b`,
      "i",
    ),
  ];
};
const LOOKUPS = Object.fromEntries(Object.keys(WRITE_ONLY).map((tool) => [tool, AS_LOOKUP(tool)]));

/**
 * Asking for a password in the chat puts it in the conversation and the record, which Steward never
 * does. A bot hands a sign-in to the person with request_help, and they type it themselves.
 */
const ASKS_SECRET =
  /(?<!(?:\bnot|\bnever|n't)\s+)\b(?:ask|asking)\s+(?:the person\s+|them\s+|the user\s+)?(?:for|to\s+(?:give|share|tell|paste|provide|send))\s+(?:you\s+)?(?:the|their|your|its|a|any)?\s*(?:\w+\s+){0,2}?(?:passwords?|passcodes?|PINs?|login details|log-in details|credentials)\b/i;

const QUOTED = /^\s*["“”'‘’«].*["“”'’»]\s*$/s;
/** `[topic]`, `{ … }` or `<topic>`; an address in angle brackets is not one. */
const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{[^}\n]{1,40}\}|<[A-Za-z][A-Za-z _-]{0,38}>/;

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A tool name as a word: not inside a longer name, and not in quote marks (talking about it). */
function mentions(text: string, tool: string): boolean {
  return new RegExp(`(?<![\\w"'])${tool}(?![\\w"'])`).test(text);
}

/** The text the agent follows: the instructions and each skill's steps. */
function directions(pack: BotPack): [string, string][] {
  return [
    ["instructions", pack.instructions],
    ...pack.skills.map((skill, i): [string, string] => [`skills[${i}].body`, skill.body]),
  ];
}

export function checkContent(pack: BotPack, ctx: { tools: readonly string[] }): BotProblem[] {
  const problems: BotProblem[] = [];
  const warn = (path: string, message: string) => problems.push({ path, severity: "warn", message });
  const held = new Set(pack.needs.tools);
  const names = [...new Set([...Object.keys(TOOLS), ...ctx.tools])].filter((t) => !t.startsWith("mcp__"));

  for (const [path, text] of directions(pack)) {
    const missing = names.filter((tool) => !held.has(tool) && mentions(text, tool));
    if (missing.length > 0) {
      warn(
        path,
        `names ${list(missing)}, which ${missing.length === 1 ? "is" : "are"} not in needs.tools, so the bot cannot use ${missing.length === 1 ? "it" : "them"}; add the tool or change the text`,
      );
    }
    if (ASKS_SECRET.test(text)) {
      warn(
        path,
        "asks the person for a password or sign-in details in the chat, where it would stay; use request_help so they sign in themselves",
      );
    }
    for (const [tool, why] of Object.entries(WRITE_ONLY)) {
      if (LOOKUPS[tool]?.some((re) => re.test(text)))
        warn(path, `uses ${tool} to look something up, but it ${why}`);
    }
  }

  pack.starters.forEach((starter, i) => {
    if (QUOTED.test(starter)) {
      warn(`starters[${i}]`, "is wrapped in quote marks; write it as the person would type it");
    }
    const placeholder = PLACEHOLDER.exec(starter)?.[0];
    if (placeholder) {
      warn(
        `starters[${i}]`,
        `has a placeholder (${placeholder}); write a real example the person could send`,
      );
    }
  });

  const referral = REFERRAL[pack.category];
  const about = `${pack.pitch}\n${directions(pack)
    .map(([, text]) => text)
    .join("\n")}`;
  if (
    referral &&
    (!referral.topic || referral.topic.test(about)) &&
    !directions(pack).some(([, text]) => referral.words.test(text))
  ) {
    warn(
      "instructions",
      `never tells the agent to send the person to ${referral.ask}; a ${pack.category} bot should`,
    );
  }
  return problems;
}
