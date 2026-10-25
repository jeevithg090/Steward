// Every page, once (plan.md §2, §15): the sidebar, the page titles and the ⌘K palette all read
// this list, so a page added here appears everywhere.
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

/** What Tempo does. */
export const NAV_DOING: NavEntry[] = [
  { to: "/chat", label: "Chat", Icon: MessageSquare, hint: "Tell Tempo what happened" },
  { to: "/missions", label: "Mission Control", Icon: LayoutList, hint: "Every claim, its proof and its state" },
  { to: "/memory", label: "Memory", Icon: Brain, hint: "What Tempo remembers, and forgetting" },
  { to: "/read", label: "Read It To Me", Icon: FileText, hint: "A letter or bill, read aloud in plain words" },
  { to: "/owed", label: "Am I owed anything?", Icon: PoundSterling, hint: "Ten questions, then what you could claim" },
  { to: "/shield", label: "Scam Shield", Icon: ShieldAlert, hint: "Is this text a trick?" },
  { to: "/connectors", label: "Connectors", Icon: Plug, hint: "Mail, calendar and bank, read-only" },
];

/** Why you can trust it. */
export const NAV_TRUST: NavEntry[] = [
  { to: "/profiles", label: "Profiles", Icon: Users, hint: "Who Tempo works for, and what it may do" },
  { to: "/skills", label: "Skills", Icon: Puzzle, hint: "The rule packs Tempo can use" },
  { to: "/callers", label: "Who's calling?", Icon: PhoneCall, hint: "How Tempo speaks to each caller" },
  { to: "/devices", label: "Devices", Icon: Smartphone, hint: "Face ID approvals on your phone" },
  { to: "/privacy", label: "Privacy Proof", Icon: Lock, hint: "Which companies see what" },
  { to: "/story", label: "The story", Icon: BookOpen, hint: "A guided demo in ten beats" },
];

export const NAV_SETTINGS: NavEntry = { to: "/settings", label: "Settings", Icon: Settings, hint: "Voice, text size, plain mode, Gateway" };

export const NAV_ALL: NavEntry[] = [...NAV_DOING, ...NAV_TRUST, NAV_SETTINGS];

export function navFor(section: string): NavEntry | undefined {
  return NAV_ALL.find((entry) => entry.to === section);
}
