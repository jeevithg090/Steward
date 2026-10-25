import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useResizable } from "@/hooks/useResizable";
import { ResizeHandle } from "../ui/ResizeHandle";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  section: string;
  onNewChat?: () => void;
  onSelectChat?: (index: number) => void;
  history: string[];
  profileName?: string | null;
  /** The honesty badge and anything else that belongs in every page's header. */
  badge?: ReactNode;
  /** A full-width notice under the header (the Gateway is unreachable). */
  banner?: ReactNode;
  /** Money and time returned so far, for the sidebar's footer. */
  ledger?: { gbp: string; hours: string } | null;
  children: ReactNode;
}

export function AppShell({ section, onNewChat, onSelectChat, history, profileName, badge, banner, ledger, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebar = useResizable({ initial: 272, min: 72, max: 420 });
  const fullHeight = section === "/chat";

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-nexus-canvas text-white">
      <a href="#main" className="skip-link">Skip to content</a>

      <div className="hidden lg:flex">
        <Sidebar section={section} onNewChat={onNewChat} onSelectChat={onSelectChat} history={history} width={sidebar.width} profileName={profileName} ledger={ledger} />
        <ResizeHandle label="Resize sidebar" value={sidebar.width} min={sidebar.min} max={sidebar.max} handleProps={sidebar.handleProps} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <Sidebar section={section} onNewChat={onNewChat} onSelectChat={onSelectChat} history={history} onClose={() => setDrawerOpen(false)} profileName={profileName} ledger={ledger} />
          <button className="flex-1 bg-black/60" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-4 pt-3 lg:px-6 lg:pt-4">
          <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="rounded-lg p-2 hover:bg-white/10 lg:hidden">
            <Menu size={20} />
          </button>
          <span className="font-semibold lg:hidden">Tempo</span>
          <div className="ml-auto flex min-w-0 items-center gap-2">{badge}</div>
        </header>
        {banner}
        <main id="main" tabIndex={-1} className={`min-h-0 flex-1 px-4 focus:outline-none pb-4 pt-3 lg:px-6 lg:pb-6 ${fullHeight ? "flex flex-col" : "overflow-y-auto"}`}>
          {fullHeight ? children : <div key={section} className="mx-auto w-full max-w-5xl motion-safe:animate-fade-in">{children}</div>}
        </main>
      </div>
    </div>
  );
}
