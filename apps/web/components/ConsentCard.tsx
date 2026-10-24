import type { ConsentAsk } from "@/lib/api";

export function ConsentCard({
  ask, busy, onAnswer,
}: { ask: ConsentAsk; busy: boolean; onAnswer: (approved: boolean) => void }) {
  return (
    <section aria-labelledby="consent-heading" className="rounded-xl border-4 border-teal-700 bg-teal-50 p-4">
      <h2 id="consent-heading" className="text-lg font-semibold">Tempo is asking you</h2>
      <p className="mt-2 text-lg">{ask.summary}</p>
      <div className="mt-4 flex gap-3">
        <button
          type="button" disabled={busy} onClick={() => onAnswer(true)}
          className="rounded-lg bg-teal-800 px-6 py-3 text-lg font-semibold text-white focus:outline-4 focus:outline-amber-500 disabled:opacity-50"
        >
          Yes, claim £{ask.amount_gbp}
        </button>
        <button
          type="button" disabled={busy} onClick={() => onAnswer(false)}
          className="rounded-lg border-2 border-slate-800 px-6 py-3 text-lg font-semibold focus:outline-4 focus:outline-amber-500 disabled:opacity-50"
        >
          No
        </button>
      </div>
    </section>
  );
}
