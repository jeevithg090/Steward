import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Brain, FileText, LayoutList, Menu, MessageSquare, MoreHorizontal, Plug, Search, ShieldAlert, Users } from "lucide-react";
import { useResizable } from "@/hooks/useResizable";
import { linkProps } from "@/router";
import { Kbd } from "../ui/Kbd";
import { ResizeHandle } from "../ui/ResizeHandle";
import { TempoMark } from "../ui/TempoMark";
import { CommandPalette, baseCommands, newChatCommand, type Command } from "./CommandPalette";
import { navFor } from "./nav";
import { Sidebar, type HistoryItem } from "./Sidebar";

interface AppShellProps {
  section: string;
  onNewChat?: () => void;
  onSelectChat?: (index: number) => void;
  history: HistoryItem[];
  /** L was pressed: the hidden pages are back in the menus (plan.md §19). */
  revealed?: boolean;
  profileName?: string | null;
  /** The honesty badge and anything else that belongs in every page's header. */
  badge?: ReactNode;
  /** A full-width notice under the header (the Gateway is unreachable). */
  banner?: ReactNode;
  /** Money and time returned so far, for the sidebar's footer. */
  ledger?: { gbp: string; hours: string } | null;
  /** The app's own ⌘K commands (e.g. prompts for the chat), before the built-in ones. */
  commands?: Command[];
  children: ReactNode;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The four places people go most on a phone, and "More" for the rest (the drawer). The chat does
 * the reading, the owed check and the scam check, so those pages only come back with L. */
const TABS = [
  { to: "/chat", label: "Chat", Icon: MessageSquare },
  { to: "/memory", label: "Memory", Icon: Brain },
  { to: "/connectors", label: "Connectors", Icon: Plug },
  { to: "/profiles", label: "Summary", Icon: Users },
];
const ALL_TABS = [
  { to: "/chat", label: "Chat", Icon: MessageSquare },
  { to: "/missions", label: "Missions", Icon: LayoutList },
  { to: "/shield", label: "Shield", Icon: ShieldAlert },
  { to: "/read", label: "Read", Icon: FileText },
];

export function AppShell({ section, onNewChat, onSelectChat, history, revealed = false, profileName, badge, banner, ledger, commands = [], children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sidebar = useResizable({ initial: 272, min: 72, max: 420 });
  const fullHeight = section === "/chat";
  const here = navFor(section);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setDrawerOpen(false), [section]);

  const allCommands = useMemo(
    () => baseCommands([...(onNewChat ? [newChatCommand(onNewChat)] : []), ...commands], revealed),
    // Rebuilt each time the palette opens, so toggles show their current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paletteOpen, commands, onNewChat, revealed],
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden text-white">
      <a href="#main" className="skip-link">Skip to content</a>

      <div className="hidden lg:flex">
        <Sidebar section={section} onNewChat={onNewChat} onSelectChat={onSelectChat} history={history} revealed={revealed} width={sidebar.width} profileName={profileName} ledger={ledger} />
        <ResizeHandle label="Resize sidebar" value={sidebar.width} min={sidebar.min} max={sidebar.max} handleProps={sidebar.handleProps} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="motion-safe:animate-[fade-up_260ms_cubic-bezier(0.22,1,0.36,1)]">
            <Sidebar section={section} onNewChat={onNewChat} onSelectChat={onSelectChat} history={history} revealed={revealed} onClose={() => setDrawerOpen(false)} profileName={profileName} ledger={ledger} />
          </div>
          <button className="flex-1 bg-ink/70 backdrop-blur-sm motion-safe:animate-fade-in" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.05] px-4 lg:h-16 lg:px-8">
          <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="-ml-1.5 rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white lg:hidden">
            <Menu size={20} />
          </button>
          <a {...linkProps("/chat")} className="flex items-center gap-2 lg:hidden" aria-label="Tempo, back to the chat">
            <TempoMark size={26} />
            <span className="font-display text-xl leading-none">Tempo</span>
          </a>
          {here && (
            <p className="hidden items-center gap-2 text-[13px] text-slate-500 lg:flex">
              <span>Tempo</span>
              <span aria-hidden className="text-slate-700">/</span>
              <span className="text-slate-300">{here.label}</span>
            </p>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search pages and actions"
              aria-keyshortcuts={MAC ? "Meta+K" : "Control+K"}
              className="group flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] pl-3 pr-1.5 text-[13px] text-slate-400 transition-colors hover:border-white/15 hover:bg-white/[0.06] hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-300"
            >
              <Search size={15} aria-hidden />
              <span className="hidden md:inline">Jump to…</span>
              <span className="hidden items-center gap-0.5 sm:flex" aria-hidden>
                <Kbd>{MAC ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <div className="flex min-w-0 items-center">{badge}</div>
          </div>
        </header>
        {banner}
        <main id="main" tabIndex={-1} className={`min-h-0 flex-1 px-4 pb-6 pt-6 focus:outline-none lg:px-10 lg:pb-10 lg:pt-8 ${fullHeight ? "flex flex-col !pt-4 lg:!pb-6" : "overflow-y-auto"}`}>
          {fullHeight ? children : <div key={section} className="mx-auto w-full max-w-5xl motion-safe:animate-fade-up">{children}</div>}
        </main>

        <nav aria-label="Quick" className="flex shrink-0 items-stretch border-t border-white/[0.06] bg-ink-900/85 px-2 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1 backdrop-blur-xl lg:hidden">
          {(revealed ? ALL_TABS : TABS).map((tab) => {
            const on = section === tab.to;
            return (
              <a
                key={tab.to}
                {...linkProps(tab.to)}
                aria-current={on ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium ${on ? "text-white" : "text-slate-500"}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${on ? "bg-accent-500/20 text-accent-100" : ""}`}>
                  <tab.Icon size={18} strokeWidth={1.75} aria-hidden />
                </span>
                {tab.label}
              </a>
            );
          })}
          <button type="button" onClick={() => setDrawerOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium text-slate-500">
            <span className="grid h-7 w-12 place-items-center rounded-full">
              <MoreHorizontal size={18} aria-hidden />
            </span>
            More
          </button>
        </nav>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={allCommands} />
    </div>
  );
}
