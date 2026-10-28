import {
  Bot,
  Brain,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  Monitor,
  Plug,
  Repeat,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Sunrise,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match only this exact path (Today), not everything under it. */
  end?: boolean;
  /** In the phone's bottom bar; the rest sit under More. */
  primary?: boolean;
  /** Keyboard shortcut after `g`. */
  shortcut?: string;
  description: string;
}

/** Every place in the app, in the order the rail lists them. */
export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Today",
    icon: Sunrise,
    end: true,
    primary: true,
    shortcut: "t",
    description: "Your brief and what needs you",
  },
  {
    to: "/chat",
    label: "Chat",
    icon: MessageSquare,
    primary: true,
    shortcut: "c",
    description: "Talk to Steward",
  },
  {
    to: "/bots",
    label: "Bots",
    icon: Bot,
    shortcut: "b",
    description: "Ready-made helpers you can add",
  },
  {
    to: "/tasks",
    label: "Tasks",
    icon: ListChecks,
    primary: true,
    shortcut: "k",
    description: "Work Steward is doing or could do",
  },
  {
    to: "/computer",
    label: "Computer",
    icon: Monitor,
    primary: true,
    shortcut: "o",
    description: "Steward's own screen and files",
  },
  {
    to: "/routines",
    label: "Routines",
    icon: Repeat,
    shortcut: "u",
    description: "Work on a schedule",
  },
  {
    to: "/rules",
    label: "Rules",
    icon: ShieldCheck,
    shortcut: "r",
    description: "What Steward may do without asking",
  },
  {
    to: "/record",
    label: "Record",
    icon: ScrollText,
    shortcut: "l",
    description: "Everything Steward did, decided or was refused",
  },
  {
    to: "/connections",
    label: "Connections",
    icon: Plug,
    description: "Mail, calendar and connected apps",
  },
  {
    to: "/skills",
    label: "Skills",
    icon: Sparkles,
    description: "Instructions you call with /",
  },
  {
    to: "/memory",
    label: "Memory",
    icon: Brain,
    description: "What Steward remembers about you",
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    shortcut: "s",
    description: "Model, accessibility and setup",
  },
];
