import type { ReactNode } from "react";
import { Brain, History as HistoryIcon, Plus, Settings as SettingsIcon, UserCircle, X } from "lucide-react";
import type { View } from "../../types/types";

interface SidebarProps {
  view: View;
  onNavigate: (view: View) => void;
  onNewChat?: () => void;
  onSelectChat?: (index: number) => void;
  history: string[];
  onClose?: () => void;
  width?: number;
}

const COMPACT_BELOW = 190;
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

interface NavItemProps {
  active?: boolean;
  compact: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}

function NavItem({ active, compact, icon, label, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={compact ? label : undefined}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white transition-colors ${focus} ${
        compact ? "justify-center" : ""
      } ${active ? "bg-nexus-nav-hi" : "hover:bg-nexus-nav-hi/70"}`}
    >
      {icon}
      {!compact && label}
    </button>
  );
}

export function Sidebar({ view, onNavigate, onNewChat, onSelectChat, history, onClose, width }: SidebarProps) {
  const compact = width !== undefined && width < COMPACT_BELOW;

  const go = (v: View) => {
    onNavigate(v);
    onClose?.();
  };

  const handleNewChat = () => {
    onNewChat?.();
    go("chat");
  };

  // Pass the index, not the title, so duplicate titles still open the right conversation.
  const handleSelectHistory = (index: number) => {
    onSelectChat?.(index);
    go("chat");
  };

  return (
    <nav
      aria-label="Primary"
      style={width ? { width } : undefined}
      className={`flex h-full flex-col gap-6 overflow-hidden bg-nexus-nav p-4 text-white ${width ? "" : "w-72"}`}
    >
      {(!compact || onClose) && (
        <div className="flex items-center justify-between">
          {!compact && <span className="text-lg font-semibold tracking-tight">Nexus</span>}
          {onClose && (
            <button onClick={onClose} aria-label="Close menu" className="rounded p-1 hover:bg-white/10">
              <X size={20} />
            </button>
          )}
        </div>
      )}

      <button
        onClick={handleNewChat}
        aria-label="New Chat"
        title={compact ? "New Chat" : undefined}
        className={`flex items-center gap-2 rounded-xl border border-white/30 px-3 py-2.5 text-sm font-medium hover:bg-white/10 ${focus} ${
          compact ? "justify-center" : ""
        }`}
      >
        <Plus size={18} /> {!compact && "New Chat"}
      </button>

      <section className="min-h-0 flex-1 overflow-y-auto">
        <h2
          title={compact ? "History" : undefined}
          className={`mb-3 flex items-center gap-2 px-1 text-sm font-medium text-indigo-200 ${compact ? "justify-center" : ""}`}
        >
          <HistoryIcon size={16} /> {!compact && "History"}
        </h2>
        {!compact && (
          <ul className="flex flex-col gap-2">
            {history.map((title, index) => (
              <li key={`${title}-${index}`}>
                <button
                  onClick={() => handleSelectHistory(index)}
                  className={`w-full truncate rounded-full bg-nexus-nav-hi px-4 py-2 text-left text-sm text-white hover:bg-nexus-badge ${focus}`}
                >
                  {title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-1 border-t border-white/15 pt-4">
        <NavItem compact={compact} active={view === "memory"} icon={<Brain size={18} />} label="Memory" onClick={() => go("memory")} />
        <NavItem compact={compact} active={view === "settings"} icon={<SettingsIcon size={18} />} label="Settings" onClick={() => go("settings")} />
        <NavItem compact={compact} icon={<UserCircle size={18} />} label="Account" />
      </div>
    </nav>
  );
}