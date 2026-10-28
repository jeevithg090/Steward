import { z } from "zod";
import type { CatalogueEntry } from "./phone.ts";

/**
 * Bots: ready-made agents from the directory (docs/plans/bot-directory.md). A bot is a pack: a
 * profile, skills in the Agent Skills `SKILL.md` format, rules that may only tighten the gateway,
 * starters, routines and phone launchers. Installing one adds an agent to this Steward; removing
 * it takes away what it brought and nothing else.
 */

/** The eighteen jobs from meetmybot's taxonomy plus `work` for coworkers. */
export const BOT_CATEGORIES = {
  food: "Food & cooking",
  health: "Health & fitness",
  money: "Money & finance",
  investing: "Investing & crypto",
  productivity: "Email & productivity",
  dev: "Developers & tools",
  social: "Social & creators",
  "video-audio": "Video & audio",
  research: "Research & learning",
  home: "Home & family",
  privacy: "Privacy & scams",
  "bot-helpers": "Build & manage bots",
  games: "Games & fun",
  sports: "Sports & fantasy",
  travel: "Travel & cars",
  business: "Business & marketing",
  "sales-crm": "Sales & CRM",
  work: "Work & teams",
  misc: "Everyday tasks",
} as const;

export type BotCategory = keyof typeof BOT_CATEGORIES;

const botId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lowercase letters, digits and single hyphens")
  .refine((s) => !s.includes("--"), "no double hyphens");

/** One skill as the Agent Skills spec defines it: `SKILL.md` frontmatter plus the body. */
export const SkillPackSchema = z.object({
  name: botId,
  description: z.string().min(1).max(1024),
  body: z.string().min(1).max(40_000),
  license: z.string().max(120).optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string()).optional(),
  /** `allowed-tools`, split on spaces. Only ever narrows what the agent holds. */
  allowedTools: z.array(z.string()).optional(),
});
export type SkillPack = z.infer<typeof SkillPackSchema>;

export const BotAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ai"), model: z.string().min(1), generated: z.string().min(1) }),
  z.object({
    kind: z.literal("person"),
    handle: z.string().min(1).max(80),
    url: z.string().url().optional(),
    /** Set when a person claimed and improved an AI-made draft. */
    basedOnAi: z.boolean().optional(),
  }),
]);
export type BotAuthor = z.infer<typeof BotAuthorSchema>;

/** A rule a pack brings. `allow` is refused on purpose: a bot can only tighten the gateway. */
export const BotRuleSchema = z.object({
  name: z.string().min(1).max(120),
  effect: z.enum(["ask", "deny"]),
  when: z.string().min(1).max(2000),
  description: z.string().max(500).default(""),
});

export const BotPackSchema = z.object({
  id: botId,
  name: z.string().min(1).max(80),
  pitch: z.string().min(1).max(240),
  category: z.enum(Object.keys(BOT_CATEGORIES) as [BotCategory, ...BotCategory[]]),
  version: z.number().int().min(1),
  author: BotAuthorSchema,
  licence: z.string().min(1).max(120),
  needs: z.object({
    tools: z.array(z.string()).default([]),
    /** `mail`, `calendar`, or an MCP server id. */
    connectors: z.array(z.string()).default([]),
    /** `any`, or a sentence such as "a model that uses tools well". */
    model: z.string().min(1).max(200).default("any"),
  }),
  instructions: z.string().min(1).max(20_000),
  starters: z.array(z.string().min(1).max(300)).max(8).default([]),
  examples: z
    .array(z.object({ ask: z.string().min(1).max(300), does: z.string().min(1).max(600) }))
    .max(8)
    .default([]),
  skills: z.array(SkillPackSchema).max(12).default([]),
  rules: z.array(BotRuleSchema).max(12).default([]),
  /** Installed switched off. */
  routines: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        prompt: z.string().min(1).max(4000),
        schedule: z.string().min(1).max(120),
      }),
    )
    .max(6)
    .default([]),
  /** Phone launchers (docs/plans/phone-and-shortcuts.md §4.3). */
  shortcuts: z.array(z.custom<CatalogueEntry>()).max(6).default([]),
  /** The listing text written for people, Markdown. */
  readme: z.string().max(40_000).default(""),
  /** sha256 of the canonical pack without this field; set by the builder. */
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type BotPack = z.infer<typeof BotPackSchema>;

