import {
  BOT_CATEGORIES,
  type BotAuthor,
  type BotListing,
  type BotPack,
  isBuiltinTool,
  parseMcpToolName,
  TOOL_PLAIN_WORDS,
  TOOLS,
  type ToolSurface,
} from "@steward/shared";
import {
  Brain,
  Calendar,
  Folder,
  Globe,
  ListChecks,
  type LucideIcon,
  Mail,
  MessageSquare,
  Monitor,
  Plug,
  Terminal,
} from "lucide-react";
import { toolLabel } from "@/lib/labels.ts";
import { plural } from "@/lib/utils.ts";

/**
 * Plain words and small decisions the bots screens share: who made a bot, what it needs, where a
 * pack may be fetched from. Nothing here talks to the server.
 */

/** "AI-made" or "by <handle>": the author line on a card. */
export function authorLabel(author: BotAuthor | undefined): string {
  if (!author) return "Unknown author";
  return author.kind === "ai" ? "AI-made" : `by ${author.handle}`;
}

/** The category's words, from the directory's own list when it sent one. */
export function categoryLabel(id: string | undefined, categories?: Record<string, string>): string {
  if (!id) return "";
  return categories?.[id] ?? (BOT_CATEGORIES as Record<string, string>)[id] ?? id;
}

/** "12 added · 3 use it", or "Not yet used by anyone" for a bot nobody has added. */
export function countsLine(listing: Pick<BotListing, "installs" | "usedBy"> | undefined): string {
  if (!listing) return "";
  const installs = Number(listing.installs) || 0;
  const usedBy = Number(listing.usedBy) || 0;
  if (installs === 0 && usedBy === 0) return "Not yet used by anyone";
  const parts = [`${installs} added`];
  if (usedBy > 0) parts.push(`${usedBy} ${usedBy === 1 ? "person uses" : "use"} it`);
  return parts.join(" · ");
}

export interface Need {
  key: string;
  /** Short words, e.g. "your mail". */
  label: string;
  icon: LucideIcon;
  /** `mail`, `calendar` or an MCP server id when the need is a connector. */
  connector?: string;
}

const SURFACE_NEEDS: Partial<Record<ToolSurface, { label: string; icon: LucideIcon }>> = {
  browser: { label: "its browser", icon: Monitor },
  mail: { label: "your mail", icon: Mail },
  calendar: { label: "your calendar", icon: Calendar },
  web: { label: "the web", icon: Globe },
  file: { label: "its files", icon: Folder },
  shell: { label: "commands", icon: Terminal },
  memory: { label: "memory", icon: Brain },
  task: { label: "tasks", icon: ListChecks },
  mcp: { label: "a connected app", icon: Plug },
};

const CONNECTOR_NEEDS: Record<string, { label: string; icon: LucideIcon }> = {
  mail: { label: "your mail", icon: Mail },
  calendar: { label: "your calendar", icon: Calendar },
};

/** The icons on a card: one per thing the bot reaches, connectors first. "Chat only" when it reaches nothing. */
export function needsOf(needs: BotPack["needs"] | undefined): Need[] {
  const out = new Map<string, Need>();
  for (const connector of needs?.connectors ?? []) {
    const known = CONNECTOR_NEEDS[connector];
    out.set(connector, {
      key: connector,
      label: known?.label ?? connector,
      icon: known?.icon ?? Plug,
      connector,
    });
  }
  for (const tool of needs?.tools ?? []) {
    const surface: ToolSurface | undefined = isBuiltinTool(tool)
      ? TOOLS[tool].surface
      : parseMcpToolName(tool)
        ? "mcp"
        : undefined;
    if (!surface) continue;
    const need = SURFACE_NEEDS[surface];
    if (!need) continue;
    // A connector already stands for its surface ("your mail" once, not twice).
    if (out.has(surface)) continue;
    out.set(surface, { key: surface, label: need.label, icon: need.icon });
  }
  if (out.size === 0) return [{ key: "chat", label: "chat only", icon: MessageSquare }];
  return [...out.values()];
}

/** Every tool as a short phrase, deduplicated: "browse the web", "read your mail", "notion: search pages". */
export function toolWords(tools: string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const tool of tools ?? []) {
    const words = TOOL_PLAIN_WORDS[tool] ?? toolLabel(tool).toLowerCase();
    seen.add(words);
  }
  return [...seen];
}

/** "Your mail", "Your calendar", or the connected app's id. */
export function connectorLabel(id: string): string {
  if (id === "mail") return "Your mail";
  if (id === "calendar") return "Your calendar";
  return `${id} (a connected app)`;
}

export type PackSource =
  | { kind: "https"; host: string }
  /** A file on this computer, or a path the server resolves against its directory. */
  | { kind: "local"; where: string }
  | { kind: "refused"; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Where a pack address points. Only https addresses and local files are accepted: a plain http
 * address could be changed on the way, and anything else is not a place a pack lives.
 */
export function packSource(address: string | null | undefined): PackSource {
  const text = (address ?? "").trim();
  if (!text) return { kind: "refused", reason: "No pack address was given." };
  if (text.startsWith("file:")) return { kind: "local", where: "a file on this computer" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { kind: "refused", reason: `“${shorten(text)}” is not an address Steward can read.` };
    }
    if (url.protocol === "https:") return { kind: "https", host: url.host };
    if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) {
      return { kind: "local", where: `this computer (${url.host})` };
    }
    return {
      kind: "refused",
      reason: `Steward only adds bots from https addresses or from a file on this computer. “${shorten(text)}” is neither.`,
    };
  }
  // No scheme: a path, absolute or relative to the directory the server reads.
  return { kind: "local", where: "a file on this computer" };
}

function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** "This bot comes from bots.steward.dev" / "…from a file on this computer". */
export function sourceLine(source: PackSource): string {
  if (source.kind === "https") return `This bot comes from ${source.host}.`;
  if (source.kind === "local") return `This bot comes from ${source.where}.`;
  return source.reason;
}

/** A sentence for the version and when the listing last changed. */
export function versionLine(version: number | undefined, updatedAt?: string): string {
  const parts: string[] = [];
  if (version) parts.push(`Version ${version}`);
  if (updatedAt) {
    const date = new Date(updatedAt);
    if (!Number.isNaN(date.getTime())) {
      parts.push(
        `updated ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`,
      );
    }
  }
  return parts.join(", ");
}

/** "3 skills", "1 rule": how much a pack brings, for the card. */
export function bringsLine(pack: Pick<BotPack, "skills" | "rules" | "routines"> | undefined): string {
  if (!pack) return "";
  const parts: string[] = [];
  if (pack.skills?.length) parts.push(plural(pack.skills.length, "skill"));
  if (pack.rules?.length) parts.push(plural(pack.rules.length, "rule"));
  if (pack.routines?.length) parts.push(plural(pack.routines.length, "routine"));
  return parts.join(" · ");
}
