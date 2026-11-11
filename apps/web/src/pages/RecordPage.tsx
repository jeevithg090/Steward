import type { AuditEvent, AuditType, ChainCheck, Initiator } from "@steward/shared";
import { Check, ChevronDown, Copy, Download, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { RuleBadge } from "@/components/cards/RuleBadge.tsx";
import { Button, buttonVariants } from "@/components/ui/Button.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { Field, Input, Select } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { type AuditFilters, api, useAudit, useCheckRecord, useVerifyAudit } from "@/lib/api.ts";
import { AUDIT_TYPE_LABELS, deviceVia, EFFECT_LABELS, targetSummary, toolLabel } from "@/lib/labels.ts";
import { usageSummary } from "@/lib/usage.ts";
import { cn, formatDateTime, plural, prettyJson, relativeTime } from "@/lib/utils.ts";

const PAGE_SIZE = 50;

/** The outcomes the record can be filtered by, as the server names them. */
const OUTCOMES: { value: string; label: string }[] = [
  { value: "allow", label: "Permitted" },
  { value: "ask", label: "Asked" },
  { value: "deny", label: "Refused" },
  { value: "failed", label: "Failed" },
];

/** "12 entries." or, with a filter on, "1 entry matches." */
function countSentence(total: number, filtered: boolean): string {
  const count = plural(total, "entry", "entries");
  return filtered ? `${count} ${total === 1 ? "matches" : "match"}.` : `${count}.`;
}

/**
 * The record: every decision, request, answer and outcome, newest first. Each row seals the one
 * before it (a hash chain), and the badge at the top asks the server to check the chain.
 * The filters live in the address, so they survive a reload and Back, and a link can open them.
 */
export function RecordPage() {
  const [params, setParams] = useSearchParams();
  const typeParam = params.get("type") ?? "";
  const type = typeParam in AUDIT_TYPE_LABELS ? typeParam : "";
  const effectParam = params.get("effect") ?? "";
  const effect = OUTCOMES.some((o) => o.value === effectParam) ? effectParam : "";
  const q = params.get("q") ?? "";
  const from = Number(params.get("from"));
  const before = Number.isSafeInteger(from) && from > 0 ? from + 1 : undefined;
  const [search, setSearch] = useState(q);
  const filtered = Boolean(type || effect || q);
  const filters: AuditFilters = {
    type: type || undefined,
    effect: effect || undefined,
    q: q || undefined,
    limit: PAGE_SIZE,
    before,
  };
  const audit = useAudit(filters);
  const events = audit.data?.pages.flatMap((p) => p.events) ?? [];
  const total = audit.data?.pages[0]?.total;
  const started = startersOf(events);

  function setFilter(name: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  }

  // Back or a link can change the search in the address; the field follows it. The field keeps
  // what is being typed when only the spaces at its ends differ: "web " stays, ready for the next word.
  useEffect(() => setSearch((typed) => (typed.trim() === q ? typed : q)), [q]);

  // Search as the person pauses typing, not on every key.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the typed search changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() !== q) setFilter("q", search.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // The count is announced when the person changes a filter, not each time a new entry arrives.
  const filterKey = `${type}|${effect}|${q}`;
  const [announced, setAnnounced] = useState({ key: filterKey, text: "" });
  if (announced.key !== filterKey && total !== undefined && !audit.isFetching) {
    setAnnounced({ key: filterKey, text: countSentence(total, filtered) });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setFilter("q", search.trim());
  }

  /** Opens the record at one entry, with no filter that could hide it. */
  function showEntry(seq: number) {
    setSearch("");
    setParams(new URLSearchParams({ from: String(seq) }), { replace: true });
  }

  return (
    <Page
      title="Record"
      width="wide"
      description={
        <p>
          Everything Steward did, asked, or was refused, newest first. Each entry seals the one before it, so
          a changed entry shows up as a broken chain.
        </p>
      }
    >
      <ChainBadge onShowEntry={showEntry} />
      <KeepACopy />

      <form
        onSubmit={submit}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3"
        aria-label="Filter the record"
      >
        <Field label="What happened">
          <Select value={type} onChange={(e) => setFilter("type", e.target.value)}>
            <option value="">Everything</option>
            {(Object.keys(AUDIT_TYPE_LABELS) as AuditType[]).map((t) => (
              <option key={t} value={t}>
                {AUDIT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Outcome">
          <Select value={effect} onChange={(e) => setFilter("effect", e.target.value)}>
            <option value="">Any</option>
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="A tool, a web address, an email…"
          />
        </Field>
      </form>

      <section aria-labelledby="record-entries" className="flex flex-col gap-3">
        <h2 id="record-entries" className="sr-only">
          Entries
        </h2>
        <p className="text-ink-2 text-sub">{total !== undefined ? countSentence(total, filtered) : ""}</p>
        <p aria-live="polite" className="sr-only">
          {announced.text}
        </p>
        {before !== undefined ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sub">
            <span className="text-ink-2">Showing entry #{before - 1} and older.</span>
            <Button variant="link" onClick={() => setFilter("from", "")}>
              Back to the newest
            </Button>
          </p>
        ) : null}
        {audit.isPending ? (
          <Loading>Loading the record…</Loading>
        ) : audit.isError ? (
          <ErrorNotice
            title="Couldn't load the record"
            error={audit.error}
            onRetry={() => void audit.refetch()}
          />
        ) : events.length === 0 ? (
          <EmptyState icon={ScrollText} title={filtered ? "Nothing matches" : "Nothing recorded yet"}>
            {filtered
              ? "Try another filter, or clear the search."
              : "Every action Steward takes, and every decision about one, will be written here."}
          </EmptyState>
        ) : (
          <ol className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
            {events.map((event) => (
              <li key={event.id} className="border-hair-2 border-t first:border-t-0">
                <AuditRow event={event} startedBy={startedByOf(event, started)} />
              </li>
            ))}
          </ol>
        )}
        {audit.hasNextPage ? (
          <Button
            className="self-center"
            loading={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            Show older entries
          </Button>
        ) : null}
      </section>
    </Page>
  );
}

/**
 * "Record intact", saying whether every entry was just checked or only the new ones, or a warning
 * naming the first broken entry: what it means, what still holds, and what to do. The page asks
 * every minute; the button checks everything.
 */
function ChainBadge({ onShowEntry }: { onShowEntry: (seq: number) => void }) {
  const verify = useVerifyAudit({ refetchInterval: 60_000 });
  const whole = useCheckRecord();
  if (verify.isPending) return <Loading className="justify-start py-2">Checking the record…</Loading>;
  if (verify.isError) {
    return (
      <ErrorNotice
        title="Couldn't check the record"
        error={verify.error}
        onRetry={() => void verify.refetch()}
      />
    );
  }
  const check = verify.data;
  const checkAll = (
    <Button size="sm" loading={whole.isPending} onClick={() => whole.mutate({ full: true })}>
      Check the whole record
    </Button>
  );
  const at = check.brokenAt;
  return (
    <div className="flex flex-col gap-3">
      {check.ok ? (
        // Only "intact" is announced: the count grows with every entry and would be read out each time.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-field bg-done-soft px-4 py-3 text-sub">
          <ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-done" />
          <span className="font-semibold text-ink">
            <span role="status">Record intact</span> · {plural(check.count, "entry", "entries")}
            {check.scope === "recent" ? "" : " verified"}
          </span>
          <span className="text-ink-2">{intactDetail(check)}</span>
          <span className="sm:ml-auto">{checkAll}</span>
        </div>
      ) : (
        <div role="alert" className="flex items-start gap-3 rounded-field bg-problem-soft px-4 py-3 text-sub">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-problem" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="font-semibold text-ink">The record has been changed</p>
            <p className="text-ink-2">
              {at !== undefined
                ? `Entry #${at} is missing, out of order, or no longer seals the entry before it. The ${plural(check.count, "entry", "entries")} before it still check out; from #${at} on, the record can't be trusted.`
                : "Part of the chain no longer matches. Entries after the break can't be trusted."}
            </p>
            <p className="text-ink-2">
              Steward still checks every action against your rules before it acts. Only the history is in
              doubt.
            </p>
            <p className="text-ink-2">
              Keep a copy of <code className="break-all font-mono">.steward-data/steward.db</code> as it is
              now. You can check that file yourself, with the short script under "Checking it" in{" "}
              <code className="font-mono">docs/governance.md</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              {at !== undefined ? (
                <Button size="sm" onClick={() => onShowEntry(at)}>
                  Show entry #{at}
                </Button>
              ) : null}
              {checkAll}
            </div>
          </div>
        </div>
      )}
      {whole.isError ? <ErrorNotice title="Couldn't check the whole record" error={whole.error} /> : null}
    </div>
  );
}

/** Who started each tool call and run, from the decisions on screen: only those record it. */
function startersOf(events: AuditEvent[]): Map<string, Initiator> {
  const started = new Map<string, Initiator>();
  for (const event of events) {
    const initiator = initiatorOf(event);
    if (!initiator) continue;
    if (event.toolCallId) started.set(`call:${event.toolCallId}`, initiator);
    if (event.runId && !started.has(`run:${event.runId}`)) started.set(`run:${event.runId}`, initiator);
  }
  return started;
}

const INITIATOR_KINDS = new Set<string>(["person", "routine", "task", "resume", "system", "device"]);

function initiatorOf(event: AuditEvent): Initiator | undefined {
  const initiator = event.detail?.initiator as Partial<Initiator> | string | undefined;
  // A run's own row (`run.finished`) records only the kind, as a word.
  if (typeof initiator === "string") {
    return INITIATOR_KINDS.has(initiator) ? { kind: initiator as Initiator["kind"], id: "" } : undefined;
  }
  return initiator && typeof initiator.kind === "string" ? (initiator as Initiator) : undefined;
}

function startedByOf(event: AuditEvent, started: Map<string, Initiator>): Initiator | undefined {
  return (
    initiatorOf(event) ??
    (event.toolCallId ? started.get(`call:${event.toolCallId}`) : undefined) ??
    (event.runId ? started.get(`run:${event.runId}`) : undefined)
  );
}

/** Who an entry was by, in words: "You", "A routine, for you", "Steward, after your answer". */
function actorLabel(event: AuditEvent, startedBy: Initiator | undefined, fromPhone?: string): string {
  const you = event.actorId === "local" ? "You" : event.actorId;
  const forYou = event.actorId === "local" ? "for you" : `for ${event.actorId}`;
  switch (startedBy?.kind) {
    case "routine":
      return `A routine, ${forYou}`;
    case "task":
      return `A task, ${forYou}`;
    case "resume":
      return event.actorId === "local" ? "Steward, after your answer" : `Steward, after ${you} answered`;
    case "system":
      return `Steward, ${forYou}`;
    default:
      return fromPhone ? `${you}, from ${fromPhone}` : you;
  }
}

/** The collapsed row's note for work nobody started by hand. */
const STARTED_BY: Partial<Record<Initiator["kind"], string>> = {
  routine: "Started by a routine",
  task: "Started by a task",
  resume: "Carried on after your answer",
  system: "Started by Steward",
};
function intactDetail(check: ChainCheck): string {
  if (check.scope !== "recent") return "Every entry was checked and still seals the one before it.";
  const when = relativeTime(check.fullCheckAt);
  return when
    ? `New entries checked. Every entry was checked ${when}.`
    : "New entries checked. Older entries were checked before.";
}

/**
 * The newest seal to write down somewhere else, a box to check one written down earlier, and the
 * whole record as a download. A record rewritten from the start still chains; a saved seal shows it.
 */
function KeepACopy() {
  const verify = useVerifyAudit({ refetchInterval: 60_000 });
  const saved = useCheckRecord();
  const [seal, setSeal] = useState("");
  const head = verify.data?.ok ? verify.data.head : undefined;

  function checkSaved(event: FormEvent) {
    event.preventDefault();
    const anchor = seal.trim().replace(/^#/, "");
    if (anchor) saved.mutate({ anchor });
  }

  return (
    <details className="group rounded-card bg-card px-4 text-sub shadow-card">
      <summary className="flex min-h-target cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
        <h2 className="min-w-0 flex-1 font-semibold text-ink">Keep a copy elsewhere</h2>
        {head ? <span className="text-caption text-ink-2 tabular-nums">Newest seal #{head.seq}</span> : null}
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-ink-2 transition-transform duration-(--st-dur-swap) group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-4 pb-4">
        {head ? (
          <div className="flex flex-col gap-2">
            <p className="text-ink-2">
              The newest seal. Write it down somewhere off this computer now and then: if the record is ever
              cut short or rewritten, it will no longer match.
            </p>
            <p className="break-all font-mono text-caption text-ink">
              <span className="text-ink-2">#{head.seq}:</span>
              {head.hash}
            </p>
            <CopySeal text={`${head.seq}:${head.hash}`} />
          </div>
        ) : null}
        <form onSubmit={checkSaved} className="flex flex-col gap-2" aria-label="Check a saved seal">
          <Field
            label="Check a seal you saved"
            description="The entry number, a colon, then the seal, as you copied it."
          >
            <Input
              value={seal}
              onChange={(e) => setSeal(e.target.value)}
              placeholder="1234:3fa9…"
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <Button type="submit" className="self-start" loading={saved.isPending} disabled={!seal.trim()}>
            Check it
          </Button>
          <SavedSealResult check={saved.data} error={saved.error} pending={saved.isPending} />
        </form>
        <div className="flex flex-col items-start gap-1">
          <a href={api.audit.exportUrl} download className={buttonVariants({ size: "md" })}>
            <Download aria-hidden="true" />
            Download the record
          </a>
          <p className="text-caption text-ink-2">Every entry with its seal, oldest first, in one file.</p>
        </div>
      </div>
    </details>
  );
}

function SavedSealResult({
  check,
  error,
  pending,
}: {
  check: ChainCheck | undefined;
  error: Error | null;
  pending: boolean;
}) {
  if (pending) return null;
  if (error) return <p className="text-problem">{error.message}</p>;
  const anchor = check?.anchor;
  if (!check || !anchor) return null;
  return (
    <p role="status" className={anchor.ok ? "text-ink" : "font-semibold text-problem"}>
      {sealMessage(check, anchor)}
    </p>
  );
}

function sealMessage(check: ChainCheck, anchor: NonNullable<ChainCheck["anchor"]>): string {
  const broken = check.brokenAt;
  if (!anchor.ok) {
    // A break before the seal: the walk never reached it, so whether it matches says nothing.
    return broken !== undefined && broken <= anchor.seq
      ? `Entry #${broken} is missing or has changed, so the record up to your seal at entry #${anchor.seq} can't be trusted.`
      : `That seal doesn't match entry #${anchor.seq}. The record was cut short or rewritten since you saved it.`;
  }
  if (check.ok) return `That seal still matches entry #${anchor.seq}. The record up to it has not changed.`;
  return broken !== undefined
    ? `That seal still matches entry #${anchor.seq}, but entry #${broken} is missing or has changed.`
    : `That seal still matches entry #${anchor.seq}, but the record has been changed.`;
}

function CopySeal({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      className="self-start"
      icon={copied ? <Check /> : <Copy />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("Seal copied");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Couldn't copy. Select the seal and copy it yourself.");
        }
      }}
    >
      {copied ? "Copied" : "Copy the seal"}
    </Button>
  );
}

/** How a recorded run ended, from its `run.finished` detail. */
const RUN_OUTCOMES: Record<string, { label: string; tone: "done" | "needs" | "neutral" | "problem" }> = {
  success: { label: "Done", tone: "done" },
  interrupt: { label: "Asked you", tone: "needs" },
  cancelled: { label: "Stopped", tone: "neutral" },
  error: { label: "Failed", tone: "problem" },
};

function outcomeOf(event: AuditEvent) {
  if (event.type === "tool.failed") return { label: "Failed", tone: "problem" as const };
  if (event.type === "tool.completed") return { label: "Done", tone: "done" as const };
  if (event.type === "run.finished") {
    const outcome = event.detail?.outcome;
    return typeof outcome === "string" ? RUN_OUTCOMES[outcome] : undefined;
  }
  if (event.effect) return EFFECT_LABELS[event.effect];
  return undefined;
}

function AuditRow({ event, startedBy }: { event: AuditEvent; startedBy?: Initiator }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const outcome = outcomeOf(event);
  const target = targetSummary(event.target);
  const refusal = event.effect === "deny";
  const fromPhone = deviceVia(event.detail);
  const actor = actorLabel(event, startedBy, fromPhone);
  const startedNote = startedBy ? STARTED_BY[startedBy.kind] : undefined;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-target w-full items-start gap-3 px-4 py-3 text-left hover:bg-tile"
      >
        <span className="w-14 shrink-0 pt-0.5 text-caption text-ink-3 tabular-nums">#{event.seq}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {outcome ? <Pill tone={outcome.tone}>{outcome.label}</Pill> : null}
            <span className="font-medium text-ink text-sub">
              {AUDIT_TYPE_LABELS[event.type] ?? event.type}
            </span>
            {event.tool ? <span className="text-ink text-sub">· {toolLabel(event.tool.name)}</span> : null}
          </span>
          {target ? <span className="mt-0.5 block break-all text-ink-2 text-sub">{target}</span> : null}
          {fromPhone && event.type === "approval.decided" ? (
            <span className="mt-0.5 block text-ink-2 text-sub">Answered from {fromPhone}</span>
          ) : fromPhone ? (
            <span className="mt-0.5 block text-ink-2 text-sub">From {fromPhone}</span>
          ) : startedNote ? (
            <span className="mt-0.5 block text-ink-2 text-sub">{startedNote}</span>
          ) : null}
          {event.type === "run.finished" ? (
            <span className="mt-0.5 block text-ink-2 text-sub">{usageSummary(event.detail)}</span>
          ) : null}
          {refusal && event.rule ? (
            <span className="mt-1 block text-sub">
              <span className="text-ink-2">Refused by </span>
              <RuleBadge rule={event.rule} />
            </span>
          ) : null}
          <span className="mt-0.5 block text-caption text-ink-3">
            <time dateTime={event.at} title={formatDateTime(event.at)}>
              {relativeTime(event.at)}
            </time>
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "mt-1 size-5 shrink-0 text-ink-2 transition-transform duration-(--st-dur-swap)",
            open && "rotate-180",
          )}
        />
        <span className="sr-only">{open ? "Hide details" : "Show details"}</span>
      </button>
      <div id={detailId} hidden={!open} className="px-4 pb-4 sm:pl-21">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-caption sm:grid-cols-[8rem_1fr]">
          <dt className="text-ink-2">When</dt>
          <dd className="text-ink">{formatDateTime(event.at)}</dd>
          <dt className="text-ink-2">By</dt>
          <dd className="text-ink">
            {actor}
            {event.agentId ? ` · agent ${event.agentId}` : ""}
          </dd>
          {!refusal && event.rule ? (
            <>
              <dt className="text-ink-2">Rule</dt>
              <dd>
                <RuleBadge rule={event.rule} />
              </dd>
            </>
          ) : null}
          {event.threadId ? (
            <>
              <dt className="text-ink-2">Conversation</dt>
              <dd>
                <Link
                  to={`/chat/${encodeURIComponent(event.threadId)}`}
                  className="text-accent underline underline-offset-4 hover:text-accent-hover"
                >
                  Open the conversation
                </Link>
              </dd>
            </>
          ) : null}
          {event.toolCallId ? (
            <>
              <dt className="text-ink-2">Call</dt>
              <dd className="break-all font-mono text-ink">{event.toolCallId}</dd>
            </>
          ) : null}
          <dt className="text-ink-2">Seal</dt>
          <dd className="break-all font-mono text-ink-2">{event.hash}</dd>
        </dl>
        {Object.keys(event.detail ?? {}).length > 0 ? (
          <pre className="mt-3 max-h-80 overflow-auto rounded-field bg-tile p-3 text-caption text-ink">
            {prettyJson(event.detail)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
