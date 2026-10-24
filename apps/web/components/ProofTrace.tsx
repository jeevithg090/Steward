import type { ProofTraceData } from "@/lib/api";

/** fact (source) → rule (version) → citation → amount, for every money step (spec §5). */
export function ProofTrace({ trace }: { trace: ProofTraceData }) {
  return (
    <section aria-labelledby="proof-heading" className="rounded-xl border-2 border-slate-300 bg-white p-4">
      <h2 id="proof-heading" className="text-lg font-semibold">Proof Trace</h2>
      <ol className="mt-2 space-y-2">
        {trace.steps.map((step) => (
          <li key={`${step.rule_id}-${step.explanation}`}>
            <p>{step.explanation}</p>
            <p className="text-sm text-slate-700">
              Rule {step.rule_id} v{step.rule_version} ·{" "}
              <a href={step.citation_url} className="font-medium text-teal-800 underline" target="_blank" rel="noreferrer">
                published source
              </a>
              {step.fact_keys.length > 0 && <> · facts: {step.fact_keys.join(", ")}</>}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-2xl font-bold">£{trace.amount_gbp}</p>
    </section>
  );
}
