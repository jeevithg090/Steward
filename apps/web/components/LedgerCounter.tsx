import type { LedgerTotals } from "@/lib/api";

export function LedgerCounter({ totals }: { totals: LedgerTotals | null }) {
  return (
    <section aria-label="Time Ledger" className="text-right">
      <p className="text-sm font-medium text-slate-600">Hours of life returned</p>
      <p className="text-4xl font-bold tabular-nums text-teal-800">{totals?.hours_returned ?? "0.0"}</p>
      <p className="text-sm text-slate-700">£{totals?.gbp_recovered ?? "0.00"} recovered</p>
    </section>
  );
}
