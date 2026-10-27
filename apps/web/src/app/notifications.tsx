import type { AppNotification } from "@steward/shared";
import { Bell } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Pill, type Tone } from "@/components/ui/Pill.tsx";
import { useNotifications, useReadAllNotifications } from "@/lib/api.ts";
import { cn, relativeTime } from "@/lib/utils.ts";

const LEVELS: Record<AppNotification["level"], { label: string; tone: Tone }> = {
  info: { label: "News", tone: "neutral" },
  needs_you: { label: "Needs you", tone: "needs" },
  done: { label: "Done", tone: "done" },
  problem: { label: "Problem", tone: "problem" },
};

/** The bell: how many unread, and a list of what Steward wanted you to know. */
export function NotificationsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const notifications = useNotifications({ refetchInterval: 120_000 });
  const readAll = useReadAllNotifications();
  const list = notifications.data ?? [];
  const unread = list.filter((n) => !n.readAt).length;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn("relative", className)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen(true)}
      >
        <Bell aria-hidden="true" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 size-2.5 rounded-full bg-accent ring-2 ring-[var(--st-card)]"
          />
        ) : null}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Notifications"
        placement="sheet"
        footer={
          <Button disabled={unread === 0} loading={readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all as read
          </Button>
        }
      >
        {notifications.isPending ? (
          <Loading>Loading notifications…</Loading>
        ) : notifications.isError ? (
          <ErrorNotice title="Couldn't load notifications" error={notifications.error} />
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-ink-2 text-sub">
            Nothing yet. Steward will tell you here when it needs you.
          </p>
        ) : (
          <ul className="flex flex-col">
            {list.map((n) => {
              const level = LEVELS[n.level];
              const body = (
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone={level.tone}>{level.label}</Pill>
                    {!n.readAt ? <span className="font-medium text-accent text-caption">New</span> : null}
                    <span className="text-caption text-ink-3">{relativeTime(n.createdAt)}</span>
                  </span>
                  <span className="mt-1 block font-medium text-body text-ink">{n.title}</span>
                  <span className="block text-ink-2 text-sub">{n.body}</span>
                </>
              );
              return (
                <li key={n.id} className="border-hair-2 border-t first:border-t-0">
                  {n.href ? (
                    <button
                      type="button"
                      className="w-full rounded-field px-2 py-3 text-left hover:bg-tile"
                      onClick={() => {
                        setOpen(false);
                        if (n.href) navigate(n.href);
                      }}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="px-2 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
    </>
  );
}
