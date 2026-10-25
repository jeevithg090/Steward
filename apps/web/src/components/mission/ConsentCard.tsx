import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Fingerprint, HandCoins } from "lucide-react";
import { Badge, Button, Card, FOCUS } from "@/components/ui";
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

/** "Tempo is asking you": the one question, the exact amount, and why (Proof Trace, the Court). */
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
    <Card as="section" tone="indigo" aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-indigo-100">
          <HandCoins size={16} aria-hidden className="text-indigo-300" /> Tempo is asking you
        </h2>
        <div className="flex items-center gap-2">
          {demoValues && (
            <Badge tone="amber" title="Rule packs and clocks are demo values until a person checks each source">
              demo values
            </Badge>
          )}
          <Badge tone="indigo">{gbp(ask.amount_gbp)}</Badge>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-slate-200">{ask.summary}</p>
      {signed && (
        <p id={signedId} className="flex items-start gap-2 text-xs leading-relaxed text-indigo-100">
          <Fingerprint size={14} aria-hidden className="mt-0.5 shrink-0 text-indigo-300" />
          You&apos;ll confirm with Face ID or your fingerprint. Your answer is signed on this device.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ok"
          size="lg"
          busy={busy}
          icon={signed ? <Fingerprint size={18} aria-hidden /> : undefined}
          aria-describedby={signed ? signedId : undefined}
          onClick={() => onAnswer(true)}
        >
          {yesWords(amount, { signed, waits: handsOver })}
        </Button>
        <Button variant="quiet" size="lg" disabled={busy} onClick={() => onAnswer(false)}>
          No
        </Button>
      </div>
      {why && (ask.proof_trace || theCourt !== undefined) && (
        <div className="border-t border-white/10 pt-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={whyId}
            onClick={() => setOpen((o) => !o)}
            className={`flex items-center gap-1 rounded text-xs font-semibold text-indigo-200 hover:text-indigo-100 ${FOCUS}`}
          >
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} Why this amount
          </button>
          {open && (
            <div id={whyId} className="mt-3 space-y-4">
              {ask.proof_trace && <ProofTrace trace={ask.proof_trace} id={`${whyId}-proof`} bare />}
              <CourtVotes court={theCourt} id={`${whyId}-court`} bare />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
