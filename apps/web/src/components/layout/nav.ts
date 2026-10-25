// Every page, once (plan.md §2, §15, §19): the sidebar, the page titles and the ⌘K palette all
// read this list, so a page added here appears everywhere. Some pages stay hidden until L.
import {
  BookOpen,
  Brain,
  FileText,
  LayoutList,
  Lock,
  MessageSquare,
  PhoneCall,
  Plug,
  PoundSterling,
  Puzzle,
  Settings,
  ShieldAlert,
  Smartphone,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavEntry {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** One plain line for the palette and for search. */
  hint: string;
}

export const NAV_CHAT: NavEntry = { to: "/chat", label: "Chat", Icon: MessageSquare, hint: "Tell Tempo what happened" };
export const NAV_MEMORY: NavEntry = { to: "/memory", label: "Memory", Icon: Brain, hint: "What Tempo remembers, and forgetting" };

/** What Tempo does (shown in full once L is pressed). */
export const NAV_DOING: NavEntry[] = [
  { to: "/missions", label: "Mission Control", Icon: LayoutList, hint: "Every claim, its proof and its state" },
  { to: "/read", label: "Read It To Me", Icon: FileText, hint: "A letter or bill, read aloud in plain words" },
  { to: "/owed", label: "Am I owed anything?", Icon: PoundSterling, hint: "Ten questions, then what you could claim" },
  { to: "/shield", label: "Scam Shield", Icon: ShieldAlert, hint: "Is this text a trick?" },
  { to: "/connectors", label: "Connectors", Icon: Plug, hint: "Mail, calendar and bank, read-only" },
];

/** Why you can trust it (shown in full once L is pressed). */
export const NAV_TRUST: NavEntry[] = [
  { to: "/profiles", label: "Summary", Icon: Users, hint: "Who Tempo works for, and what it may do" },
  { to: "/skills", label: "Skills", Icon: Puzzle, hint: "The rule packs Tempo can use" },
  { to: "/callers", label: "Who's calling?", Icon: PhoneCall, hint: "How Tempo speaks to each caller" },
  { to: "/devices", label: "Devices", Icon: Smartphone, hint: "Face ID approvals on your phone" },
  { to: "/privacy", label: "Privacy Proof", Icon: Lock, hint: "Which companies see what" },
  { to: "/story", label: "The story", Icon: BookOpen, hint: "A guided demo in ten beats" },
];

export const NAV_SETTINGS: NavEntry = { to: "/settings", label: "Settings", Icon: Settings, hint: "Voice, text size, plain mode, Gateway" };

/** The pages kept out of sight until L is pressed (plan.md §19). A direct link still opens them. */
export const HIDDEN = new Set(["/missions", "/read", "/owed", "/shield", "/callers", "/devices", "/story"]);

export const NAV_ALL: NavEntry[] = [NAV_CHAT, NAV_MEMORY, ...NAV_DOING, ...NAV_TRUST, NAV_SETTINGS];

/** Every page the person can see now: the hidden ones only once L has been pressed. */
export function visibleNav(revealed: boolean): NavEntry[] {
  return revealed ? NAV_ALL : NAV_ALL.filter((entry) => !HIDDEN.has(entry.to));
}

/** The sidebar's groups under History and Memory: "More" by default, "Doing" and "Trust" once L is pressed. */
export function navGroups(revealed: boolean): { title: string; entries: NavEntry[] }[] {
  if (revealed) return [{ title: "Doing", entries: NAV_DOING }, { title: "Trust", entries: NAV_TRUST }];
  return [{ title: "More", entries: [...NAV_DOING, ...NAV_TRUST].filter((entry) => !HIDDEN.has(entry.to)) }];
}

export function navFor(section: string): NavEntry | undefined {
  return NAV_ALL.find((entry) => entry.to === section);
}
