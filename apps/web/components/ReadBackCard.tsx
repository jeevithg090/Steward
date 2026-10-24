import { useState } from "react";

/** The agent read the card; one fact is unsure, so it asks once before planning (spec §7.1). */
export function ReadBackCard({
  question, date, busy, onConfirm,
}: {
  question: string;
  date: string;
  busy: boolean;
  onConfirm: (date: string, corrected: boolean) => void;
}) {
  const [value, setValue] = useState(date);
  return (
    <section aria-labelledby="readback-heading" className="rounded-xl border-4 border-amber-600 bg-amber-50 p-4">
      <h2 id="readback-heading" className="text-lg font-semibold">Tempo read the card</h2>
      <p className="mt-2 text-lg">{question}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <button type="button" disabled={busy} onClick={() => onConfirm(date, false)} className="rounded-lg bg-teal-800 px-5 py-2 font-semibold text-white disabled:opacity-50">
          Yes, that&apos;s right
        </button>
        <label className="text-sm">
          Or the right date
          <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="ml-2 rounded border-2 border-slate-400 px-2 py-1" />
        </label>
        <button type="button" disabled={busy || !value} onClick={() => onConfirm(value, true)} className="rounded-lg border-2 border-slate-800 px-4 py-2 font-semibold disabled:opacity-50">
          Use this date
        </button>
      </div>
    </section>
  );
}