/** One row of a directory index: enough for a card, with where to get the pack. */
export interface BotListing {
  id: string;
  name: string;
  pitch: string;
  category: BotCategory;
  version: number;
  author: BotAuthor;
  needs: BotPack["needs"];
  installs: number;
  usedBy: number;
  updatedAt: string;
  /** Where the full pack is: an https URL or a path relative to the index. */
  packUrl: string;
  pageUrl?: string;
}

export interface DirectoryIndex {
  name: string;
  /** Where this index came from, for credit lines. */
  site?: string;
  generatedAt: string;
  categories: Record<string, string>;
  bots: BotListing[];
}

/** What installing a pack created in this Steward, so removal takes away exactly that. */
export interface InstalledBot {
  id: string;
  name: string;
  version: number;
  hash: string;
  /** The index or pack URL it came from, or `local` for Make a bot. */
  source: string;
  installedAt: string;
  updatedAt: string;
  agentId: string;
  skillIds: string[];
  ruleIds: string[];
  routineIds: string[];
  /** A newer version seen in the directory, when there is one. */
  updateAvailable?: { version: number; packUrl: string };
}

/** What the person sees before Add: the pack, and what it would mean for *their* setup. */
export interface BotPreview {
  pack: BotPack;
  /** "browse the web", "read your mail": derived from the tools and the current rules. */
  mayDoWithoutAsking: string[];
  /** Always includes sending, paying and signing; plus whatever the pack's rules add. */
  asksBefore: string[];
  /** Connectors the pack needs that are not connected: "mail". */
  needsMissing: string[];
  /** Tools the pack names that this Steward does not have. */
  toolsMissing: string[];
  alreadyInstalled?: InstalledBot;
  /** What validation noticed. An `error` here means Add is refused; a `warn` is shown. */
  problems?: BotProblem[];
}

export interface BotProblem {
  path: string;
  message: string;
  severity: "error" | "warn";
}

/** The body of `GET /api/bots`. */
export interface BotsResponse {
  bots: (BotListing & { installed?: InstalledBot })[];
  total: number;
  categories: Record<string, string>;
}

// ── Request bodies ─────────────────────────────────────────────────────────────────────────────

export const BotPreviewBody = z
  .object({
    packUrl: z.string().min(1).max(2048).optional(),
    pack: BotPackSchema.optional(),
  })
  .refine((b) => b.packUrl || b.pack, "Give a pack or its URL");

export const BotInstallBody = BotPreviewBody;

export const BotMakeBody = z.object({
  /** What the bot should do, in the person's words. */
  job: z.string().min(3).max(600),
  name: z.string().min(1).max(80).optional(),
  category: z.enum(Object.keys(BOT_CATEGORIES) as [BotCategory, ...BotCategory[]]).optional(),
});

export const BotsQuery = z.object({
  q: z.string().max(200).optional(),
  category: z.enum(Object.keys(BOT_CATEGORIES) as [BotCategory, ...BotCategory[]]).optional(),
  sort: z.enum(["new", "used", "installs", "match"]).default("match"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Plain words for a tool, for "what it may do" lines. */
export const TOOL_PLAIN_WORDS: Record<string, string> = {
  browser_navigate: "browse the web on its own computer",
  browser_snapshot: "read web pages",
  browser_click: "click on web pages",
  browser_type: "type into web pages",
  web_search: "search the web",
  web_fetch: "read web pages",
  mail_list: "read your mail",
  mail_read: "read your mail",
  mail_send: "send email (asks first)",
  calendar_list: "read your calendar",
  calendar_create: "add calendar events (asks first)",
  file_read: "read files in its workspace",
  file_write: "write files in its workspace",
  shell_run: "run commands (asks first)",
  memory_remember: "remember facts about you",
  task_create: "add tasks",
  routine_create: "add routines",
  make_page: "make pages and documents",
  directory_find: "look up bots in the directory",
};
