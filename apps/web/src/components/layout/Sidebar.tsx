import type { ReactNode } from "react";
import { Brain, History as HistoryIcon, Plus, Sparkles, X } from "lucide-react";
import { STATUS_WORDS, type ChatStatus } from "@/features/chat/store";
import { linkProps } from "@/router";
import { TempoMark } from "../ui/TempoMark";
import { NAV_MEMORY, NAV_SETTINGS, navGroups, type NavEntry } from "./nav";

export { NAV_DOING, NAV_TRUST, type NavEntry } from "./nav";

/** One conversation in History: its title and how it stands (plan.md §19). */
export interface HistoryItem {
  title: string;
  status: ChatStatus;
  /** It is the conversation open in the chat now. */
  current?: boolean;
}

/** Yellow while Tempo works, green when done with news to read, grey when done and seen. */
const DOT: Record<ChatStatus, string> = {
  live: "bg-amber-400 shadow-[0_0_8px_rgb(251_191_36/0.7)] motion-safe:animate-pulse",
  finished: "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.6)]",
  read: "bg-slate-500",
};

interface SidebarProps {
  /** The current route's first segment, e.g. `/missions`. */
  section: string;
  onNewChat?: () => void;
  onSelectChat?: (index: number) => void;
  history: HistoryItem[];
  /** L was pressed: the hidden pages are back (plan.md §19). */
  revealed?: boolean;
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

function Heading({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-1.5 flex items-center gap-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
      {icon} {children}
    </h2>
  );
}

export function Sidebar({ section, onNewChat, onSelectChat, history, revealed = false, onClose, width, profileName, ledger }: SidebarProps) {
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
        {!compact && (
          <section aria-labelledby="history-heading">
            <Heading id="history-heading" icon={<HistoryIcon size={12} aria-hidden />}>
              History
            </Heading>
            {history.length === 0 ? (
              <p className="px-3 text-[12.5px] text-slate-500">Your chats will appear here.</p>
            ) : (
              <>
                <ul className="flex max-h-[42vh] flex-col gap-0.5 overflow-y-auto">
                  {history.map((item, index) => {
                    const words = STATUS_WORDS[item.status];
                    const open = onChat && item.current;
                    return (
                      <li key={`${item.title}-${index}`}>
                        <button
                          onClick={() => {
                            onSelectChat?.(index);
                            onClose?.();
                          }}
                          aria-current={open ? "page" : undefined}
                          title={`${item.title} · ${words.label}: ${words.hint}`}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${focus} ${open ? "bg-white/[0.06] text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"}`}
                        >
                          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.status]}`} />
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <span className="sr-only">, {words.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p aria-hidden className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-[10.5px] text-slate-500">
                  {(["live", "finished", "read"] as const).map((status) => (
                    <span key={status} className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status].split(" ")[0]}`} /> {status === "read" ? "Read" : STATUS_WORDS[status].label}
                    </span>
                  ))}
                </p>
              </>
            )}
          </section>
        )}

        <section aria-labelledby={compact ? undefined : "memory-heading"} aria-label={compact ? "Memory" : undefined}>
          {!compact && (
            <Heading id="memory-heading" icon={<Brain size={12} aria-hidden />}>
              Memory
            </Heading>
          )}
          <NavItem entry={NAV_MEMORY} active={section === NAV_MEMORY.to} compact={compact} onClick={onClose} />
        </section>

        {navGroups(revealed).map((group) => (
          <Group key={group.title} title={group.title} entries={group.entries} section={section} compact={compact} onClose={onClose} />
        ))}
      </div>

      <div className="relative flex flex-col gap-2 border-t border-white/[0.06] pt-4">
        {ledger && !compact && <Returned ledger={ledger} revealed={revealed} onClose={onClose} />}
        <NavItem entry={NAV_SETTINGS} active={section === "/settings"} compact={compact} onClick={onClose} />
      </div>
    </nav>
  );
}

const RETURNED = "group relative block overflow-hidden rounded-2xl border border-gold-400/20 bg-gradient-to-br from-gold-400/[0.12] via-gold-400/[0.04] to-transparent px-3.5 py-3";

/** Money and time returned so far. It opens Mission Control only when that page is shown (L). */
function Returned({ ledger, revealed, onClose }: { ledger: { gbp: string; hours: string }; revealed: boolean; onClose?: () => void }) {
  const said = `So far Tempo has got back £${ledger.gbp} and ${ledger.hours} hours of your time.`;
  const body = (
    <>
      <span aria-hidden className="absolute -right-6 -top-6 h-20 w-20 rounded-full border-[6px] border-gold-400/15" />
      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold-200/80">Returned so far</span>
      <span className="num mt-1 block text-xl font-semibold leading-tight text-gold">£{ledger.gbp}</span>
      <span className="text-[12px] text-slate-400">{ledger.hours} h of your time</span>
    </>
  );
  if (!revealed) return <div className={RETURNED}>{body}</div>;
  const link = linkProps("/missions");
  return (
    <a
      {...link}
      onClick={(e) => {
        link.onClick(e);
        onClose?.();
      }}
      className={`${RETURNED} transition-colors hover:border-gold-400/35 ${focus}`}
      aria-label={`${said} Open Mission Control.`}
    >
      {body}
    </a>
  );
}
