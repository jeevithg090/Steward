import { scanForInjection } from "@steward/bots";
import type { BotCategory, BotPack } from "@steward/shared";
import { isMostlyLatin, slugify, truncateAtWord } from "../text.ts";

/**
 * LobeChat's agent index (github.com/lobehub/lobe-chat-agents, MIT): 505 JSON files, schema v1.
 * `systemRole` becomes the instructions, `openingQuestions` the starters, `examples` the examples,
 * and every pack credits its author. They are prompt-only, so `needs.tools` is empty and the
 * listing says "chat only"; a research tag adds web search.
 */

export const LOBE_SOURCE = "https://github.com/lobehub/lobe-chat-agents";
export const LOBE_RAW_BASE = "https://raw.githubusercontent.com/lobehub/lobe-chat-agents/main/src/";
export const LOBE_CONTENTS_API = "https://api.github.com/repos/lobehub/lobe-chat-agents/contents/src";

/** LobeChat's `meta.category` → ours. Tags are looked at first (`LOBE_TAG_MAP`). */
export const LOBE_CATEGORY_MAP: Record<string, BotCategory> = {
  academic: "research",
  career: "work",
  copywriting: "business",
  design: "social",
  education: "research",
  emotions: "health",
  entertainment: "games",
  games: "games",
  general: "misc",
  life: "misc",
  marketing: "business",
  office: "productivity",
  programming: "dev",
  translation: "productivity",
};

/** Ordered: the first category whose tag list contains one of the agent's tags wins. */
export const LOBE_TAG_MAP: readonly [BotCategory, readonly string[]][] = [
  ["food", ["food", "cooking", "recipe", "recipes", "culinary", "nutrition", "diet", "meal-planning"]],
  [
    "health",
    [
      "fitness",
      "health",
      "medical",
      "wellness",
      "well-being",
      "mental-health",
      "psychology",
      "therapy",
      "meditation",
      "exercise",
      "sleep",
    ],
  ],
  [
    "investing",
    ["investing", "investment", "stocks", "stock", "crypto", "cryptocurrency", "trading", "portfolio"],
  ],
  [
    "money",
    [
      "finance",
      "financial",
      "money",
      "budget",
      "budgeting",
      "accounting",
      "tax",
      "taxes",
      "invoice",
      "personal-finance",
    ],
  ],
  ["privacy", ["privacy", "security", "cybersecurity", "scam", "fraud", "phishing"]],
  ["sports", ["sports", "sport", "football", "soccer", "basketball", "fantasy-sports", "running", "cycling"]],
  ["travel", ["travel", "trip", "tourism", "car", "cars", "driving", "flights"]],
  [
    "video-audio",
    [
      "video",
      "audio",
      "podcast",
      "music",
      "voice",
      "subtitles",
      "subtitle",
      "youtube",
      "film",
      "video-editing",
      "screenwriting",
    ],
  ],
  [
    "social",
    [
      "social-media",
      "instagram",
      "tiktok",
      "content-creation",
      "content-creator",
      "influencer",
      "twitter",
      "xiaohongshu",
      "creator",
      "branding",
    ],
  ],
  [
    "sales-crm",
    [
      "sales",
      "crm",
      "customer-service",
      "customer-support",
      "lead-generation",
      "leads",
      "ecommerce",
      "e-commerce",
      "amazon",
    ],
  ],
  [
    "bot-helpers",
    [
      "prompt",
      "prompts",
      "prompt-engineering",
      "prompt-generation",
      "agent",
      "agents",
      "chatbot",
      "ai-assistant",
      "gpt",
      "system-prompt",
    ],
  ],
  [
    "dev",
    [
      "code",
      "coding",
      "programming",
      "software-development",
      "software-engineering",
      "developer",
      "python",
      "java-script",
      "javascript",
      "type-script",
      "typescript",
      "react",
      "next-js",
      "sql",
      "git",
      "api",
      "web-development",
      "full-stack-development",
      "testing",
      "deployment",
      "devops",
      "debugging",
      "game-development",
    ],
  ],
  [
    "home",
    [
      "home",
      "family",
      "parenting",
      "kids",
      "children",
      "pets",
      "garden",
      "gardening",
      "household",
      "real-estate",
      "housing",
    ],
  ],
  [
    "games",
    [
      "game",
      "games",
      "roleplay",
      "role-play",
      "entertainment",
      "fun",
      "story",
      "storytelling",
      "interactive-fiction",
      "text-adventure",
      "puzzle",
    ],
  ],
  [
    "business",
    [
      "marketing",
      "business",
      "startup",
      "entrepreneurship",
      "seo",
      "advertising",
      "copywriting",
      "brand-development",
      "market-analysis",
      "strategic-planning",
      "product-management",
    ],
  ],
  [
    "work",
    [
      "career",
      "resume",
      "interview",
      "hr",
      "recruiting",
      "job-search",
      "project-management",
      "team",
      "meetings",
      "leadership",
      "management",
    ],
  ],
  [
    "productivity",
    [
      "productivity",
      "email",
      "notes",
      "note-taking",
      "calendar",
      "todo",
      "office",
      "writing-assistant",
      "summary",
      "summarization",
      "translation",
      "translator",
    ],
  ],
  [
    "research",
    [
      "research",
      "academic",
      "academic-writing",
      "study",
      "learning",
      "education",
      "teaching",
      "language-learning",
      "english",
      "english-learning",
      "vocabulary",
      "science",
      "math",
      "mathematics",
      "history",
      "philosophy",
      "tutor",
      "language",
    ],
  ],
];

