"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Gateway, type LedgerTotals, gatewayConfig } from "@/lib/api";
import { ShowcaseGateway } from "@/lib/showcase";
import { useShowcase } from "@/lib/use-showcase";

/** The Time Ledger's totals: live from the Gateway when one answers, recorded in the showcase. */
export function LiveCounters({ gateway: injected }: { gateway?: Pick<Gateway, "ledger"> }) {
  const showcase = useShowcase(injected instanceof ShowcaseGateway ? true : undefined);
  const gateway = useMemo(
    () => injected ?? (showcase.active ? new ShowcaseGateway() : new Gateway(gatewayConfig())),
    [injected, showcase.active],
  );
  const [totals, setTotals] = useState<LedgerTotals | null | "unreachable">(null);

  useEffect(() => {
    let live = true;
    gateway
      .ledger()
      .then((t) => live && setTotals(t))
      .catch(() => live && setTotals("unreachable"));
    return () => {
      live = false;
    };
  }, [gateway]);

  const value = (key: keyof LedgerTotals, fallback: string) =>
    totals && totals !== "unreachable" ? totals[key] : fallback;

  return (
    <section aria-labelledby="counters-heading" className="rounded-xl border-2 border-teal-800 bg-white p-6">
      <h2 id="counters-heading" className="text-lg font-semibold text-slate-700">The Time Ledger so far</h2>
      <dl className="mt-3 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-medium text-slate-700">Hours of life returned</dt>
          <dd className="text-5xl font-bold tabular-nums text-teal-800">{value("hours_returned", "—")}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-slate-700">Pounds recovered, counted once the money arrived</dt>
          <dd className="text-5xl font-bold tabular-nums text-teal-800">
            {totals && totals !== "unreachable" ? `£${totals.gbp_recovered}` : "—"}
          </dd>
        </div>
      </dl>
      <p role="status" className="mt-3 text-sm text-slate-700">
        {totals === null && "Asking the Gateway…"}
        {totals === "unreachable" && (
          <>
            No Gateway is answering right now. <Link href="/?showcase=1" className="underline">Open the recorded showcase</Link> instead.
          </>
        )}
        {totals && totals !== "unreachable" && (showcase.active
          ? "Recorded from a replay-mode Gateway: Amir's late 07:58 was claimed and paid before Margaret's story starts."
          : `Live from the Gateway at ${gatewayConfig().url}. Minutes are counted when a claim is filed, pounds only once the money has arrived.`)}
      </p>
    </section>
  );
}
