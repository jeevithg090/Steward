import type { CalendarEvent } from "@steward/shared";
import { MapPin, Video } from "lucide-react";
import { cn, formatTime } from "@/lib/utils.ts";

export interface CalendarDayProps {
  events: CalendarEvent[];
  /** Show times in this IANA zone instead of the browser's. */
  timeZone?: string;
  /** Words when there is nothing on. */
  emptyText?: string;
  className?: string;
}

/** A day's events in time order: when, what, where, and a link to the call. */
export function CalendarDay({
  events,
  timeZone,
  emptyText = "Nothing on your calendar today.",
  className,
}: CalendarDayProps) {
  if (events.length === 0) return <p className={cn("text-ink-2 text-sub", className)}>{emptyText}</p>;
  const sorted = [...events].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start.localeCompare(b.start);
  });
  return (
    <ol className={cn("flex flex-col", className)}>
      {sorted.map((event) => (
        <li key={event.id} className="flex gap-4 border-hair-2 border-t py-3 first:border-t-0 first:pt-0">
          <p className="w-28 shrink-0 text-ink-2 text-sub tabular-nums">
            {event.allDay ? (
              "All day"
            ) : (
              <>
                <time dateTime={event.start}>{formatTime(event.start, timeZone)}</time>
                <span aria-hidden="true">–</span>
                <span className="sr-only"> to </span>
                <time dateTime={event.end}>{formatTime(event.end, timeZone)}</time>
              </>
            )}
          </p>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-body text-ink">{event.title}</p>
            {event.location ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-ink-2 text-sub">
                <MapPin aria-hidden="true" className="size-4 shrink-0" />
                <span className="sr-only">Where: </span>
                {event.location}
              </p>
            ) : null}
            {event.meetingUrl ? (
              <a
                href={event.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex min-h-target items-center gap-1.5 text-accent text-sub underline underline-offset-4"
              >
                <Video aria-hidden="true" className="size-4 shrink-0" />
                Join the call
                <span className="sr-only"> for {event.title} (opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
