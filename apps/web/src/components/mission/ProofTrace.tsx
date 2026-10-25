import { ArrowRight, ExternalLink, Route } from "lucide-react";
import { Card, FOCUS } from "@/components/ui";
import type { ProofTraceData } from "@/lib/api";
import { PanelHeading } from "./look";
import { gbp } from "./words";

/** fact → rule vX → published source → amount, for every money step (the Proof Trace). */
export function ProofTrace({ trace, id = "proof-heading", bare = false }: { trace: ProofTraceData; id?: string; bare?: boolean }) {
  const body = (
    <>
      <PanelHeading id={id} icon={<Route size={16} />} title="Proof Trace" sub="Each step, from the facts to the rule to its published source." className="mb-5" />
      <ol className="relative">
        {trace.steps.map((step, i) => (
          <li key={`${step.rule_id}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
            {i < trace.steps.length - 1 && <span aria-hidden className="absolute bottom-1 left-[15px] top-10 w-px bg-gradient-to-b from-accent-300/40 to-accent-300/[0.06]" />}
            <span
              aria-hidden
              className="num relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-500/15 text-[13px] font-semibold text-accent-100 ring-1 ring-inset ring-accent-300/35 shadow-[0_0_18px_-4px_rgb(var(--accent-500)/0.6)]"
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm leading-relaxed text-slate-100">{step.explanation}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                {step.fact_keys.length > 0 && (
                  <>
                    <span className="text-slate-400">facts:</span>
                    {step.fact_keys.map((k) => (
                      <span key={k} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-slate-300 ring-1 ring-inset ring-white/10">
                        {k.replaceAll("_", " ")}
                      </span>
                    ))}
                    <ArrowRight size={12} aria-hidden className="mx-0.5 text-slate-500" />
                  </>
                )}
                <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-slate-400 ring-1 ring-inset ring-accent-300/20">
                  rule <span className="font-mono text-accent-200">{step.rule_id}</span> v{step.rule_version}
                </span>
                <ArrowRight size={12} aria-hidden className="mx-0.5 text-slate-500" />
                <a
                  href={step.citation_url}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1 rounded-full px-1 font-medium text-accent-300 underline decoration-accent-300/40 underline-offset-2 transition-colors hover:text-accent-100 hover:decoration-accent-100 motion-reduce:transition-none ${FOCUS}`}
                >
                  published source <ExternalLink size={11} aria-hidden />
                </a>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-gold-300/20 bg-gradient-to-r from-gold-400/[0.08] to-gold-400/[0.02] px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-200">Amount</span>
        <span className="num text-2xl font-semibold leading-none tracking-[-0.02em] text-gold">{gbp(trace.amount_gbp)}</span>
      </div>
    </>
  );
  if (bare) return <section aria-labelledby={id}>{body}</section>;
  return (
    <Card as="section" aria-labelledby={id}>
      {body}
    </Card>
  );
}
