/**
 * Mail cards: one email Steward read (`mail_read`) and one Steward wants to send (`mail_send`).
 *
 * Bodies are plain text and drawn as text, never as HTML. The draft card shows exactly what would
 * leave: who it goes to, the subject and the whole body, with where it stands (sent, waiting for
 * your answer, refused) in words beside an icon.
 */
import { Check, Clock, LoaderCircle, type LucideIcon, Send, ShieldAlert, TriangleAlert } from "lucide-react";
import { Pill } from "@/components/ui/Pill.tsx";
import { formatWhen, recipientsOf } from "./format.ts";
import { CardFrame, Quiet, UntrustedNote } from "./kit.tsx";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The first `max` characters of a long body, and whether there is more. */
function preview(body: string, max = 600): { head: string; more: boolean } {
  if (body.length <= max) return { head: body, more: false };
  const cut = body.lastIndexOf(" ", max);
  return { head: `${body.slice(0, cut > max * 0.6 ? cut : max)}…`, more: true };
}

export function EmailCard({
  email,
  untrusted,
  untrustedNotice,
}: {
  email: Record<string, unknown> | undefined;
  untrusted?: boolean;
  untrustedNotice?: string;
}) {
  if (!email) {
    return (
      <CardFrame title="Email">
        <Quiet>Opening the email…</Quiet>
      </CardFrame>
    );
  }
  const subject = text(email.subject) ?? "(no subject)";
  const from = recipientsOf(email.from)[0] ?? "Unknown sender";
  const to = recipientsOf(email.to);
  const body = text(email.body) ?? text(email.snippet) ?? "";
  const { head, more } = preview(body);
  const when = formatWhen(email.receivedAt);
  return (
    <CardFrame title={subject} label={`Email: ${subject}`} caption={when ? `${from} · ${when}` : from}>
      {to.length > 0 ? <p className="m-0 mb-2 text-caption text-ink-3">To {to.join(", ")}</p> : null}
      {more ? (
        <details>
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <p className="m-0 whitespace-pre-wrap text-sub text-ink">{head}</p>
            <span className="mt-1 inline-flex min-h-target items-center text-sub font-medium text-accent">
              Show all
            </span>
          </summary>
          <p className="m-0 whitespace-pre-wrap text-sub text-ink">{body}</p>
        </details>
      ) : (
        <p className="m-0 whitespace-pre-wrap text-sub text-ink">{body || "This email has no text."}</p>
      )}
      {untrusted ? <UntrustedNote notice={untrustedNotice} /> : null}
    </CardFrame>
  );
}

export type DraftState = "writing" | "waiting" | "sent" | "refused" | "failed";

const DRAFT_STATUS: Record<
  DraftState,
  { tone: "working" | "needs" | "done" | "problem"; icon: LucideIcon; word: string }
> = {
  writing: { tone: "working", icon: LoaderCircle, word: "Sending" },
  waiting: { tone: "needs", icon: Clock, word: "Waiting for your answer" },
  sent: { tone: "done", icon: Check, word: "Sent" },
  refused: { tone: "problem", icon: ShieldAlert, word: "Not sent" },
  failed: { tone: "problem", icon: TriangleAlert, word: "Didn't send" },
};

export function DraftCard({
  draft,
  state,
  note,
}: {
  draft: Record<string, unknown> | undefined;
  state: DraftState;
  /** Why it was refused or failed, in plain words. */
  note?: string;
}) {
  const to = recipientsOf(draft?.to);
  const cc = recipientsOf(draft?.cc);
  const subject = text(draft?.subject) ?? "(no subject)";
  const body = text(draft?.body) ?? "";
  const status = DRAFT_STATUS[state];
  return (
    <CardFrame
      title={
        <span className="inline-flex items-center gap-2">
          <Send aria-hidden className="size-4 text-ink-3" />
          Email
        </span>
      }
      label={`Email to ${to.join(", ") || "no one yet"}: ${subject}`}
      action={
        <Pill tone={status.tone} icon={status.icon}>
          {status.word}
        </Pill>
      }
      footer={note ? <p className="m-0 text-caption text-ink-2">{note}</p> : undefined}
    >
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sub">
        <dt className="text-ink-3">To</dt>
        <dd className="m-0 min-w-0 break-words text-ink">{to.join(", ") || "—"}</dd>
        {cc.length > 0 ? (
          <>
            <dt className="text-ink-3">Cc</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{cc.join(", ")}</dd>
          </>
        ) : null}
        <dt className="text-ink-3">Subject</dt>
        <dd className="m-0 min-w-0 break-words font-medium text-ink">{subject}</dd>
      </dl>
      <p className="m-0 mt-3 whitespace-pre-wrap rounded-tile bg-tile p-3 text-sub text-ink">
        {body || "(empty)"}
      </p>
    </CardFrame>
  );
}
