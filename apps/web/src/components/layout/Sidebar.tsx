import type { ReactNode } from "react";
import {
  Plug,
  BookOpen,
  Brain,
  FileText,
  History as HistoryIcon,
  LayoutList,
  Lock,
  Smartphone,
  MessageSquare,
  PhoneCall,
  Plus,
  PoundSterling,
  Puzzle,
  Settings as SettingsIcon,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { linkProps } from "@/router";

interface SidebarProps {
  /** The current route's first segment, e.g. `/missions`. */
  section: string;
  onNewChat?: () => void;
  onSelectChat?: (index: number) => void;
  history: string[];
  onClose?: () => void;
  width?: number;
  /** Who Tempo is working for, shown under the brand. */
  profileName?: string | null;
  /** Money and time returned so far (the Time Ledger), shown above Settings. */
  ledger?: { gbp: string; hours: string } | null;
}

const COMPACT_BELOW = 190;
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

export interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
}

/** The pages, in two groups (plan.md §2): what Tempo does, and why you can trust it. */
export const NAV_DOING: NavEntry[] = [
  { to: "/chat", label: "Chat", icon: <MessageSquare size={18} aria-hidden /> },
  { to: "/missions", label: "Mission Control", icon: <LayoutList size={18} aria-hidden /> },
  { to: "/memory", label: "Memory", icon: <Brain size={18} aria-hidden /> },
  { to: "/read", label: "Read It To Me", icon: <FileText size={18} aria-hidden /> },
  { to: "/owed", label: "Am I owed anything?", icon: <PoundSterling size={18} aria-hidden /> },
  { to: "/shield", label: "Scam Shield", icon: <ShieldAlert size={18} aria-hidden /> },
  { to: "/connectors", label: "Connectors", icon: <Plug size={18} aria-hidden /> },
];

export const NAV_TRUST: NavEntry[] = [
  { to: "/profiles", label: "Profiles", icon: <Users size={18} aria-hidden /> },
  { to: "/skills", label: "Skills", icon: <Puzzle size={18} aria-hidden /> },
  { to: "/callers", label: "Who's calling?", icon: <PhoneCall size={18} aria-hidden /> },
  { to: "/devices", label: "Devices", icon: <Smartphone size={18} aria-hidden /> },
  { to: "/privacy", label: "Privacy Proof", icon: <Lock size={18} aria-hidden /> },
  { to: "/story", label: "The story", icon: <BookOpen size={18} aria-hidden /> },
];

function NavItem({ entry, active, compact, onClick }: { entry: NavEntry; active: boolean; compact: boolean; onClick?: () => void }) {
  const link = linkProps(entry.to);
  return (
    <a
      {...link}
      onClick={(e) => {
        link.onClick(e);
        onClick?.();
      }}
      title={compact ? entry.label : undefined}
      aria-label={compact ? entry.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white transition-colors motion-reduce:transition-none ${focus} ${
        compact ? "justify-center" : ""
      } ${active ? "bg-nexus-nav-hi" : "hover:bg-nexus-nav-hi/70"}`}
    >
      {entry.icon}
      {!compact && <span className="truncate">{entry.label}</span>}
    </a>
  );
}

function Group({ title, entries, section, compact, onClose }: { title: string; entries: NavEntry[]; section: string; compact: boolean; onClose?: () => void }) {
  return (
    <div>
      {!compact && <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-indigo-200/80">{title}</p>}
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry) => (
          <li key={entry.to}>
            <NavItem entry={entry} active={section === entry.to} compact={compact} onClick={onClose} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sidebar({ section, onNewChat, onSelectChat, history, onClose, width, profileName, ledger }: SidebarProps) {
  const compact = width !== undefined && width < COMPACT_BELOW;
  const onChat = section === "/chat";

  return (
    <nav
      aria-label="Primary"
      style={width ? { width } : undefined}
      className={`flex h-full flex-col gap-4 overflow-hidden bg-nexus-nav p-4 text-white ${width ? "" : "w-72"}`}
    >
      {(!compact || onClose) && (
        <div className="flex items-start justify-between">
          {!compact && (
            <div>
              <a {...linkProps("/chat")} className={`text-lg font-semibold tracking-tight ${focus} rounded`}>Tempo</a>
              {profileName ? (
                <a {...linkProps("/profiles")} className={`block text-[11px] text-indigo-200/90 underline-offset-2 hover:underline ${focus} rounded`}>
                  Working for: {profileName}
                </a>
              ) : (
                <p className="text-[11px] text-indigo-200/80">Your time, returned.</p>
              )}
            </div>
          )}
          {onClose && (
            <button onClick={onClose} aria-label="Close menu" className={`rounded p-1 hover:bg-white/10 ${focus}`}>
              <X size={20} />
            </button>
          )}
        </div>
      )}

      <button
        onClick={() => {
          onNewChat?.();
          onClose?.();
        }}
        aria-label="New chat"
        title={compact ? "New chat" : undefined}
        className={`flex items-center gap-2 rounded-xl border border-white/30 px-3 py-2.5 text-sm font-medium hover:bg-white/10 ${focus} ${compact ? "justify-center" : ""}`}
      >
        <Plus size={18} aria-hidden /> {!compact && "New chat"}
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <Group title="Doing" entries={NAV_DOING} section={section} compact={compact} onClose={onClose} />
        <Group title="Trust" entries={NAV_TRUST} section={section} compact={compact} onClose={onClose} />

        {onChat && !compact && history.length > 0 && (
          <section aria-labelledby="history-heading">
            <h2 id="history-heading" className="mb-2 flex items-center gap-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-indigo-200/80">
              <HistoryIcon size={12} aria-hidden /> History
            </h2>
            <ul className="flex flex-col gap-1.5">
              {history.map((title, index) => (
                <li key={`${title}-${index}`}>
                  <button
                    onClick={() => {
                      onSelectChat?.(index);
                      onClose?.();
                    }}
                    className={`w-full truncate rounded-full bg-nexus-nav-hi px-4 py-2 text-left text-sm text-white hover:bg-nexus-badge ${focus}`}
                  >
                    {title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="border-t border-white/15 pt-3">
        {ledger && !compact && (
          <a
            {...linkProps("/missions")}
            onClick={(e) => {
              linkProps("/missions").onClick(e);
              onClose?.();
            }}
            className={`mb-2 block rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 ${focus}`}
            aria-label={`So far Tempo has got back £${ledger.gbp} and ${ledger.hours} hours of your time. Open Mission Control.`}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-indigo-200/80">Returned so far</span>
            <span className="text-sm font-semibold text-emerald-300">£{ledger.gbp}</span>
            <span className="text-xs text-indigo-100/80"> · {ledger.hours} h of your time</span>
          </a>
        )}
        <NavItem entry={{ to: "/settings", label: "Settings", icon: <SettingsIcon size={18} aria-hidden /> }} active={section === "/settings"} compact={compact} onClick={onClose} />
      </div>
    </nav>
  );
}
