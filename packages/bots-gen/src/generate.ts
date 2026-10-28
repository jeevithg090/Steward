import { type PackProblem, validatePack } from "@steward/bots";
import { BOT_CATEGORIES, type BotCategory, type BotPack, type TextModel } from "@steward/shared";
import { ModelJsonError, parseJsonObject } from "./json.ts";
import {
  buildGeneratePrompt,
  buildGenerateSystem,
  buildRetryPrompt,
  type GenerateHints,
  isPackTool,
  plainWords,
} from "./prompt.ts";
import { nameFromJob, sentence, slugify, truncateAtWord } from "./text.ts";

/**
 * One job in, one pack out. With a model: one call, parsed robustly, validated, retried once with
 * the validator's problems appended. Without a model, or when the model's answer cannot be made to
 * pass: a deterministic template pack from the job text, so Make a bot works on the scripted model
 * and in tests. Either way the pack is labelled AI-made.
 */

export type Problem = PackProblem;

export interface GenerateInput {
  /** What the bot should do, in the person's words. */
  job: string;
  name?: string;
  category?: BotCategory;
}

export interface GenerateContext {
  /** Absent: the template path. */
  model?: TextModel;
  /** The tools this Steward has. The pack may use the ones `isPackTool` allows. */
  tools: string[];
  /** The gateway's rule check; throwing means the rule cannot be used. */
  validateRule: (when: string) => void;
  now?: () => Date;
  /** From the taxonomy: tools and connectors the job probably needs. */
  hints?: GenerateHints;
}

export interface GenerateResult {
  pack: BotPack;
  problems: Problem[];
  madeBy: "model" | "template";
}

const CATEGORY_KEYS = Object.keys(BOT_CATEGORIES) as BotCategory[];
const MAX_PITCH = 240;
const MAX_NAME = 80;
const MAX_STARTER = 300;

function dateOf(ctx: GenerateContext): string {
  return (ctx.now?.() ?? new Date()).toISOString().slice(0, 10);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max)
    .map((v) => v.trim());
}

// ── The template path ──────────────────────────────────────────────────────────────────────────

/** Tools a job probably needs, from its words. Only what `ctx.tools` has and a pack may hold. */
export function toolsForJob(
  job: string,
  allowed: readonly string[],
): { tools: string[]; connectors: string[] } {
  const text = job.toLowerCase();
  const has = (re: RegExp) => re.test(text);
  const picked = new Set<string>();
  const connectors = new Set<string>();
  if (has(/\b(mail|email|inbox|newsletters?|replies|reply|invoice|chase)\b/)) {
    picked.add("mail_list").add("mail_read");
    if (has(/\b(send|reply|draft|chase|declin\w*|message|letter|tell people|follow-up|outreach|complaint)\b/))
      picked.add("mail_send");
    connectors.add("mail");
  } else if (has(/\b(draft|letter|complaint|outreach|message)\b/) && has(/\b(send|email|mail)\b/)) {
    picked.add("mail_send");
    connectors.add("mail");
  }
  if (has(/\b(calendar|meetings?|schedule|diary|appointments?|free for|birthdays?)\b/)) {
    picked.add("calendar_list");
    if (has(/\b(block|book|add|schedule|set up|itinerary|plan)\b/)) picked.add("calendar_create");
    connectors.add("calendar");
  }
  if (
    has(
      /\b(find|search|compare|price|cost|research|look up|which|best|nearest|near me|cheap\w*|where|trending|news|markets?|check whether|scam|rate)\b/,
    )
  ) {
    picked.add("web_search").add("web_fetch");
  }
  if (has(/\b(website|site|form|listing|account|sign up|apply|unsubscribe|settings|permissions)\b/)) {
    picked.add("browser_navigate").add("browser_snapshot");
    if (has(/\b(form|fill|apply|sign up|unsubscribe|reply|settings|tighten)\b/))
      picked.add("browser_click").add("browser_type");
  }
  if (
    has(
      /\b(write|plan|draft|letter|notes?|list|summar\w*|explain|outline|script|review|brief|checklist|rota|itinerary|quiz|proposal|agenda|readme|guide)\b/,
    )
  ) {
    picked.add("make_page");
  }
  if (
    has(
      /\b(file|document|pdf|spreadsheet|statement|transcript|report|contract|agreement|factsheet|papers?|diff|codebase|captions|results)\b/,
    )
  ) {
    picked.add("file_read");
  }
  if (has(/\b(remind|track|keep|log|journal|streak|habit)\b/))
    picked.add("memory_remember").add("task_create");
  if (has(/\b(every|each|daily|weekly|morning|evening|monday|friday|week\b)/)) picked.add("routine_create");
  if (has(/\b(compare|versus|between|or buy|or save|which to)\b/)) picked.add("show_comparison");
  if (has(/\b(table|tally|budget|track|list of|sort|categories|rota|score)\b/)) picked.add("show_table");
  if (has(/\b(code|tests?|script|repo\w*|bug|commands?|dependenc\w+|json|schema|stack trace|project)\b/)) {
    picked.add("file_read").add("file_write").add("shell_run");
  }
  if (has(/\b(bot|bots|directory)\b/)) picked.add("directory_find");
  if (has(/\b(sign-in|password|code|captcha|needs my say|stopping)\b/)) picked.add("request_help");
  const allowedSet = new Set(allowed.filter(isPackTool));
  const tools = [...picked].filter((t) => allowedSet.has(t));
  if (tools.length === 0) {
    for (const t of ["web_search", "web_fetch", "make_page"]) if (allowedSet.has(t)) tools.push(t);
  }
  const needsMail = tools.some((t) => t.startsWith("mail_") || t === "triage_inbox" || t === "brief_today");
  const needsCalendar = tools.some((t) => t.startsWith("calendar_"));
  return {
    tools,
    connectors: [...connectors].filter((c) => (c === "mail" ? needsMail : needsCalendar)),
  };
}

