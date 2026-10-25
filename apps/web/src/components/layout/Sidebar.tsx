import { History as HistoryIcon, Plus, Sparkles, X } from "lucide-react";
import { linkProps } from "@/router";
import { TempoMark } from "../ui/TempoMark";
import { NAV_DOING, NAV_SETTINGS, NAV_TRUST, type NavEntry } from "./nav";

export { NAV_DOING, NAV_TRUST, type NavEntry } from "./nav";

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
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-300";

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
      className={`group relative flex h-9 w-full items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors duration-150 motion-reduce:transition-none ${focus} ${
        compact ? "justify-center" : ""
      } ${active ? "bg-gradient-to-r from-accent-500/[0.18] via-accent-500/[0.07] to-transparent font-medium text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"}`}
    >
      {active && <span aria-hidden className="absolute -left-4 top-1.5 h-6 w-[3px] rounded-r-full bg-gradient-to-b from-accent-300 to-accent-500 shadow-[0_0_12px_rgb(var(--accent-400)/0.8)]" />}
      <entry.Icon size={18} strokeWidth={1.75} aria-hidden className={active ? "text-accent-200" : "text-slate-500 transition-colors group-hover:text-slate-300"} />
      {!compact && <span className="truncate">{entry.label}</span>}
    </a>
  );
}

function Group({ title, entries, section, compact, onClose }: { title: string; entries: NavEntry[]; section: string; compact: boolean; onClose?: () => void }) {
  return (
    <div>
      {!compact && <p className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>}
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
      className={`relative flex h-full flex-col gap-5 overflow-hidden border-r border-white/[0.06] bg-ink-900/80 p-4 text-white backdrop-blur-xl ${width ? "" : "w-72"}`}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(80%_100%_at_20%_0%,rgb(var(--accent-600)/0.18),transparent)]" />

      <div className={`relative flex items-center ${compact ? "justify-center" : "justify-between"}`}>
        <a {...linkProps("/chat")} className={`flex min-w-0 items-center gap-3 rounded-xl ${focus}`} aria-label={compact ? "Tempo, back to the chat" : undefined}>
          <TempoMark size={36} className="shrink-0 drop-shadow-[0_8px_18px_rgb(var(--accent-600)/0.45)]" />
          {!compact && (
            <span className="min-w-0">
              <span className="block font-display text-[1.6rem] leading-none text-white">Tempo</span>
              <span className="mt-1 block truncate text-[11px] text-slate-400">Your time, returned.</span>
            </span>
          )}
        </a>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" className={`rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white ${focus}`}>
            <X size={20} />
          </button>
        )}
      </div>

      {profileName && !compact && (
        <a
          {...linkProps("/profiles")}
          className={`relative -mt-2 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[12px] text-slate-300 hover:border-white/15 hover:text-white ${focus}`}
        >
          <Sparkles size={13} className="text-accent-300" aria-hidden />
          <span className="truncate">Working for: {profileName}</span>
        </a>
      )}

      <button
        onClick={() => {
          onNewChat?.();
          onClose?.();
        }}
        aria-label="New chat"
        title={compact ? "New chat" : undefined}
        className={`relative flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-100 shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset] transition-colors hover:border-accent-300/30 hover:bg-accent-500/10 ${focus} ${compact ? "justify-center" : ""}`}
      >
        <span className="grid h-5 w-5 place-items-center rounded-md bg-accent-500/25 text-accent-100">
          <Plus size={14} aria-hidden />
        </span>
        {!compact && "New chat"}
      </button>

      <div className="relative -mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        <Group title="Doing" entries={NAV_DOING} section={section} compact={compact} onClose={onClose} />
        <Group title="Trust" entries={NAV_TRUST} section={section} compact={compact} onClose={onClose} />

        {onChat && !compact && history.length > 0 && (
          <section aria-labelledby="history-heading">
            <h2 id="history-heading" className="mb-1.5 flex items-center gap-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <HistoryIcon size={12} aria-hidden /> History
            </h2>
            <ul className="flex flex-col gap-0.5">
              {history.map((title, index) => (
                <li key={`${title}-${index}`}>
                  <button
                    onClick={() => {
                      onSelectChat?.(index);
                      onClose?.();
                    }}
                    className={`w-full truncate rounded-xl px-3 py-2 text-left text-[13px] text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 ${focus}`}
                  >
                    {title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="relative flex flex-col gap-2 border-t border-white/[0.06] pt-4">
        {ledger && !compact && (
          <a
            {...linkProps("/missions")}
            onClick={(e) => {
              linkProps("/missions").onClick(e);
              onClose?.();
            }}
            className={`group relative overflow-hidden rounded-2xl border border-gold-400/20 bg-gradient-to-br from-gold-400/[0.12] via-gold-400/[0.04] to-transparent px-3.5 py-3 transition-colors hover:border-gold-400/35 ${focus}`}
            aria-label={`So far Tempo has got back £${ledger.gbp} and ${ledger.hours} hours of your time. Open Mission Control.`}
          >
            <span aria-hidden className="absolute -right-6 -top-6 h-20 w-20 rounded-full border-[6px] border-gold-400/15" />
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold-200/80">Returned so far</span>
            <span className="num mt-1 block text-xl font-semibold leading-tight text-gold">£{ledger.gbp}</span>
            <span className="text-[12px] text-slate-400">{ledger.hours} h of your time</span>
          </a>
        )}
        <NavItem entry={NAV_SETTINGS} active={section === "/settings"} compact={compact} onClick={onClose} />
      </div>
    </nav>
  );
}
