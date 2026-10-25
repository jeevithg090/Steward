import { Check, Scale, X } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui";
import type { CourtDecision } from "@/lib/api";

const OUTCOME_WORDS: Record<CourtDecision["outcome"], string> = {
  proceed: "Agreed",
  proceed_flagged: "Agreed, with a flag",
  human_checkpoint: "A person should look",
};

/** Three models from three providers vote on eligibility; the amount is never up for a vote. */
export function CourtVotes({ court, id = "court-heading", bare = false }: { court: CourtDecision | null; id?: string; bare?: boolean }) {
  const body = (
    <>
      <SectionTitle id={id} as="h3" right={court ? <Badge tone={court.outcome === "proceed" ? "emerald" : "amber"}>{OUTCOME_WORDS[court.outcome]}</Badge> : undefined}>
        Consensus Court
      </SectionTitle>
      {court === null ? (
        <p className="text-sm text-slate-300">Not needed: the rule is clear, so no models were asked.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {court.verdicts.map((v) => (
              <li
                key={v.juror}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                  v.verdict.eligible ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-rose-500/30 bg-rose-500/10 text-rose-100"
                }`}
                title={`${v.juror}: ${v.verdict.eligible ? "eligible" : "not eligible"}, confidence ${Math.round(v.verdict.confidence * 100)}%`}
              >
                {v.verdict.eligible ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
                <span className="font-mono">{v.juror}</span>
                <span className="sr-only">{v.verdict.eligible ? "eligible" : "not eligible"}</span>
              </li>
            ))}
            {court.absent.map((name) => (
              <li key={name} className="flex items-center gap-2 rounded-full border border-dashed border-white/20 px-3 py-1.5 text-xs text-slate-400" title={`${name} did not answer`}>
                <span className="font-mono">{name}</span>
                <span>absent</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Scale size={12} aria-hidden className="text-purple-300" />
            <span>{Math.round(court.agreement_rate * 100)}% agreement</span>
            {court.eligible !== null && <span>· {court.eligible ? "eligible" : "not eligible"}</span>}
            {court.flags.length > 0 && <span className="text-amber-200">· {court.flags.join("; ")}</span>}
          </p>
        </>
      )}
    </>
  );
  if (bare) return <section aria-labelledby={id}>{body}</section>;
  return (
    <Card as="section" aria-labelledby={id}>
      {body}
    </Card>
  );
}
