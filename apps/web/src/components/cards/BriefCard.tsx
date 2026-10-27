import type { Brief, TriageItem } from "@steward/shared";
import { Calendar, Check, ChevronDown, Clock, Hand, Play, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { cn, formatDay, listNames, plural } from "@/lib/utils.ts";
import { CalendarDay } from "./CalendarDay.tsx";

/** A section shows this many rows, then "Show N more". One row over shows whole. */
const SECTION_ROWS = 5;

export interface BriefCardProps {
  brief: Brief;
  /** Hands a "needs you" email to Steward. Without it, rows have no Start button. */
  onStart?: (item: TriageItem) => void;
  /** Level of the brief's own heading; its sections sit one below. */
  headingLevel?: 2 | 3;
  timeZone?: string;
  className?: string;
}

function senderOf(item: TriageItem): string {
  return item.from.name || item.from.email;
}

/** `YYYY-MM-DD` as a local date, so the day shown is the day the brief is for wherever you are. */
function briefDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return formatDay(new Date(y, m - 1, d));
}

/**
 * The morning brief: what needs you (each with Start), what can wait (folded into one row), today's
 * calendar, and what Steward could not check. Honest by construction: if a source failed, it says so.
 */
export function BriefCard({ brief, onStart, headingLevel = 2, timeZone, className }: BriefCardProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  const nothing =
    brief.needsYou.length === 0 &&
    brief.canWait.length === 0 &&
    brief.calendar.length === 0 &&
    brief.couldNotCheck.length === 0;

  return (
    <Card as="section" aria-labelledby={titleId} className={cn("flex flex-col gap-5", className)}>
      <header>
        <p className="text-caption text-ink-2">{briefDay(brief.date)}</p>
        <Heading id={titleId} className="mt-0.5 font-semibold text-title text-ink">
          Your brief
        </Heading>
        {brief.summary ? <p className="measure mt-2 text-ink text-body">{brief.summary}</p> : null}
      </header>

      {nothing ? (
        <p className="text-ink-2 text-sub">Nothing new needs you, and nothing is on your calendar today.</p>
      ) : (
        <>
          <Section title="Needs you" icon={<Hand />} count={brief.needsYou.length} level={headingLevel + 1}>
            {brief.needsYou.length === 0 ? (
              <p className="text-ink-2 text-sub">Nothing in your mail needs you right now.</p>
            ) : (
              <Rows
                items={brief.needsYou}
                render={(item) => <NeedsYouRow key={item.emailId} item={item} onStart={onStart} />}
              />
            )}
          </Section>

          {brief.canWait.length > 0 ? <CanWait items={brief.canWait} level={headingLevel + 1} /> : null}

          <Section title="Today" icon={<Calendar />} level={headingLevel + 1}>
            <CalendarDay events={brief.calendar} timeZone={timeZone} />
          </Section>

          {brief.couldNotCheck.length > 0 ? (
            <Section title="Couldn't check" icon={<TriangleAlert />} level={headingLevel + 1}>
              <ul className="flex flex-col gap-2">
                {brief.couldNotCheck.map((line) => {
                  const i = line.indexOf(":");
                  const source = i > 0 ? line.slice(0, i) : undefined;
                  const why = i > 0 ? line.slice(i + 1).trim() : line;
                  return (
                    <li key={line} className="text-sub">
                      {source ? <span className="font-medium text-ink">{source}: </span> : null}
                      <span className="text-ink-2">{why}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </Card>
  );
}

function Section({
  title,
  icon,
  count,
  level,
  children,
}: {
  title: string;
  icon: ReactNode;
  count?: number;
  level: number;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = `h${Math.min(level, 6)}` as "h3" | "h4";
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <Heading id={id} className="flex items-center gap-2 font-semibold text-ink text-sub">
        <span aria-hidden="true" className="text-ink-2 [&_svg]:size-4">
          {icon}
        </span>
        {title}
        {count !== undefined && count > 0 ? (
          <span className="text-ink-2 tabular-nums">
            <span className="sr-only">, </span>
            {count}
          </span>
        ) : null}
      </Heading>
      {children}
    </section>
  );
}

/** The first five rows, then a button for the rest. A list one over the limit shows whole. */
function Rows<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const fold = items.length > SECTION_ROWS + 1 && !expanded;
  const shown = fold ? items.slice(0, SECTION_ROWS) : items;
  return (
    <>
      <ul className="flex flex-col">{shown.map(render)}</ul>
      {fold ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded(true)}>
          Show {items.length - SECTION_ROWS} more
        </Button>
      ) : null}
    </>
  );
}

function NeedsYouRow({ item, onStart }: { item: TriageItem; onStart?: (item: TriageItem) => void }) {
  const [started, setStarted] = useState(false);
  const title = `${senderOf(item)} · ${item.subject || "(no subject)"}`;
  return (
    <li className="flex items-start gap-3 border-hair-2 border-t py-3 first:border-t-0 first:pt-1">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-body text-ink">
          <span>{senderOf(item)}</span>
          <span aria-hidden="true" className="text-ink-3">
            {" · "}
          </span>
          <span className="sr-only">, </span>
          <span>{item.subject || "(no subject)"}</span>
        </p>
        <p className="mt-0.5 text-ink-2 text-sub">{item.reason}</p>
      </div>
      {onStart ? (
        started ? (
          <span className="inline-flex min-h-target items-center gap-1.5 px-2 font-medium text-done text-sub">
            <Check aria-hidden="true" className="size-4" />
            Started
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={<Play />}
            aria-label={`Start: ${title}`}
            onClick={() => {
              setStarted(true);
              onStart(item);
            }}
          >
            Start
          </Button>
        )
      ) : null}
    </li>
  );
}

function CanWait({ items, level }: { items: TriageItem[]; level: number }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const senders = listNames(items.map(senderOf));
  return (
    <Section title="Can wait" icon={<Clock />} count={items.length} level={level}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-target w-full items-center gap-3 rounded-field px-2 py-2 text-left hover:bg-tile"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-body text-ink">
            {plural(items.length, "email")} can wait
          </span>
          <span className="block truncate text-ink-2 text-sub">{senders}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-5 shrink-0 text-ink-2 transition-transform duration-(--st-dur-swap)",
            open && "rotate-180",
          )}
        />
      </button>
      <ul id={listId} hidden={!open} className="flex flex-col pl-2">
        {items.map((item) => (
          <li key={item.emailId} className="border-hair-2 border-t py-2.5 first:border-t-0">
            <p className="text-ink text-sub">
              <span className="font-medium">{senderOf(item)}</span>
              <span className="text-ink-3"> · </span>
              {item.subject || "(no subject)"}
            </p>
            <p className="text-caption text-ink-2">{item.reason}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
