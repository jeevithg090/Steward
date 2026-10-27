import { Ellipsis, Keyboard, MessageSquarePlus } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { Loading } from "@/components/ui/Notice.tsx";
import { needsYouCount, useApprovals, useCreateThread, useInfo, useTasks, useThreads } from "@/lib/api.ts";
import { claimRouteFocus, markRouteChange } from "@/lib/focus.ts";
import { useLiveSync } from "@/lib/live.ts";
import { showBrowserNotification } from "@/lib/notify.ts";
import { cn, relativeTime } from "@/lib/utils.ts";
import { DemoRibbon, LiveStatusNote, NeedsYouBanner } from "./banners.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { useWideLayout } from "./layout-mode.ts";
import { NAV_ITEMS, type NavItem } from "./nav.ts";
import { NotificationsButton } from "./notifications.tsx";
import { ShortcutsDialog, useShortcuts } from "./shortcuts.tsx";

/** How long a page has to put up its heading before focus falls back to <main>. */
const FOCUS_FALLBACK_MS = 700;

/**
 * The app's frame. On a desktop: a left rail with the places, the recent conversations and a
 * "New conversation" button. On a phone: a bottom bar with Today, Chat, Tasks, Computer and More.
 * Around every page: a skip link, the demo ribbon, the "waiting on you" banner and focus that
 * follows navigation.
 */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const wide = useWideLayout();

  useShortcuts({ onHelp: () => setHelpOpen(true) });

  const liveStatus = useLiveSync((event) => {
    if (event.type !== "notification") return;
    const n = event.notification;
    const open = (href: string) => navigate(href);
    showBrowserNotification(n, open);
    const options = {
      description: n.body,
      action: n.href ? { label: "Open", onClick: () => n.href && open(n.href) } : undefined,
    };
    if (n.level === "problem") toast.error(n.title, options);
    else if (n.level === "done") toast.success(n.title, options);
    else toast(n.title, options);
  });

  // Each navigation: scroll to the top and move focus to the new page's heading (or <main>).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on path changes only.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setMoreOpen(false);
    window.scrollTo?.({ top: 0 });
    markRouteChange();
    const timer = setTimeout(() => {
      if (claimRouteFocus()) mainRef.current?.focus({ preventScroll: true });
    }, FOCUS_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  return (
    <div className={cn("min-h-dvh bg-surface text-ink", wide && "flex")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-field focus:bg-card focus:px-4 focus:py-3 focus:font-medium focus:shadow-raised"
      >
        Skip to main content
      </a>

      {wide ? (
        <Rail onHelp={() => setHelpOpen(true)} liveStatus={<LiveStatusNote status={liveStatus} />} />
      ) : null}

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {wide ? null : <MobileTopBar />}
        <DemoRibbon />
        <NeedsYouBanner />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            !wide && "pb-[calc(5rem+env(safe-area-inset-bottom))]",
          )}
        >
          <ErrorBoundary resetKeys={[location.pathname]}>
            <Suspense fallback={<Loading>Loading the page…</Loading>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
        {wide ? null : <LiveStatusNote status={liveStatus} />}
      </div>

      {wide ? null : <TabBar onMore={() => setMoreOpen(true)} />}
      <MoreDialog open={moreOpen} onOpenChange={setMoreOpen} onHelp={() => setHelpOpen(true)} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

function useTasksBadge(): number {
  const tasks = useTasks(undefined, { refetchInterval: 120_000 });
  const pending = useApprovals("pending");
  return needsYouCount(tasks.data, pending.data);
}

function Brand() {
  const info = useInfo();
  const name = info.data?.brand.name ?? "Steward";
  return (
    <NavLink to="/" className="flex min-h-target items-center gap-2.5 rounded-field px-2 no-underline">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="font-semibold text-ink text-title">{name}</span>
    </NavLink>
  );
}

function NavRow({ item, badge }: { item: NavItem; badge?: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "flex min-h-target items-center gap-3 rounded-field px-3 font-medium text-sub no-underline",
          "transition-colors duration-(--st-dur-tap)",
          isActive ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-tile hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon aria-hidden="true" className={cn("size-5 shrink-0", isActive && "text-accent")} />
          <span className="flex-1">{item.label}</span>
          {badge ? (
            <Badge variant="count" srLabel={`, ${badge} waiting`}>
              {badge}
            </Badge>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function Rail({ onHelp, liveStatus }: { onHelp: () => void; liveStatus: ReactNode }) {
  const badge = useTasksBadge();
  return (
    <aside
      aria-label="Steward"
      className="sticky top-0 flex h-dvh w-72 max-w-[30vw] shrink-0 flex-col border-hair border-r bg-card"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-4 pb-2">
        <Brand />
        <NotificationsButton />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        <nav aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavRow item={item} badge={item.to === "/tasks" ? badge : undefined} />
              </li>
            ))}
          </ul>
        </nav>
        <RecentConversations />
      </div>
      {liveStatus}
      <div className="border-hair-2 border-t px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<Keyboard />}
          onClick={onHelp}
          className="w-full justify-start"
        >
          Keyboard shortcuts
        </Button>
      </div>
    </aside>
  );
}

/** The newest conversations, and a way to start one. */
function RecentConversations({ onNavigate }: { onNavigate?: () => void }) {
  const threads = useThreads();
  const create = useCreateThread();
  const navigate = useNavigate();
  const headingId = useId();
  const recent = [...(threads.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);

  function startNew() {
    create.mutate(undefined, {
      onSuccess: (thread) => {
        onNavigate?.();
        navigate(`/chat/${encodeURIComponent(thread.id)}`);
      },
      onError: () => {
        onNavigate?.();
        navigate("/chat");
      },
    });
  }

  return (
    <section aria-labelledby={headingId} className="mt-6 flex flex-col gap-1">
      <h2 id={headingId} className="px-3 font-semibold text-caption text-ink-2 uppercase tracking-wide">
        Recent conversations
      </h2>
      <Button
        variant="ghost"
        size="sm"
        icon={<MessageSquarePlus />}
        loading={create.isPending}
        onClick={startNew}
        className="justify-start"
      >
        New conversation
      </Button>
      {threads.isError ? (
        <p className="px-3 text-caption text-ink-2">Couldn't load conversations.</p>
      ) : recent.length === 0 && threads.isSuccess ? (
        <p className="px-3 text-caption text-ink-2">No conversations yet.</p>
      ) : (
        <ul className="flex flex-col">
          {recent.map((thread) => (
            <li key={thread.id}>
              <NavLink
                to={`/chat/${encodeURIComponent(thread.id)}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-target flex-col justify-center rounded-field px-3 py-1.5 no-underline",
                    isActive ? "bg-accent-soft" : "hover:bg-tile",
                  )
                }
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-ink text-sub">{thread.title || "New conversation"}</span>
                  {thread.running ? (
                    <span className="flex shrink-0 items-center gap-1 text-caption text-working">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-working" />
                      Working
                    </span>
                  ) : null}
                </span>
                <span className="text-caption text-ink-3">
                  {thread.kind === "routine" ? "Routine · " : thread.kind === "task" ? "Task · " : ""}
                  {relativeTime(thread.updatedAt)}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MobileTopBar() {
  return (
    <header className="glass sticky top-0 z-20 flex items-center justify-between gap-2 border-hair border-b px-2 py-1">
      <Brand />
      <NotificationsButton />
    </header>
  );
}

/** The phone's bottom bar: four places and More. Each target is at least 44px, current marked for screen readers. */
function TabBar({ onMore }: { onMore: () => void }) {
  const badge = useTasksBadge();
  const items = NAV_ITEMS.filter((n) => n.primary);
  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-0 bottom-0 z-30 border-hair border-t pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const count = item.to === "/tasks" ? badge : 0;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 font-medium text-caption no-underline",
                    isActive ? "text-accent" : "text-ink-2",
                  )
                }
              >
                <span className="relative">
                  <Icon aria-hidden="true" className="size-6" />
                  {count > 0 ? (
                    <Badge
                      variant="count"
                      className="-top-1.5 -right-3 absolute"
                      srLabel={`, ${count} waiting`}
                    >
                      {count}
                    </Badge>
                  ) : null}
                </span>
                {item.label}
              </NavLink>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMore}
            className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 font-medium text-caption text-ink-2"
          >
            <Ellipsis aria-hidden="true" className="size-6" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

function MoreDialog({
  open,
  onOpenChange,
  onHelp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHelp: () => void;
}) {
  const items = NAV_ITEMS.filter((n) => !n.primary);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="More" placement="sheet">
      <nav aria-label="More places">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.to}>
              <NavRow item={item} />
            </li>
          ))}
        </ul>
      </nav>
      <RecentConversations onNavigate={() => onOpenChange(false)} />
      <Button
        variant="ghost"
        size="sm"
        icon={<Keyboard />}
        className="mt-4 w-full justify-start"
        onClick={() => {
          onOpenChange(false);
          onHelp();
        }}
      >
        Keyboard shortcuts
      </Button>
    </Dialog>
  );
}
