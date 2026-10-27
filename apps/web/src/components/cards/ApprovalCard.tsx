import type { Approval, ApprovalAnswer } from "@steward/shared";
import { Ban, Check, CheckCheck, Hand, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { Input } from "@/components/ui/Field.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { ApiError, useApproval, useDecideApproval } from "@/lib/api.ts";
import { KIND_LABELS, targetSummary, toolLabel } from "@/lib/labels.ts";
import { cn, prettyJson, relativeTime } from "@/lib/utils.ts";
import { RuleBadge } from "./RuleBadge.tsx";

/** What a screen reader hears once an answer has gone through. */
const ANNOUNCE: Record<ApprovalAnswer, string> = {
  once: "Allowed once. Steward will carry on.",
  always: "Allowed. Steward won't ask again for this.",
  refuse: "Refused. Steward won't do this.",
};

export interface ApprovalCardProps {
  approvalId: string;
  /** The approval as the caller already has it (from a list or an interrupt), drawn at once. */
  initial?: Approval;
  /** Called with the decided approval after the server accepts the answer. */
  onDecided?: (approval: Approval) => void;
  /** Heading level of the summary in the page outline. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * Steward asking before it acts: what it wants to do, where, why it asks, anything sensitive in
 * it, and three answers. "Always allow" appears only when the gateway offers it; payments,
 * credentials, tainted sends and the person's own ask rules never offer it.
 */
export function ApprovalCard({
  approvalId,
  initial,
  onDecided,
  headingLevel = 3,
  className,
}: ApprovalCardProps) {
  const query = useApproval(approvalId, initial);
  const decide = useDecideApproval();
  const [announcement, setAnnouncement] = useState("");
  const [chosen, setChosen] = useState<ApprovalAnswer | undefined>();

  const approval = query.data;
  if (!approval) {
    return (
      <Card raised className={className}>
        {query.isError ? (
          <p role="alert" className="text-problem text-sub">
            Couldn't load this request. {query.error.message}
          </p>
        ) : (
          <p role="status" className="text-ink-2 text-sub">
            Loading the request…
          </p>
        )}
      </Card>
    );
  }

  function answer(value: ApprovalAnswer, note?: string) {
    setChosen(value);
    decide.mutate(
      { id: approvalId, answer: value, note: note?.trim() || undefined },
      {
        onSuccess: (decided) => {
          setAnnouncement(ANNOUNCE[value]);
          onDecided?.(decided);
        },
        onError: (error) => {
          if (error.status === 409) void query.refetch();
        },
      },
    );
  }

  const errorMessage =
    decide.error instanceof ApiError
      ? decide.error.status === 409
        ? "This was already answered, or it expired. Here is where it stands."
        : decide.error.message
      : undefined;

  return (
    <ApprovalCardView
      approval={approval}
      headingLevel={headingLevel}
      className={className}
      onAnswer={answer}
      busy={decide.isPending ? chosen : undefined}
      error={errorMessage}
      announcement={announcement}
    />
  );
}

export interface ApprovalCardViewProps {
  approval: Approval;
  /** Omit for a static example: the buttons are drawn but do nothing. */
  onAnswer?: (answer: ApprovalAnswer, note?: string) => void;
  /** The answer being sent, for its button's spinner. */
  busy?: ApprovalAnswer;
  error?: string;
  announcement?: string;
  headingLevel?: 2 | 3 | 4;
  /** Marks the card as an example, so nobody mistakes it for a real request. */
  example?: boolean;
  className?: string;
}

/** How an approval looks, without fetching. Used by the card and by the onboarding example. */
export function ApprovalCardView({
  approval,
  onAnswer,
  busy,
  error,
  announcement = "",
  headingLevel = 3,
  example = false,
  className,
}: ApprovalCardViewProps) {
  const titleId = useId();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const Heading = `h${headingLevel}` as const;
  const pending = approval.status === "pending";
  const target = targetSummary(approval.target);
  const findings = approval.decision.findings ?? [];
  const interactive = Boolean(onAnswer) && !example;

  return (
    <Card
      as="section"
      raised
      aria-labelledby={titleId}
      className={cn(pending && "shadow-[0_0_0_2px_var(--st-needs),var(--st-shadow-raised)]", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Outcome approval={approval} />
        {example ? (
          <Pill tone="neutral" icon={null}>
            Example
          </Pill>
        ) : null}
        <span className="text-caption text-ink-3">{relativeTime(approval.createdAt)}</span>
      </div>

      <Heading id={titleId} className="mt-3 font-semibold text-body text-ink">
        {approval.summary}
      </Heading>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sub sm:grid-cols-[minmax(6rem,auto)_1fr]">
        <dt className="text-ink-2">What</dt>
        <dd className="text-ink">
          {toolLabel(approval.tool.name)}{" "}
          <span className="text-ink-2">({KIND_LABELS[approval.tool.kind] ?? approval.tool.kind})</span>
        </dd>
        {target ? (
          <>
            <dt className="text-ink-2">Where</dt>
            <dd className="break-words text-ink">{target}</dd>
          </>
        ) : null}
        <dt className="text-ink-2">Why it asks</dt>
        <dd className="text-ink">
          {approval.decision.rule ? (
            <>
              <RuleBadge rule={approval.decision.rule} />
              <span className="mt-1 block text-ink-2">{approval.decision.reason}</span>
            </>
          ) : (
            approval.decision.reason
          )}
        </dd>
      </dl>

      {findings.length > 0 ? (
        <div className="mt-4 rounded-field bg-needs-soft px-4 py-3">
          <p className="flex items-center gap-2 font-semibold text-needs text-sub">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
            Sensitive details would leave Steward
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-ink text-sub">
            {findings.map((finding) => (
              <li key={`${finding.kind}-${finding.hint}`}>
                {finding.label} <span className="font-mono">{finding.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {Object.keys(approval.args ?? {}).length > 0 ? (
        <details className="group mt-3">
          <summary className="inline-flex min-h-target cursor-pointer items-center text-accent text-sub underline underline-offset-4">
            Show exactly what it will send
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-field bg-tile p-3 text-caption text-ink">
            {prettyJson(approval.args)}
          </pre>
        </details>
      ) : null}

      {pending ? (
        <>
          {showNote ? (
            <div className="mt-3">
              <label htmlFor={noteId} className="font-medium text-sub">
                Tell Steward why (optional)
              </label>
              <Input
                id={noteId}
                className="mt-1.5"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder="For example: not this week"
              />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<Ban />}
              loading={busy === "refuse"}
              disabled={Boolean(busy) || !interactive}
              onClick={() => onAnswer?.("refuse", note)}
            >
              Refuse
            </Button>
            <Button
              variant="primary"
              icon={<Check />}
              loading={busy === "once"}
              disabled={Boolean(busy) || !interactive}
              onClick={() => onAnswer?.("once", note)}
            >
              Allow once
            </Button>
            {approval.canAlways ? (
              <Button
                variant="secondary"
                icon={<CheckCheck />}
                loading={busy === "always"}
                disabled={Boolean(busy) || !interactive}
                onClick={() => onAnswer?.("always", note)}
              >
                Always allow
              </Button>
            ) : null}
            {!showNote && interactive ? (
              <Button variant="ghost" size="sm" onClick={() => setShowNote(true)}>
                Add a note
              </Button>
            ) : null}
          </div>
          <p className="mt-3 text-caption text-ink-2">
            {approval.canAlways
              ? "Always allow adds a standing rule you can revoke in Rules. "
              : "This kind of action always asks, so there is no Always allow. "}
            {approval.expiresAt ? `Expires ${relativeTime(approval.expiresAt)}.` : null}
          </p>
        </>
      ) : (
        <DecidedNote approval={approval} />
      )}

      {error ? (
        <p role="alert" className="mt-3 font-medium text-problem text-sub">
          {error}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </Card>
  );
}

function Outcome({ approval }: { approval: Approval }): ReactNode {
  switch (approval.status) {
    case "pending":
      return (
        <Pill tone="needs" icon={Hand}>
          Steward is asking
        </Pill>
      );
    case "allowed":
      return <Pill tone="done">{approval.answer === "always" ? "Always allowed" : "Allowed once"}</Pill>;
    case "refused":
      return <Pill tone="problem">Refused</Pill>;
    case "expired":
      return <Pill tone="neutral">Expired</Pill>;
    case "cancelled":
      return <Pill tone="neutral">Cancelled</Pill>;
  }
}

function DecidedNote({ approval }: { approval: Approval }) {
  const when = approval.decidedAt ? ` ${relativeTime(approval.decidedAt)}` : "";
  let text: string;
  switch (approval.status) {
    case "allowed":
      text =
        approval.answer === "always"
          ? `You allowed this${when}, and Steward won't ask again for the same thing.`
          : `You allowed this once${when}.`;
      break;
    case "refused":
      text = `You refused this${when}. Steward didn't do it.`;
      break;
    case "expired":
      text = "Nobody answered in time, so Steward didn't do it.";
      break;
    default:
      text = "The work that asked has stopped, so nothing happened.";
  }
  return <p className="mt-4 text-ink-2 text-sub">{text}</p>;
}
