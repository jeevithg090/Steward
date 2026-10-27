/**
 * The secret box. When Steward needs a password or a code on a page, it asks here instead of in
 * the conversation. The value goes to the page and nowhere else: it is read from the field once,
 * sent once over the screen's socket, and the field is emptied. It is never held in React state,
 * never logged, and never shown to Steward. The record keeps only that a secret was asked for.
 *
 * Flow adapted from OpenBot's computer view secret form (MIT, CopilotKit).
 */
import type { SecretRequest } from "@steward/shared";
import { KeyRound, ShieldCheck } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";

export interface SecretBoxProps {
  /** The open request, from the computer's status. Nothing shows without one. */
  request: SecretRequest | undefined;
  /** Whether the screen's socket is open, so the value can actually be sent. */
  connected: boolean;
  /** Sends the value. Returns false when it could not be sent. */
  onSend: (requestId: string, value: string) => boolean;
  onCancel: (requestId: string) => void;
}

export function SecretBox({ request, connected, onSend, onCancel }: SecretBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const inputId = useId();
  const helpId = useId();

  const open = request !== undefined && dismissedFor !== request.id;
  const sent = request !== undefined && sentFor === request.id;
  const shownProblem = request && problem?.id === request.id ? problem.text : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request || sent) return;
    const input = inputRef.current;
    if (!input) return;
    if (input.value === "") {
      setProblem({ id: request.id, text: "Type it in first." });
      input.focus();
      return;
    }
    const delivered = onSend(request.id, input.value);
    // Emptied whether or not it went: a value that failed to send is typed again, never kept.
    input.value = "";
    if (delivered) {
      setSentFor(request.id);
      setProblem(null);
    } else {
      setProblem({
        id: request.id,
        text: "The screen isn't connected, so nothing was sent. Type it again once it reconnects.",
      });
      input.focus();
    }
  }

  function cancel() {
    if (!request) return;
    if (inputRef.current) inputRef.current.value = "";
    setDismissedFor(request.id);
    onCancel(request.id);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <KeyRound aria-hidden className="size-5 text-accent" />
          Steward needs something only you should type
        </span>
      }
      description={request ? `${request.label}, for ${request.host}.` : undefined}
      size="sm"
      placement="sheet"
      initialFocus={inputRef}
    >
      {request ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="m-0 rounded-tile bg-tile px-3 py-2 text-ink text-sub">
            The page asking is on <strong className="font-semibold">{request.host}</strong>. Check that this
            is the site you expect before you type.
          </p>
          <label htmlFor={inputId} className="font-medium text-ink text-sub">
            {request.label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="password"
            name="steward-secret"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            aria-describedby={helpId}
            aria-invalid={shownProblem ? true : undefined}
            disabled={sent}
            className="min-h-target w-full rounded-field border border-line bg-card px-3 text-body text-ink disabled:opacity-55"
          />
          <p id={helpId} className="m-0 flex items-start gap-1.5 text-caption text-ink-2">
            <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            It goes straight into the page. It isn't shown in the conversation, and Steward never sees it.
          </p>
          {shownProblem ? (
            <p role="alert" className="m-0 text-problem text-sub">
              {shownProblem}
            </p>
          ) : null}
          {sent ? (
            <p role="status" className="m-0 text-ink-2 text-sub">
              Sent to the page. Waiting for it to fill in…
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={sent || !connected}>
              Send to the page
            </Button>
          </div>
          {!connected && !sent ? (
            <p className="m-0 text-caption text-ink-3">Waiting for the screen to connect…</p>
          ) : null}
        </form>
      ) : null}
    </Dialog>
  );
}
