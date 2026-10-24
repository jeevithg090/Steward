"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEMO_MISSION, Gateway, gatewayConfig, type Health, type LedgerTotals, type MissionView } from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { AgentCards } from "./AgentCards";
import { ConsensusGavels } from "./ConsensusGavels";
import { ConsentCard } from "./ConsentCard";
import { HonestyBadge } from "./HonestyBadge";
import { LedgerCounter } from "./LedgerCounter";
import { MissionTimeline } from "./MissionTimeline";
import { ProofTrace } from "./ProofTrace";
import { StallRadar } from "./StallRadar";
import { STATE_LABELS } from "./labels";
import { TraceLink } from "./TraceLink";

export function MissionControl({ gateway: injected }: { gateway?: Gateway }) {
  const gateway = useMemo(() => injected ?? new Gateway(gatewayConfig()), [injected]);
  const [health, setHealth] = useState<Health | null>(null);
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerTotals | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { events, connected } = useLiveEvents(gateway.eventsUrl());

  const refresh = useCallback(async () => {
    try {
      const [h, m, l] = await Promise.all([gateway.health(), gateway.missions(), gateway.ledger()]);
      setHealth(h);
      setMissions(m);
      setLedger(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [gateway]);

  useEffect(() => {
    void refresh();
  }, [refresh, events.length]);

  const act = async (work: () => Promise<MissionView | unknown>) => {
    setBusy(true);
    try {
      const result = await work();
      if (result && typeof result === "object" && "id" in result) setSelected((result as MissionView).id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mission = missions.find((m) => m.id === selected) ?? missions[0] ?? null;

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Tempo · Mission Control</h1>
          <p className="text-slate-700">Your time, returned.</p>
        </div>
        <HonestyBadge health={health} />
        <LedgerCounter totals={ledger} />
      </header>

      {error && <p role="alert" className="mb-4 rounded-lg bg-rose-100 p-3 text-rose-900">Can't reach the Gateway: {error}</p>}

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr_18rem]">
        <nav aria-label="Missions" className="space-y-3">
          <button
            type="button" disabled={busy} onClick={() => act(() => gateway.start(DEMO_MISSION))}
            className="w-full rounded-lg bg-teal-800 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            Start Margaret's claim
          </button>
          <ul className="space-y-2">
            {missions.map((m) => (
              <li key={m.id}>
                <button
                  type="button" onClick={() => setSelected(m.id)} aria-current={m.id === mission?.id ? "true" : undefined}
                  className={`w-full rounded-lg border-2 p-2 text-left ${m.id === mission?.id ? "border-teal-700 bg-white" : "border-slate-200"}`}
                >
                  <span className="block text-sm text-slate-600">{m.id}</span>
                  <span className="font-medium">{STATE_LABELS[m.state]}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label="Selected mission" className="space-y-6">
          {mission === null ? (
            <p className="text-lg">No missions yet. Start Margaret's claim to watch Tempo work.</p>
          ) : (
            <>
              <h2 className="text-2xl font-semibold">{STATE_LABELS[mission.state]}</h2>
              {mission.message && !mission.ask && <p className="text-lg">{mission.message}</p>}
              {mission.ask && <ConsentCard ask={mission.ask} busy={busy} onAnswer={(yes) => act(() => gateway.answer(mission.ask!.request_id, yes))} />}
              {mission.state === "waiting" && (
                <button type="button" disabled={busy} onClick={() => act(() => gateway.tick())} className="rounded-lg border-2 border-slate-800 px-4 py-2 font-semibold">
                  Check the payment now
                </button>
              )}
              {mission.ask?.proof_trace && <ProofTrace trace={mission.ask.proof_trace} />}
              <AgentCards state={mission.state} reached={mission.timeline.map((t) => t.to)} />
              <ConsensusGavels court={mission.court} />
              <MissionTimeline mission={mission} />
              <TraceLink url={mission.trace_url} />
              {!["declined", "failed_safe", "verified"].includes(mission.state) && (
                <button type="button" disabled={busy} onClick={() => act(() => gateway.stop(mission.id))} className="text-sm font-semibold text-rose-800 underline">
                  Stop this mission
                </button>
              )}
            </>
          )}
        </section>

        <aside className="space-y-6">
          <StallRadar events={events} />
          <section aria-labelledby="feed-heading">
            <h2 id="feed-heading" className="mb-2 text-lg font-semibold">Live feed {connected ? "●" : "○"}</h2>
            <ul aria-live="polite" className="space-y-1 text-sm">
              {events.slice(0, 12).map((e, i) => (
                <li key={i}>{e.type.replaceAll("_", " ")}{typeof e.to === "string" ? ` → ${e.to}` : ""}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