const CATEGORY_WORDS: [BotCategory, RegExp][] = [
  ["food", /\b(cook|recipe|dinner|meal|lunch|fridge|freezer|bakery|restaurant|shopping list)\b/],
  [
    "health",
    /\b(run\w*|medication|sleep|doctor|steps|protein|pharmacy|stretch\w*|caffeine|blood|walk|gym|fitness)\b/,
  ],
  ["investing", /\b(invest\w*|fund|shares|stocks?|crypto|pension|portfolio|holdings|trade|markets?)\b/],
  ["money", /\b(invoice|budget|bank|subscriptions?|loan|tariff|bill|savings?|tax|refund|owes?|spending)\b/],
  ["privacy", /\b(scam|phish\w*|breach|password|privacy|permissions|fraud)\b/],
  ["bot-helpers", /\b(bot|bots|skill|directory|pack)\b/],
  [
    "dev",
    /\b(code|codebase|pull request|test|script|repo\w*|bug|dependenc\w+|json|schema|stack trace|readme)\b/,
  ],
  ["sales-crm", /\b(leads?|prospect|sales|deal|quote|customer|demo|crm|contacts)\b/],
  ["productivity", /\b(inbox|email|calendar|meeting|to-do|focus time|weekly review|brief)\b/],
  ["video-audio", /\b(video|podcast|episode|transcript|thumbnail|music|audio|captions|filming|live)\b/],
  ["social", /\b(posts?|caption|newsletter|bio|creator|media kit|followers|thread)\b/],
  ["sports", /\b(fantasy|football|marathon|match|league|gym|tournament|cycling|running shoes|tickets)\b/],
  ["travel", /\b(trip|flight|airport|hotel|car|itinerary|packing|road trip|abroad|translate)\b/],
  ["games", /\b(game|quiz|chess|adventure|puzzle|riddle|crossword|campaign|dungeon)\b/],
  [
    "home",
    /\b(flat|rent\w*|tenancy|landlord|chore|house|plumber|washing machine|family|birthday party|move house)\b/,
  ],
  [
    "research",
    /\b(research|study|studies|learn\w*|paper|flashcards|language|exam|textbook|fact-check|literature)\b/,
  ],
  [
    "business",
    /\b(business|marketing|launch|landing page|competitors?|press release|cash-flow|customer profiles|freelancer)\b/,
  ],
  ["work", /\b(meeting|handover|manager|status update|team|onboarding|workshop|policy|director|deadline)\b/],
];

