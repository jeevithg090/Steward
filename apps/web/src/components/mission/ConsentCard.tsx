import { useId, useState } from "react";
import { ChevronDown, Fingerprint, HandCoins } from "lucide-react";
import { Badge, Button, FOCUS } from "@/components/ui";
import type { ConsentAsk, CourtDecision } from "@/lib/api";
import { CourtVotes } from "./CourtVotes";
import { ProofTrace } from "./ProofTrace";
import { gbp } from "./words";

/** The ask may carry the court too (the Gateway sends it on the mission and inside the ask). */
type AskWithCourt = ConsentAsk & { court?: CourtDecision | null };

export interface ConsentCardProps {
  ask: ConsentAsk;
  /** The mission's court, when the ask does not carry one. */
  court?: CourtDecision | null;
  busy?: boolean;
  onAnswer: (approved: boolean) => void;
  /** Hide the "Why this amount" section (the detail page shows Proof Trace and the Court on their own). */
  why?: boolean;
  /** This device answers with its passkey (useMesh().signs): the yes says Face ID, and why. */
  signed?: boolean;
  /** The plan is to wait on purpose, so a yes hands the case over rather than files a claim today.
   * Defaults to what the ask itself says ("I'll wait for now"). */
  waits?: boolean;
}

const WAITS = /\bI'll wait for now\b/i;

/** The yes, in words that match what happens next: a claim today, or the case handed over. */
function yesWords(amount: string, { signed = false, waits = false }: { signed?: boolean; waits?: boolean } = {}): string {
  const yes = waits ? "Yes, handle it for me" : `Yes, claim £${amount}`;
  return signed ? `${yes} with Face ID` : yes;
}

/**
 * "Tempo is asking you": the one decision on the page. The exact amount in gold, the question in
 * Tempo's words, a gold Yes and a plain No, and (in the chat) why that amount (Proof Trace, the Court).
 */
export function ConsentCard({ ask, court, busy = false, onAnswer, why = true, signed = false, waits }: ConsentCardProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const whyId = useId();
  const signedId = useId();
  const demoValues = /demo values/i.test(ask.summary);
  const theCourt = (ask as AskWithCourt).court ?? court ?? null;
  const amount = gbp(ask.amount_gbp).replace("£", "");
  const handsOver = waits ?? WAITS.test(ask.summary);

  return (
    <section
      aria-labelledby={headingId}
      className="relative overflow-hidden rounded-3xl border border-accent-300/25 bg-gradient-to-b from-accent-500/[0.16] via-accent-500/[0.06] to-gold-400/[0.04] text-slate-200 shadow-[0_1px_0_0_rgb(255_255_255/0.08)_inset,0_30px_60px_-30px_rgb(var(--accent-500)/0.55)] motion-safe:animate-scale-in"
    >
      {/* The agent's violet light above, the gold of the money below. */}
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-24 h-60 w-60 rounded-full bg-accent-500/25 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-28 -right-10 h-56 w-56 rounded-full bg-gold-400/[0.12] blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-accent-200/60 to-transparent" />

      <div className="relative p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="flex items-center gap-2.5 text-[15px] font-semibold text-white">
            <span aria-hidden className="relative grid h-8 w-8 place-items-center rounded-full bg-accent-500/25 text-accent-100 ring-1 ring-inset ring-accent-300/30">
              <span className="absolute inset-0 rounded-full bg-accent-400/30 motion-safe:animate-ripple" />
              <HandCoins size={15} className="relative" />
            </span>
            Tempo is asking you
          </h2>
          {demoValues && (
            <Badge tone="amber" dot title="Rule packs and clocks are demo values until a person checks each source">
              demo values
            </Badge>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="shrink-0 sm:min-w-[8.5rem]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-200">{handsOver ? "Worth" : "To claim"}</p>
            <p className="num mt-1.5 text-[2.5rem] font-semibold leading-none tracking-[-0.03em] text-gold">{gbp(ask.amount_gbp)}</p>
          </div>
          <p className="min-w-0 flex-1 border-white/[0.08] text-[15px] leading-relaxed text-slate-200 sm:border-l sm:pl-6">{ask.summary}</p>
        </div>

        {signed && (
          <p id={signedId} className="mt-4 flex items-start gap-2 rounded-2xl border border-accent-300/15 bg-accent-500/[0.08] px-3 py-2.5 text-xs leading-relaxed text-accent-100">
            <Fingerprint size={14} aria-hidden className="mt-0.5 shrink-0 text-accent-300" />
            You&apos;ll confirm with Face ID or your fingerprint. Your answer is signed on this device.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button
            variant="gold"
            size="lg"
            busy={busy}
            icon={signed ? <Fingerprint size={18} aria-hidden /> : undefined}
            aria-describedby={signed ? signedId : undefined}
            onClick={() => onAnswer(true)}
            className="font-semibold"
          >
            {yesWords(amount, { signed, waits: handsOver })}
          </Button>
          <Button variant="quiet" size="lg" disabled={busy} onClick={() => onAnswer(false)} className="min-w-[5.5rem]">
            No
          </Button>
        </div>

        {why && (ask.proof_trace || theCourt !== undefined) && (
          <div className="mt-5 border-t border-white/[0.08] pt-4">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={whyId}
              onClick={() => setOpen((o) => !o)}
              className={`-ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-[13px] font-semibold text-accent-200 transition-colors hover:text-white motion-reduce:transition-none ${FOCUS}`}
            >
              <ChevronDown size={15} aria-hidden className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`} /> Why this amount
            </button>
            {open && (
              <div id={whyId} className="mt-4 space-y-6 motion-safe:animate-fade-up">
                {ask.proof_trace && <ProofTrace trace={ask.proof_trace} id={`${whyId}-proof`} bare />}
                <CourtVotes court={theCourt} id={`${whyId}-court`} bare />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
