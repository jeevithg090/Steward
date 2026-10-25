// Mission Control (plan.md §2): every mission with its state, and one mission in full with its
// timeline, Proof Trace, Court, Rights Portfolio, Passport, outcome and demo controls. Works on a
// live Gateway and in the showcase (ShowcaseGateway walks the recorded missions).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Play, RefreshCw } from "lucide-react";
import { LedgerCounter, ReadBackCard, plainError } from "@/components/mission";
import { Button, EmptyState, PageTitle, Spinner } from "@/components/ui";
import { type CardReading, DEMO_BROADBAND, DEMO_MISSION, type LedgerTotals, type MissionView } from "@/lib/api";
import { navigate } from "@/router";
import type { PageProps } from "@/types/page";
import { MissionDetail } from "./MissionDetail";
import { MissionList } from "./MissionList";

const REFRESH_ON = new Set(["mission_created", "state_changed", "consent_requested", "timer_set", "outcome", "ledger", "mandate_issued", "mandate_revoked", "mandate_verified", "mandate_refused"]);

async function toBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The demo card (${url}) is missing.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function MissionsPage({ gateway, showcase, health, events, params, speak }: PageProps) {
  const [missions, setMissions] = useState<MissionView[] | null>(null);
  const [ledger, setLedger] = useState<LedgerTotals | null>(null);
  const [detail, setDetail] = useState<MissionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<CardReading | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const id = params.id ?? null;
  // The state we last saw for the open mission, so the outcome is spoken when it changes, not on load.
  const lastSeen = useRef<{ id: string; state: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([gateway.missions(), gateway.ledger()]);
      setMissions(list);
      setLedger(totals);
      if (id) setDetail(list.find((m) => m.id === id) ?? (await gateway.mission(id)));
      else setDetail(null);
      setError(null);
    } catch (e) {
      setError(plainError(e));
    }
  }, [gateway, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refetch on any event that changes a mission or the ledger (App holds the one socket).
  const relevant = useMemo(() => events.filter((e) => REFRESH_ON.has(e.type)).length, [events]);
  useEffect(() => {
    if (relevant > 0) void refresh();
  }, [relevant, refresh]);

  // The demo beat: when the money arrives, Tempo says so.
  useEffect(() => {
    if (!detail) return;
    const before = lastSeen.current;
    lastSeen.current = { id: detail.id, state: detail.state };
    if (before?.id === detail.id && before.state !== detail.state && detail.state === "verified" && detail.outcome?.message) speak(detail.outcome.message);
  }, [detail, speak]);

  const act = useCallback(
    async (work: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await work();
        await refresh();
        if (done) setNotice(done);
        return result;
      } catch (e) {
        setError(plainError(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const startMargaret = () =>
    act(async () => {
      const view = await gateway.start(DEMO_MISSION);
      navigate(`/missions/${view.id}`);
      return view;
    });

  const readCard = () =>
    act(async () => {
      const image_b64 = await toBase64("/demo/missed-visit-card.png");
      const read = await gateway.readCard({ image_b64, filename: "missed_visit_card.png", user_id: DEMO_BROADBAND.user_id, display_name: DEMO_BROADBAND.display_name });
      if (read.question) {
        setReading(read);
        speak(read.question);
      } else if (read.mission) {
        navigate(`/missions/${read.mission.id}`);
      } else if (read.visit) {
        const view = await gateway.startOfcom(clean(read.visit));
        navigate(`/missions/${view.id}`);
      }
      return read;
    });

  const confirmReading = (date: string, corrected: boolean) =>
    act(async () => {
      const visit = clean(reading?.visit ?? {});
      const source = `${visit.source ?? "card#vision"}, ${corrected ? "corrected" : "confirmed"} by ${DEMO_BROADBAND.display_name}`;
      setReading(null);
      const view = await gateway.startOfcom({ ...visit, event_date: date, source });
      navigate(`/missions/${view.id}`);
      return view;
    });

  const header = (
    <PageTitle
      lede={showcase ? "Recorded missions from a replay-mode Gateway; the buttons walk them through their recorded states." : "Every mission, its state, and the proof behind each pound."}
      right={<LedgerCounter totals={ledger} />}
    >
      Mission Control
    </PageTitle>
  );

  if (error && missions === null) {
    return (
      <div>
        {header}
        <EmptyState title="Mission Control can't reach the Gateway" tone="error" action={<Button variant="quiet" onClick={() => void refresh()}>Try again</Button>}>
          {error}
        </EmptyState>
      </div>
    );
  }

  if (missions === null) {
    return (
      <div>
        {header}
        <Spinner label="Loading missions" />
      </div>
    );
  }

  if (id) {
    return (
      <div>
        {header}
        {error && (
          <p role="alert" className="mb-3 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
        {detail ? (
          <MissionDetail
            mission={detail}
            health={health}
            events={events}
            busy={busy}
            onAnswer={(requestId, approved) => void act(() => (approved ? gateway.answer(requestId, true) : gateway.stop(detail.id)))}
            onStop={() => void act(() => gateway.stop(detail.id), "Stopped. Nothing more will be sent.")}
            onTick={() => void act(() => gateway.tick())}
            onAdvanceClock={(days) => void act(() => gateway.advanceClock(days), `The demo clock moved ${days} days ahead.`)}
            onCreditArrives={() => void act(() => gateway.creditArrives(detail.id), "The credit has arrived; the next check will find it.")}
            onRevoke={(mandateId) => void act(() => gateway.revokeMandate(mandateId), "The mandate is revoked.")}
          />
        ) : (
          <EmptyState title="There is no mission with that id" action={<Button variant="quiet" onClick={() => navigate("/missions")}>All missions</Button>} />
        )}
        <div aria-live="polite" className="mt-3 min-h-5 text-xs text-slate-400">
          {notice}
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" busy={busy} icon={<Play size={14} aria-hidden />} onClick={() => void startMargaret()}>
          Start Margaret&apos;s claim
        </Button>
        <Button variant="quiet" busy={busy} icon={<Camera size={14} aria-hidden />} onClick={() => void readCard()}>
          Read Margaret&apos;s missed-visit card
        </Button>
        <Button variant="quiet" size="sm" disabled={busy} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh()} aria-label="Refresh missions">
          Refresh
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      {reading?.question && reading.visit && (
        <div className="mb-4">
          <ReadBackCard question={reading.question} date={String(reading.visit.event_date ?? "")} busy={busy} onConfirm={(date, corrected) => void confirmReading(date, corrected)} onCancel={() => setReading(null)} />
        </div>
      )}
      {missions.length === 0 ? (
        <EmptyState title="No missions yet">Start Margaret&apos;s claim to watch Tempo work.</EmptyState>
      ) : (
        <MissionList missions={missions} />
      )}
      <div aria-live="polite" className="mt-3 min-h-5 text-xs text-slate-400">
        {notice}
      </div>
    </div>
  );
}

/** The card's visit facts as the Gateway wants them: strings only. */
function clean(visit: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(visit)) if (v !== null && v !== undefined) out[k] = String(v);
  return out;
}
