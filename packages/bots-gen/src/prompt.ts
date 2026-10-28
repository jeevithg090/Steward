import type { PackProblem } from "@steward/bots";
import { BOT_CATEGORIES, type BotPack, TOOL_PLAIN_WORDS } from "@steward/shared";

/**
 * The prompts. One call writes a pack, one call judges it. Steward's writing rules are in the
 * system text so every bot sounds like Steward: plain words, short sentences, say what you could
 * not check, never a name the person did not give, no invented facts.
 */

/** Tools a pack may never ask for: the secret box, and display tools the agent has no use for. */
export function isPackTool(name: string): boolean {
  if (name === "request_secret") return false;
  if (name.startsWith("show_")) return name === "show_table" || name === "show_comparison";
  if (name.startsWith("mcp__")) return false;
  return true;
}

/** Plain words for tools the shared table does not cover. */
const EXTRA_PLAIN_WORDS: Record<string, string> = {
  browser_press: "press keys on web pages",
  browser_scroll: "scroll web pages",
  browser_back: "go back a page",
  request_help: "stop and ask the person for help with a sign-in, a code or a decision",
  file_list: "list files in its workspace",
  task_update: "update tasks",
  brief_today: "write the morning brief from mail and calendar",
  triage_inbox: "sort the inbox into what needs the person and what can wait",
  show_table: "show a table",
  show_comparison: "show options side by side",
};

export function plainWords(tool: string): string {
  return TOOL_PLAIN_WORDS[tool] ?? EXTRA_PLAIN_WORDS[tool] ?? tool.replace(/_/g, " ");
}

/** The `when` conditions a generated rule may use. Each compiles in the gateway's engine. */
export const RULE_MENU: readonly { when: string; means: string }[] = [
  { when: 'tool.kind == "pay"', means: "paying for anything" },
  { when: 'tool.kind == "send"', means: "sending a message or an email" },
  { when: 'tool.kind == "delete"', means: "deleting anything" },
  { when: 'tool.kind == "sign"', means: "signing or agreeing to anything" },
  { when: 'tool.kind == "shell"', means: "running a command" },
  { when: 'tool.name == "calendar_create"', means: "adding to the calendar" },
  { when: 'tool.name == "memory_remember"', means: "remembering a fact about the person" },
  { when: 'tool.name == "routine_create"', means: "setting up a routine that runs on its own" },
  { when: 'tool.name == "file_write"', means: "writing a file in its workspace" },
  { when: 'tool.surface == "browser" && tool.kind == "write"', means: "clicking or typing on a web page" },
];

export const WRITING_RULES = `## How to write

- Plain words. Short sentences, under 25 words. British spelling.
- Write "instructions" as directions to the agent, in the imperative: "Start by…", "When nothing is found, say so and…".
- Say what to do when a step finds nothing or a tool is not connected. That is the case that happens most.
- Never invent facts, prices, laws, dates or statistics. Tell the agent to say plainly what it could not check.
- Never give the person a name. Tell the agent not to call them by a name they did not give.
- Examples may use made-up people and places, and must say so, for example "(a made-up example)".
- No brands: no company, product, website, app or service names, not even as examples. Say "a rental listing site", "a journey planner", "the social network they use". No real people, no email addresses, no phone numbers, no card numbers.
- Steward itself asks the person before anything is sent, paid, signed or deleted. Do not write that into the instructions as a promise; write what the agent should prepare so the person can decide.
- The pack is refused if it contains text that reads as orders for the model. Do not use the phrases "ignore previous instructions", "you are now", "system prompt", "disregard", or "forward … to".`;