export function guessCategory(job: string): BotCategory {
  const text = job.toLowerCase();
  for (const [category, re] of CATEGORY_WORDS) if (re.test(text)) return category;
  return "misc";
}

/** A pack from the job text alone. The same input always gives the same pack. */
export function templatePack(input: GenerateInput, ctx: GenerateContext): BotPack {
  const job = input.job
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  const name = truncateAtWord(input.name?.trim() || nameFromJob(job), MAX_NAME);
  const picked = toolsForJob(job, ctx.tools);
  const hinted = ctx.hints?.tools?.filter((t) => isPackTool(t) && ctx.tools.includes(t)) ?? [];
  const tools = hinted.length > 0 ? hinted : picked.tools;
  const connectors = ctx.hints?.connectors ?? picked.connectors;
  const pitch = truncateAtWord(sentence(job), MAX_PITCH);
  const toolWords = tools.map((t) => plainWords(t).replace(/ \(asks first\)$/, "")).join(", ");
  const instructions = `You help one person with this job: ${job}.

## How to work

- Start from what the person gives you. If something you need is missing (a date, a budget, a file, which account), ask one short question, then carry on.
- Do the work with your tools rather than describe it. You can: ${toolWords}.
- Keep a short record of what you found and what you did, in plain words.
- Say what you could not check. Never invent a fact, a price, a date or a name.
- Never call the person by a name they did not give.
- When a step finds nothing, say so and suggest one next step.
- If a tool is not connected or answers with an error, say so and do what you can without it.

## Before you finish

- Give the short answer first, then the detail under it.
- Anything that sends, pays, signs or deletes is shown to the person first. Prepare it fully and call the tool that does it; the approval card is where they decide.`;
  const readme = `# ${name}

${pitch}

## What it does

Works through the job with the tools it is given, shows what it found and says plainly what it could not check.

## What it needs

- Tools: ${tools.join(", ") || "none"}
- Connectors: ${connectors.join(", ") || "none"}

## What it will not do

It never sends, pays, signs or deletes anything without showing you first. That is Steward's rule, not the bot's.

AI-made from a template, not yet used by anyone. Licence: MIT.`;
  return {
    id: slugify(name),
    name,
    pitch,
    category: input.category ?? guessCategory(job),
    version: 1,
    author: { kind: "ai", model: "template", generated: dateOf(ctx) },
    licence: "MIT",
    needs: { tools, connectors, model: "any" },
    instructions,
    starters: [truncateAtWord(sentence(job), MAX_STARTER), "What do you need from me to get started?"],
    examples: [
      {
        ask: truncateAtWord(sentence(job), 300),
        does: "Works through the job with its tools, shows what it found, and says plainly what it could not check.",
      },
    ],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme,
  };
}

// ── The model path ─────────────────────────────────────────────────────────────────────────────

