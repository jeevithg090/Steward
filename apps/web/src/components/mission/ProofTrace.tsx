import { ExternalLink } from "lucide-react";
import { Card, FOCUS, SectionTitle } from "@/components/ui";
import type { ProofTraceData } from "@/lib/api";
import { gbp } from "./words";

/** fact → rule vX → published source → amount, for every money step (the Proof Trace). */
export function ProofTrace({ trace, id = "proof-heading", bare = false }: { trace: ProofTraceData; id?: string; bare?: boolean }) {
  const body = (
    <>
      <SectionTitle id={id} as="h3">
        Proof Trace
      </SectionTitle>
      <ol className="space-y-3">
        {trace.steps.map((step, i) => (
          <li key={`${step.rule_id}-${i}`} className="flex gap-3">
            <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-[10px] font-semibold text-purple-200">
              {i + 1}
            </span>
            <div className="min-w-0 text-sm text-slate-200">
              <p>{step.explanation}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                {step.fact_keys.length > 0 && <span>facts: {step.fact_keys.map((k) => k.replaceAll("_", " ")).join(", ")}</span>}
                <span aria-hidden>→</span>
                <span>
                  rule <span className="font-mono text-purple-200">{step.rule_id}</span> v{step.rule_version}
                </span>
                <span aria-hidden>→</span>
                <a
                  href={step.citation_url}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1 rounded text-indigo-300 underline hover:text-indigo-200 ${FOCUS}`}
                >
                  published source <ExternalLink size={11} aria-hidden />
                </a>
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</span>
        <span className="text-xl font-semibold tabular-nums text-slate-100">{gbp(trace.amount_gbp)}</span>
      </p>
    </>
  );
  if (bare) return <section aria-labelledby={id}>{body}</section>;
  return (
    <Card as="section" aria-labelledby={id}>
      {body}
    </Card>
  );
}
