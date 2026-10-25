import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useResizable } from "../../hooks/useResizable";
import { ResizeHandle } from "../ui/ResizeHandle.tsx";
import { Sidebar } from "./Sidebar";
import type { View } from "../../types/types.ts";

interface AppShellProps {
  view: View;
  onNavigate: (view: View) => void;
  onNewChat?: () => void;
  onSelectChat?: (index: number) => void;
  history: string[];
  children: ReactNode;
}

export function AppShell({ view, onNavigate, onNewChat, onSelectChat, history, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebar = useResizable({ initial: 288, min: 72, max: 420 });

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-nexus-canvas text-white">
      <div className="hidden lg:flex">
        <Sidebar
          view={view}
          onNavigate={onNavigate}
          onNewChat={onNewChat}
          onSelectChat={onSelectChat}
          history={history}
          width={sidebar.width}
        />
        <ResizeHandle label="Resize sidebar" value={sidebar.width} min={sidebar.min} max={sidebar.max} handleProps={sidebar.handleProps} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <Sidebar
            view={view}
            onNavigate={onNavigate}
            onNewChat={onNewChat}
            onSelectChat={onSelectChat}
            history={history}
            onClose={() => setDrawerOpen(false)}
          />
          <button className="flex-1 bg-black/60" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col p-4 lg:p-6 lg:pl-0">
        <header className="mb-4 flex items-center gap-3 lg:hidden">
          <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="rounded-lg p-2 hover:bg-white/10">
            <Menu size={20} />
          </button>
          <span className="font-semibold">Nexus</span>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </main>
    </div>
  );
}