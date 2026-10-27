/**
 * Cards for Steward's own work: sorted mail (`triage_inbox`), a routine (`routine_create`), a page
 * it made (`make_page`), web search results and a page it read, and a command's output.
 */
import { CalendarClock, ExternalLink, FileText, Inbox, Repeat, Terminal } from "lucide-react";
import { Link } from "react-router";
import { buttonVariants } from "@/components/ui/Button.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { checkCron } from "@/lib/cron.ts";
import { cn } from "@/lib/utils.ts";
import { formatWhen, hostOf, safeHref } from "./format.ts";
import { CardFrame, Quiet, ToolLine, UntrustedNote } from "./kit.tsx";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
}

// ── Triage ──────────────────────────────────────────────────────────────────────────────────────

/** The words sent when the person starts on an email from a card. */
export function takeCareOf(from: string, subject?: string): string {
  return subject ? `Take care of ${from}'s email: ${subject}` : `Take care of ${from}'s email.`;
}

export function TriageCard({
  items,
  onAsk,
  untrusted,
}: {
  items: unknown;
  /** Sends words as the person's message. Absent where nothing can be sent. */
  onAsk?: (message: string) => void;
  untrusted?: boolean;
}) {
  const all = records(items);
  const needsYou = all.filter((item) => item.verdict === "needs_you");
  const canWait = all.filter((item) => item.verdict !== "needs_you");
  const sender = (item: Record<string, unknown>) => {
    const from = item.from as { name?: string; email?: string } | string | undefined;
    if (typeof from === "string") return from;
    return text(from?.name) ?? text(from?.email) ?? "Someone";
  };
  return (
    <CardFrame
      title={
        <span className="inline-flex items-center gap-2">
          <Inbox aria-hidden className="size-4 text-ink-3" />
          Your mail, sorted
        </span>
      }
      label="Your mail, sorted"
      caption={`${needsYou.length} need you · ${canWait.length} can wait`}
    >
      {all.length === 0 ? <Quiet>Nothing new in your mail.</Quiet> : null}
      {needsYou.length > 0 ? (
        <>
          <h4 className="m-0 mb-1 text-caption font-semibold uppercase tracking-wide text-needs">
            Needs you
          </h4>
          <ul className="m-0 list-none divide-y divide-hair-2 p-0">
            {needsYou.map((item, index) => (
              <li key={text(item.emailId) ?? index} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sub font-medium text-ink">
                    {sender(item)} · {text(item.subject) ?? "(no subject)"}
                  </p>
                  {text(item.reason) ? (
                    <p className="m-0 text-caption text-ink-2">{text(item.reason)}</p>
                  ) : null}
                </div>
                {onAsk ? (
                  <button
                    type="button"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                    aria-label={`Start: ${sender(item)}, ${text(item.subject) ?? "no subject"}`}
                    onClick={() => onAsk(takeCareOf(sender(item), text(item.subject)))}
                  >
                    Start
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {canWait.length > 0 ? (
        <details className="mt-2">
          <summary className="flex min-h-target cursor-pointer items-center text-sub text-ink-2">
            {canWait.length} {canWait.length === 1 ? "email can" : "emails can"} wait
          </summary>
          <ul className="m-0 list-none p-0 text-caption text-ink-2">
            {canWait.map((item, index) => (
              <li key={text(item.emailId) ?? index} className="py-1">
                {sender(item)} · {text(item.subject) ?? "(no subject)"}
                {text(item.reason) ? <span className="text-ink-3"> — {text(item.reason)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {untrusted ? <UntrustedNote /> : null}
    </CardFrame>
  );
}

// ── Routines ────────────────────────────────────────────────────────────────────────────────────

export function RoutineCard({
  routine,
  statusWord,
}: {
  /** The saved routine, or the arguments while it waits. */
  routine: Record<string, unknown> | undefined;
  /** Where it stands when it is not saved yet: "Waiting for your answer", "Refused". */
  statusWord?: { tone: "needs" | "problem" | "working"; word: string };
}) {
  const title = text(routine?.title) ?? "Routine";
  const cron = text(routine?.schedule);
  const schedule = text(routine?.scheduleText) ?? (cron ? checkCron(cron).text || cron : undefined);
  const prompt = text(routine?.prompt) ?? text(routine?.instruction);
  const next = formatWhen(routine?.nextRunAt);
  const enabled = routine?.enabled !== false;
  return (
    <CardFrame
      title={
        <span className="inline-flex items-center gap-2">
          <Repeat aria-hidden className="size-4 text-ink-3" />
          {title}
        </span>
      }
      label={`Routine: ${title}`}
      caption={schedule}
      action={
        statusWord ? (
          <Pill tone={statusWord.tone}>{statusWord.word}</Pill>
        ) : (
          <Pill tone={enabled ? "done" : "neutral"}>{enabled ? "On" : "Paused"}</Pill>
        )
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {next ? (
            <p className="m-0 flex items-center gap-1.5 text-caption text-ink-2">
              <CalendarClock aria-hidden className="size-3.5" />
              Next run {next}
            </p>
          ) : (
            <span />
          )}
          <Link to="/routines" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-my-2")}>
            See routines
          </Link>
        </div>
      }
    >
      {prompt ? (
        <p className="m-0 line-clamp-3 text-sub text-ink">“{prompt}”</p>
      ) : (
        <Quiet>No instruction yet.</Quiet>
      )}
    </CardFrame>
  );
}

// ── Pages ───────────────────────────────────────────────────────────────────────────────────────

const PAGE_KINDS: Record<string, string> = {
  page: "Web page",
  slides: "Slides",
  dashboard: "Dashboard",
  doc: "Doc",
  docs: "Doc",
  design: "Design",
  report: "Report",
};

export function PageCard({ page }: { page: Record<string, unknown> | undefined }) {
  const title = text(page?.title) ?? "Page";
  const kind = PAGE_KINDS[text(page?.kind)?.toLowerCase() ?? ""] ?? "Page";
  const path = text(page?.path) ?? text(page?.file);
  const summary = text(page?.summary);
  return (
    <CardFrame
      title={
        <span className="inline-flex items-center gap-2">
          <FileText aria-hidden className="size-4 text-ink-3" />
          {title}
        </span>
      }
      label={`${kind}: ${title}`}
      caption={kind}
      footer={
        path ? (
          <Link
            to={`/computer?file=${encodeURIComponent(path)}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Open in Steward's files
          </Link>
        ) : (
          <Quiet>Saving it to Steward's files…</Quiet>
        )
      }
    >
      {summary ? <p className="m-0 text-sub text-ink-2">{summary}</p> : null}
      {path ? <p className="m-0 mt-1 font-mono text-caption text-ink-3">{path}</p> : null}
    </CardFrame>
  );
}

// ── The web ─────────────────────────────────────────────────────────────────────────────────────

export function SearchResults({
  query,
  results,
  untrusted,
}: {
  query?: string;
  results: unknown;
  untrusted?: boolean;
}) {
  const list = records(results).slice(0, 10);
  return (
    <CardFrame title={query ? `Web results for “${query}”` : "Web results"}>
      {list.length === 0 ? <Quiet>No results.</Quiet> : null}
      <ol className="m-0 list-none space-y-3 p-0">
        {list.map((result, index) => {
          const href = safeHref(result.url);
          const title = text(result.title) ?? text(result.url) ?? "Untitled";
          return (
            <li key={href ?? index} className="min-w-0">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sub font-medium text-accent underline-offset-2 hover:underline"
                >
                  {title}
                  <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <span className="text-sub font-medium text-ink">{title}</span>
              )}
              <p className="m-0 truncate text-caption text-ink-3">{hostOf(result.url)}</p>
              {text(result.snippet) ? (
                <p className="m-0 line-clamp-2 text-caption text-ink-2">{text(result.snippet)}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {untrusted ? <UntrustedNote /> : null}
    </CardFrame>
  );
}

/** One line for a page Steward read with `web_fetch`, linked to the page. */
export function SourceLine({
  page,
  fallbackUrl,
}: {
  page: Record<string, unknown> | undefined;
  fallbackUrl?: string;
}) {
  const url = text(page?.url) ?? fallbackUrl;
  const href = safeHref(url);
  const title = text(page?.title);
  const host = hostOf(url) ?? "a page";
  return (
    <ToolLine
      label={`Read ${host}`}
      detail={title}
      note={page?.truncated === true ? "It was long, so Steward read the start of it." : undefined}
      action={
        href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "px-2 text-caption")}
          >
            Open
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">{title ?? host} (opens in a new tab)</span>
          </a>
        ) : undefined
      }
    />
  );
}

// ── Output ──────────────────────────────────────────────────────────────────────────────────────

/** The last lines of a command's output, never more than `max` characters. */
export function tail(textValue: string, max = 1200): string {
  return textValue.length > max ? `…${textValue.slice(-max)}` : textValue;
}

export function CommandOutput({ result }: { result: Record<string, unknown> | undefined }) {
  const stdout = text(result?.stdout) ?? "";
  const stderr = text(result?.stderr) ?? "";
  const exit = typeof result?.exitCode === "number" ? result.exitCode : null;
  const timedOut = result?.timedOut === true;
  const output = [stdout, stderr].filter(Boolean).join("\n");
  return (
    <div>
      <p
        className={cn(
          "m-0 mb-1 flex items-center gap-1.5 text-caption",
          exit === 0 ? "text-ink-3" : "text-needs",
        )}
      >
        <Terminal aria-hidden className="size-3.5" />
        {timedOut
          ? "Stopped: it took too long."
          : exit === null
            ? "Finished."
            : exit === 0
              ? "Finished without errors."
              : `Finished with exit code ${exit}.`}
      </p>
      {output ? (
        <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-tile bg-tile p-2 font-mono text-caption text-ink">
          {tail(output)}
        </pre>
      ) : (
        <p className="m-0 text-caption text-ink-3">No output.</p>
      )}
    </div>
  );
}