export function buildGenerateSystem(tools: readonly string[]): string {
  const allowed = tools.filter(isPackTool);
  const toolLines = allowed.map((t) => `- ${t}: ${plainWords(t)}`).join("\n");
  const categories = Object.entries(BOT_CATEGORIES)
    .map(([key, name]) => `${key} (${name})`)
    .join(", ");
  const ruleLines = RULE_MENU.map((r) => `- ${r.when}  — ${r.means}`).join("\n");
  return `You write bot packs for Steward, an open-source assistant that does small jobs for one person on a computer of its own, and asks before it acts. A bot pack is the job description for one such assistant: what the job is, how to do it, and what to say when it cannot.

Write the pack for the job the person describes. Output ONE JSON object and nothing else: no prose before or after, no code fence.

${WRITING_RULES}

## Tools

The agent may use only these tools, by exact name. Put in needs.tools only the ones this job needs, usually 2 to 6:
${toolLines}

needs.connectors lists "mail" when the bot reads or sends mail, "calendar" when it reads or adds to the calendar, otherwise [].

## Rules

A pack may bring up to 2 rules that make the agent ask first ("ask") or refuse ("deny"). A rule may never "allow". The "when" text must be copied exactly from this list:
${ruleLines}

Leave rules as [] when none fits the job.

## Shape

{
  "name": "2 to 4 words, like a job title: 'Rent scout', 'Invoice chaser'. No 'bot', 'assistant' or 'AI'.",
  "pitch": "One sentence, what it does for the person, at most 200 characters.",
  "category": "one of: ${categories}",
  "needs": { "tools": ["tool names"], "connectors": [], "model": "any" },
  "instructions": "300 to 800 words of Markdown. What the job is. How to do it, step by step. What to do when something is missing. What to show the person at the end.",
  "starters": ["2 to 4 things the person might type first, each one sentence"],
  "examples": [{ "ask": "what the person says", "does": "what the bot does, one or two sentences" }],
  "skills": [{ "name": "lowercase-with-hyphens", "description": "one sentence", "body": "numbered steps the agent follows for one part of the job, 80 to 300 words" }],
  "rules": [{ "name": "short name", "effect": "ask or deny", "when": "copied from the list", "description": "one sentence" }],
  "readme": "Markdown for the listing page, 80 to 200 words: a heading with the name, what it does, what it needs, what it will not do."
}

examples: 1 to 3. skills: 0 to 2, only when one part of the job deserves its own steps. rules: 0 to 2.`;
}

export interface GenerateHints {
  /** Tools the job probably needs, from the taxonomy. A suggestion, not a grant. */
  tools?: string[];
  connectors?: string[];
}

export function buildGeneratePrompt(
  input: { job: string; name?: string; category?: string },
  hints: GenerateHints = {},
): string {
  const lines = [`The job, in the person's words: "${input.job.trim()}"`];
  if (input.name) lines.push(`Call the bot: "${input.name.trim()}"`);
  if (input.category) lines.push(`File it under the category: ${input.category}`);
  if (hints.tools && hints.tools.length > 0) {
    lines.push(
      `Tools this job probably needs: ${hints.tools.join(", ")}. Add or drop tools if the job calls for it.`,
    );
  }
  if (hints.connectors && hints.connectors.length > 0)
    lines.push(`Connectors it needs: ${hints.connectors.join(", ")}.`);
  lines.push("Write the pack as one JSON object.");
  return lines.join("\n");
}

export function buildRetryPrompt(
  original: string,
  previous: string,
  problems: readonly PackProblem[],
): string {
  const list = problems
    .filter((p) => p.severity === "error")
    .slice(0, 12)
    .map((p) => `- ${p.path}: ${p.message}`)
    .join("\n");
  return `${original}

Your previous answer was refused. The problems:
${list}

Fix every problem and return the whole corrected JSON object only. Your previous answer, for reference:
${previous.slice(0, 12_000)}`;
}

export const JUDGE_SYSTEM = `You check bot packs for Steward before they are listed. Steward is an assistant that does small jobs for one person with a fixed set of tools, and asks before it sends, pays, signs or deletes anything.

Score the pack from 1 to 5 on three things, and give one sentence for each:
- usefulness: would a real person want this for the job, and do the instructions get the job done with the tools listed?
- honesty: does it avoid invented facts, tell the agent to say what it could not check, never promise what the tools cannot do, and name no brands, companies, websites or apps? Take a point off for each brand it names.
- clarity: plain words, short sentences, steps a model can follow without guessing.

Output ONE JSON object and nothing else:
{"usefulness": {"score": 1, "note": "…"}, "honesty": {"score": 1, "note": "…"}, "clarity": {"score": 1, "note": "…"}}`;

/** `catalogue` is every tool Steward has, so the judge does not mark a real tool as made up. */
export function buildJudgePrompt(pack: BotPack, catalogue: readonly string[] = []): string {
  const skills = pack.skills.map((s) => `### Skill: ${s.name}\n${s.description}\n${s.body}`).join("\n\n");
  const known = catalogue.filter(isPackTool);
  return `${known.length > 0 ? `Tools that exist in Steward: ${known.join(", ")}.\n\n` : ""}Name: ${pack.name}
Pitch: ${pack.pitch}
Category: ${pack.category}
Tools: ${pack.needs.tools.join(", ") || "none (chat only)"}
Connectors: ${pack.needs.connectors.join(", ") || "none"}

## Instructions
${pack.instructions}

## Starters
${pack.starters.map((s) => `- ${s}`).join("\n") || "(none)"}

## Examples
${pack.examples.map((e) => `- Ask: ${e.ask}\n  Does: ${e.does}`).join("\n") || "(none)"}

${skills}

Score it.`;
}
