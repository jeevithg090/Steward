import type { AuditEvent, AuditType, ChainCheck } from "@steward/shared";
import { Check, ChevronDown, Copy, Download, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
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

/**
 * The record: every decision, request, answer and outcome, newest first. Each row seals the one
 * before it (a hash chain), and the badge at the top asks the server to check the chain.
 */
export function RecordPage() {
  const [type, setType] = useState("");
  const [effect, setEffect] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const filters: AuditFilters = {
    type: type || undefined,
    effect: effect || undefined,
    q: q || undefined,
    limit: PAGE_SIZE,
  };
  const audit = useAudit(filters);
  const events = audit.data?.pages.flatMap((p) => p.events) ?? [];
  const total = audit.data?.pages[0]?.total;

  // Search as the person pauses typing, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setQ(search.trim());
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
      <ChainBadge />
      <KeepACopy />

      <form
        onSubmit={submit}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3"
        aria-label="Filter the record"
      >
        <Field label="What happened">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Everything</option>
            {(Object.keys(AUDIT_TYPE_LABELS) as AuditType[]).map((t) => (
              <option key={t} value={t}>
                {AUDIT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Outcome">
          <Select value={effect} onChange={(e) => setEffect(e.target.value)}>
            <option value="">Any</option>
            <option value="allow">Permitted</option>
            <option value="ask">Asked</option>
            <option value="deny">Refused</option>
            <option value="failed">Failed</option>
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
        <p aria-live="polite" className="text-ink-2 text-sub">
          {total !== undefined
            ? `${plural(total, "entry", "entries")}${type || effect || q ? " match" : ""}.`
            : ""}
        </p>
        {audit.isPending ? (
          <Loading>Loading the record…</Loading>
        ) : audit.isError ? (
          <ErrorNotice
            title="Couldn't load the record"
            error={audit.error}
            onRetry={() => void audit.refetch()}
          />
        ) : events.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={type || effect || q ? "Nothing matches" : "Nothing recorded yet"}
          >
            {type || effect || q
              ? "Try another filter, or clear the search."
              : "Every action Steward takes, and every decision about one, will be written here."}
          </EmptyState>
        ) : (
          <ol className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
            {events.map((event) => (
              <li key={event.id} className="border-hair-2 border-t first:border-t-0">
                <AuditRow event={event} />
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
 * "Record intact", saying whether every entry was just checked or only the new ones, or a red
 * warning naming the first broken entry. The page asks every minute; the button checks everything.
 */
function ChainBadge() {
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
  return (
    <div className="flex flex-col gap-3">
      {check.ok ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-field bg-done-soft px-4 py-3 text-sub"
        >
          <ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-done" />
          <span className="font-semibold text-ink">
            Record intact · {plural(check.count, "entry", "entries")}
            {check.scope === "recent" ? "" : " verified"}
          </span>
          <span className="text-ink-2">{intactDetail(check)}</span>
          <span className="sm:ml-auto">{checkAll}</span>
        </div>
      ) : (
        <div role="alert" className="flex items-start gap-3 rounded-field bg-problem-soft px-4 py-3 text-sub">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-problem" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p className="font-semibold text-ink">The record has been changed</p>
            <p className="text-ink-2">
              {check.brokenAt !== undefined
                ? `Entry #${check.brokenAt} is missing or has changed. Everything from there on can't be trusted.`
                : "Part of the chain no longer matches. Entries after the break can't be trusted."}{" "}
              {plural(check.count, "entry", "entries")} before it checked.
            </p>
            {checkAll}
          </div>
        </div>
      )}
      {whole.isError ? <ErrorNotice title="Couldn't check the whole record" error={whole.error} /> : null}
    </div>
  );
}

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

function AuditRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const outcome = outcomeOf(event);
  const target = targetSummary(event.target);
  const refusal = event.effect === "deny";
  const actor = event.actorId === "local" ? "You" : event.actorId;
  const fromPhone = deviceVia(event.detail);

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
            {fromPhone ? `, from ${fromPhone}` : ""}
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
              <dd className="break-all font-mono text-ink">{event.threadId}</dd>
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
