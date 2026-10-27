import type { EmailSummary, TriageItem } from "@steward/shared";
import { Pill } from "@/components/ui/Pill.tsx";
import { cn, relativeTime } from "@/lib/utils.ts";

export interface EmailListProps {
  /** Summaries, optionally with the triage verdict `GET /api/inbox` attaches. */
  emails: (EmailSummary & { triage?: TriageItem })[];
  emptyText?: string;
  className?: string;
}

/** A compact inbox: who, what, a line of it, when; and Steward's verdict when it has one. */
export function EmailList({ emails, emptyText = "No mail to show.", className }: EmailListProps) {
  if (emails.length === 0) return <p className={cn("text-ink-2 text-sub", className)}>{emptyText}</p>;
  return (
    <ul className={cn("flex flex-col", className)}>
      {emails.map((email) => {
        const sender = email.from.name || email.from.email;
        return (
          <li key={email.id} className="flex gap-3 border-hair-2 border-t py-3 first:border-t-0 first:pt-0">
            <span
              aria-hidden="true"
              className={cn(
                "mt-2 size-2 shrink-0 rounded-full",
                email.unread ? "bg-accent" : "bg-transparent",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p
                  className={cn(
                    "truncate text-body text-ink",
                    email.unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {email.unread ? <span className="sr-only">Unread. </span> : null}
                  {sender}
                </p>
                <time dateTime={email.receivedAt} className="shrink-0 text-caption text-ink-3">
                  {relativeTime(email.receivedAt)}
                </time>
              </div>
              <p className="truncate text-ink text-sub">{email.subject || "(no subject)"}</p>
              <p className="line-clamp-1 text-ink-2 text-sub">{email.snippet}</p>
              {email.triage ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Pill tone={email.triage.verdict === "needs_you" ? "needs" : "neutral"}>
                    {email.triage.verdict === "needs_you" ? "Needs you" : "Can wait"}
                  </Pill>
                  <span className="text-caption text-ink-2">{email.triage.reason}</span>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
