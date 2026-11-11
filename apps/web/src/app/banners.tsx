import type { Approval } from "@steward/shared";
import { FlaskConical, Hand, WifiOff } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useApprovals, useInfo } from "@/lib/api.ts";
import type { LiveStatus } from "@/lib/live.ts";
import { plural } from "@/lib/utils.ts";

/**
 * Honest labels: when the inbox is the demo one or the model is the scripted one, every screen
 * says so. Nothing made up should ever pass for the real thing.
 */
export function DemoRibbon() {
  const info = useInfo();
  if (!info.data) return null;
  const demoMail = info.data.mail.isDemo;
  const scripted = info.data.model.scripted;
  if (!demoMail && !scripted) return null;
  // A model chosen in Settings wins over .env, so the way to a real model starts there.
  const setUp = (
    <Link to="/settings" className="underline underline-offset-2 hover:text-accent">
      set up a real model
    </Link>
  );
  return (
    <aside
      aria-label="Demo data"
      className="flex items-center justify-center gap-2 bg-needs-soft px-4 py-1.5 text-center font-medium text-caption text-ink"
    >
      <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-needs" />
      <span>
        {demoMail && scripted ? (
          <>Demo inbox · Scripted model — {setUp}</>
        ) : scripted ? (
          <>Scripted model — {setUp}</>
        ) : (
          "Demo inbox — the mail and calendar here are made up"
        )}
      </span>
    </aside>
  );
}

/** Pages where the pending approvals are already listed, so the banner would only repeat them. */
const QUIET_ON = ["/tasks", "/welcome"];

/** The conversation open at this path, if any. */
function openThread(path: string): string | undefined {
  const match = /^\/chat\/([^/]+)/.exec(path);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * True where every pending request is already on screen: Today and Tasks list them all, and a
 * conversation shows its own.
 */
export function bannerQuietOn(path: string, approvals: Pick<Approval, "threadId">[]): boolean {
  if (path === "/" || QUIET_ON.some((p) => path.startsWith(p))) return true;
  const thread = openThread(path);
  return thread !== undefined && approvals.every((a) => a.threadId === thread);
}

/**
 * Says, on every page, that Steward is waiting for an answer. The live region is always mounted so
 * the arrival of a new request is announced, not just drawn.
 */
export function NeedsYouBanner() {
  const location = useLocation();
  const pending = useApprovals("pending", { refetchInterval: 60_000 });
  const approvals = (pending.data ?? []).filter((a) => a.status === "pending");
  const show = approvals.length > 0 && !bannerQuietOn(location.pathname, approvals);
  const first = approvals[0];
  // One request: answer it in its own conversation, where it was asked. More: all of them in Tasks.
  const answerAt =
    approvals.length === 1 && first?.threadId
      ? `/chat/${encodeURIComponent(first.threadId)}`
      : "/tasks?view=needs_you";
  return (
    <div aria-live="polite" aria-atomic="true">
      {show && first ? (
        <section
          aria-label="Waiting on you"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-hair border-b bg-needs-soft px-4 py-2.5 sm:px-6"
        >
          <p className="flex min-w-0 flex-1 items-center gap-2 text-ink text-sub">
            <Hand aria-hidden="true" className="size-4 shrink-0 text-needs" />
            <span className="min-w-0">
              <span className="font-semibold">Steward is waiting on you: </span>
              {approvals.length === 1 ? (
                <span className="break-words">{first.summary}</span>
              ) : (
                <span>{plural(approvals.length, "request")} need your answer.</span>
              )}
            </span>
          </p>
          <Link
            to={answerAt}
            className="inline-flex min-h-target items-center rounded-field bg-card px-3 font-medium text-ink text-sub shadow-[inset_0_0_0_1px_var(--st-line)] hover:bg-tile"
          >
            Answer {approvals.length === 1 ? "it" : "them"}
          </Link>
        </section>
      ) : null}
    </div>
  );
}

/** Shown while the live stream is down, so a quiet screen is not mistaken for "nothing new". */
export function LiveStatusNote({ status }: { status: LiveStatus }) {
  return (
    <div aria-live="polite">
      {status === "reconnecting" ? (
        <p className="flex items-center gap-2 px-4 py-2 text-caption text-ink-2">
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          Live updates paused. Reconnecting…
        </p>
      ) : null}
    </div>
  );
}