/** Turns the model's JSON into a pack candidate for the validator; nothing is trusted yet. */
export function assembleCandidate(
  raw: Record<string, unknown>,
  input: GenerateInput,
  ctx: GenerateContext,
): unknown {
  const name = truncateAtWord(input.name?.trim() || str(raw.name) || nameFromJob(input.job), MAX_NAME);
  const needs = (typeof raw.needs === "object" && raw.needs !== null ? raw.needs : {}) as Record<
    string,
    unknown
  >;
  const category =
    input.category ??
    (CATEGORY_KEYS.includes(raw.category as BotCategory) ? (raw.category as BotCategory) : undefined);
  const pitch = str(raw.pitch);
  const examples = Array.isArray(raw.examples)
    ? raw.examples
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
        .map((e) => ({ ask: str(e.ask) ?? "", does: str(e.does) ?? "" }))
        .filter((e) => e.ask && e.does && e.ask.length <= 300 && e.does.length <= 600)
        .slice(0, 8)
    : [];
  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
        .map((s) => ({
          name: slugify(str(s.name) ?? "skill"),
          description: str(s.description) ?? "",
          body: str(s.body) ?? "",
          ...(Array.isArray(s.allowedTools) ? { allowedTools: strings(s.allowedTools, 80) } : {}),
        }))
        .slice(0, 12)
    : [];
  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({
          name: str(r.name) ?? "rule",
          effect: r.effect,
          when: str(r.when) ?? "",
          description: str(r.description) ?? "",
        }))
        .slice(0, 12)
    : [];
  return {
    id: slugify(name),
    name,
    pitch: pitch ? truncateAtWord(pitch, MAX_PITCH) : undefined,
    category,
    version: 1,
    author: { kind: "ai", model: ctx.model?.label ?? "model", generated: dateOf(ctx) },
    licence: "MIT",
    needs: {
      tools: strings(needs.tools, 80),
      connectors: strings(needs.connectors, 80),
      model: str(needs.model) ?? "any",
    },
    instructions: str(raw.instructions),
    starters: strings(raw.starters, MAX_STARTER).slice(0, 8),
    examples,
    skills,
    rules,
    routines: [],
    shortcuts: [],
    readme: str(raw.readme) ?? "",
  };
}

/** Problems the shared validator does not know about: the tools a pack may never ask for. */
function packToolProblems(candidate: unknown): Problem[] {
  const tools = (candidate as { needs?: { tools?: unknown } })?.needs?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool, i) =>
    typeof tool === "string" && !isPackTool(tool)
      ? [
          {
            path: `needs.tools[${i}]`,
            message: `"${tool}" may not be used by a bot; leave it out`,
            severity: "error" as const,
          },
        ]
      : [],
  );
}

function check(
  candidate: unknown,
  ctx: GenerateContext,
): { ok: boolean; pack?: BotPack; problems: Problem[] } {
  const result = validatePack(candidate, ctx);
  const extra = packToolProblems(candidate);
  if (!(candidate as { category?: unknown })?.category) {
    extra.push({ path: "category", message: "pick one of the listed categories", severity: "error" });
  }
  const problems = [...result.problems, ...extra];
  return { ok: result.ok && extra.length === 0, pack: result.pack, problems };
}

async function askModel(model: TextModel, system: string, prompt: string): Promise<string> {
  return model.complete({ system, prompt, maxTokens: 6000 });
}

export async function generateBot(input: GenerateInput, ctx: GenerateContext): Promise<GenerateResult> {
  if (!ctx.model) {
    const pack = templatePack(input, ctx);
    const result = check(pack, ctx);
    return { pack: result.pack ?? pack, problems: result.problems, madeBy: "template" };
  }

  const system = buildGenerateSystem(ctx.tools);
  const prompt = buildGeneratePrompt(input, ctx.hints);
  let problems: Problem[] = [];
  let previous = "";
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await askModel(
        ctx.model,
        system,
        attempt === 0 ? prompt : buildRetryPrompt(prompt, previous, problems),
      );
      previous = answer;
      let raw: Record<string, unknown>;
      try {
        raw = parseJsonObject(answer);
      } catch (err) {
        if (!(err instanceof ModelJsonError)) throw err;
        problems = [{ path: "pack", message: err.message, severity: "error" }];
        continue;
      }
      const candidate = assembleCandidate(raw, input, ctx);
      const result = check(candidate, ctx);
      problems = result.problems;
      if (result.ok && result.pack) return { pack: result.pack, problems, madeBy: "model" };
    }
  } catch (err) {
    problems = [
      ...problems,
      {
        path: "pack",
        message: `the model could not be used: ${err instanceof Error ? err.message : String(err)}`,
        severity: "error",
      },
    ];
  }

  // The model's answer could not be made to pass: fall back to the template, and say so.
  const pack = templatePack(input, ctx);
  const result = check(pack, ctx);
  return {
    pack: result.pack ?? pack,
    problems: [
      ...problems,
      {
        path: "pack",
        message: "the model's answer did not pass, so a template pack was made instead",
        severity: "warn",
      },
      ...result.problems,
    ],
    madeBy: "template",
  };
}