export function lobeCategory(meta: { category?: string; tags?: string[] }): BotCategory {
  const tags = new Set((meta.tags ?? []).map((t) => t.toLowerCase().trim()));
  for (const [category, words] of LOBE_TAG_MAP) if (words.some((w) => tags.has(w))) return category;
  const mapped = meta.category ? LOBE_CATEGORY_MAP[meta.category.toLowerCase()] : undefined;
  return mapped ?? "misc";
}

/** `name.json` and `name.en-GB.json` are English; `name.zh-CN.json` and the like are not. */
export function isEnglishLobeFile(file: string): boolean {
  const base = file.replace(/^.*\//, "");
  if (!base.endsWith(".json")) return false;
  const parts = base.slice(0, -5).split(".");
  if (parts.length === 1) return true;
  const locale = parts[parts.length - 1] ?? "";
  return /^en(?:-[A-Za-z]{2})?$/.test(locale);
}

const RESEARCH_TAGS = new Set([
  "research",
  "web-search",
  "search",
  "fact-checking",
  "fact-check",
  "news",
  "market-analysis",
]);
const MIN_INSTRUCTIONS = 80;
const MAX_INSTRUCTIONS = 20_000;

export type LobeConversion = { ok: true; pack: BotPack } | { ok: false; reason: string };

interface LobeAgent {
  author?: string;
  homepage?: string;
  identifier?: string;
  createdAt?: string;
  schemaVersion?: number;
  config?: { systemRole?: string; openingMessage?: string; openingQuestions?: string[] };
  examples?: { role?: string; content?: string }[];
  meta?: { title?: string; description?: string; tags?: string[]; category?: string };
  summary?: string;
}

function urlOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One LobeChat agent file → a pack, or the reason it was skipped: not English, too short, too long,
 * or text that reads as orders for the model. `file` is only used for the language check.
 */
export function convertLobeAgent(json: unknown, opts: { file?: string } = {}): LobeConversion {
  if (opts.file && !isEnglishLobeFile(opts.file)) return { ok: false, reason: "not English (file name)" };
  if (typeof json !== "object" || json === null) return { ok: false, reason: "not a JSON object" };
  const agent = json as LobeAgent;
  const title = agent.meta?.title?.trim();
  const description = agent.meta?.description?.trim();
  const instructions = agent.config?.systemRole?.trim() ?? "";
  const identifier = agent.identifier?.trim();
  if (!title || !description || !identifier)
    return { ok: false, reason: "missing title, description or identifier" };
  if (!isMostlyLatin(`${title} ${description} ${instructions.slice(0, 400)}`))
    return { ok: false, reason: "not English (text)" };
  if (instructions.length < MIN_INSTRUCTIONS)
    return { ok: false, reason: `instructions under ${MIN_INSTRUCTIONS} characters` };
  if (instructions.length > MAX_INSTRUCTIONS)
    return { ok: false, reason: `instructions over ${MAX_INSTRUCTIONS} characters` };
  const scan = scanForInjection(`${instructions}\n${description}`);
  if (scan.hits.length > 0)
    return { ok: false, reason: `injection scan: ${scan.hits.map((h) => h.pattern).join(", ")}` };

  const author = agent.author?.trim() || "unknown";
  const homepage = urlOf(agent.homepage);
  const tags = (agent.meta?.tags ?? []).map((t) => t.toLowerCase());
  const category = lobeCategory({ category: agent.meta?.category, tags });
  const research = tags.some((t) => RESEARCH_TAGS.has(t));
  const starters = (agent.config?.openingQuestions ?? [])
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && q.length <= 300)
    .slice(0, 8);
  const examples: BotPack["examples"] = [];
  const turns = agent.examples ?? [];
  for (let i = 0; i + 1 < turns.length && examples.length < 3; i++) {
    const ask = turns[i];
    const reply = turns[i + 1];
    if (ask?.role !== "user" || reply?.role !== "assistant") continue;
    const askText = ask.content?.trim() ?? "";
    const does = reply.content?.trim() ?? "";
    if (!askText || !does || askText.length > 300) continue;
    i++;
    // An example with a template token or a zero-width character would fail the pack; leave it out.
    if (scanForInjection(`${askText}\n${does}`).hits.length > 0) continue;
    examples.push({ ask: askText, does: truncateAtWord(does, 600) });
  }
  const name = truncateAtWord(title, 80);
  const readme = `# ${name}

${description}

${agent.summary?.trim() ? `${agent.summary.trim()}\n\n` : ""}## What it needs

${research ? "Web search, for looking things up. Otherwise it works from the conversation." : "Nothing: this bot is chat only. It works from what you tell it and uses no tools."}

## Credit

Adapted from LobeChat's agent index (MIT), by ${author}${homepage ? ` (${homepage})` : ""}. Source: ${LOBE_SOURCE}.`;

  return {
    ok: true,
    pack: {
      id: slugify(`lobe-${identifier}`),
      name,
      pitch: truncateAtWord(description, 240),
      category,
      version: 1,
      author: { kind: "person", handle: truncateAtWord(author, 80), ...(homepage ? { url: homepage } : {}) },
      licence: "MIT",
      needs: { tools: research ? ["web_search", "web_fetch"] : [], connectors: [], model: "any" },
      instructions,
      starters,
      examples,
      skills: [],
      rules: [],
      routines: [],
      shortcuts: [],
      readme,
    },
  };
}
