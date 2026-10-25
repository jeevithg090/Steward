// Mission Control (plan.md §2, §12.3): every mission with its state, filtered by whose and how far
// along, and one mission in full with its ask, outcome, plan, proof, court, passport and timeline,
// plus the demo controls. Every action confirms with a toast; every failure says what to do next.
// Works on a live Gateway and in the showcase (ShowcaseGateway walks the recorded missions).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, Clock, Play, RefreshCw, Settings } from "lucide-react";
import { LedgerCounter, ReadBackCard, afterYes, isLive, plainError, rememberAsks, toastError } from "@/components/mission";
import { Badge, Button, EmptyState, FOCUS, PageTitle, Segmented, Skeleton, SkeletonCards, toast } from "@/components/ui";
import { type CardReading, DEMO_BROADBAND, DEMO_MISSION, type LedgerTotals, type MissionView } from "@/lib/api";
import { answerAsk } from "@/lib/approve";
import { useMesh } from "@/lib/mesh-context";
import { linkProps, navigate } from "@/router";
import type { PageProps } from "@/types/page";
import { MissionDetail } from "./MissionDetail";
import { MissionList } from "./MissionList";

const REFRESH_ON = new Set(["mission_created", "state_changed", "consent_requested", "timer_set", "outcome", "ledger", "mandate_issued", "mandate_revoked", "mandate_verified", "mandate_refused"]);

type Who = "mine" | "everyone";
type Phase = "live" | "finished" | "all";

async function toBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The demo card (${url}) is missing.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function MissionsPage({ gateway, user, showcase, health, events, params, speak }: PageProps) {
  const [missions, setMissions] = useState<MissionView[] | null>(null);
  const [ledger, setLedger] = useState<LedgerTotals | null>(null);
  const [detail, setDetail] = useState<MissionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<CardReading | null>(null);
  const [who, setWho] = useState<Who>("mine");
  const [phase, setPhase] = useState<Phase>("all");
  // The demo clock as this page last moved it; /health says it too, but App polls that slowly.
  const [movedDays, setMovedDays] = useState<number | null>(null);
  const { mesh, signs } = useMesh();
  const id = params.id ?? null;
  const clockDays = movedDays ?? health?.clock_offset_days ?? 0;
  // The state we last saw for the open mission, so the outcome is spoken when it changes, not on load.
  const lastSeen = useRef<{ id: string; state: string } | null>(null);

  /** Fetch the list, the ledger and the open mission; null when the Gateway did not answer. */
  const refresh = useCallback(async (): Promise<{ open: MissionView | null } | null> => {
    try {
      const [list, totals] = await Promise.all([gateway.missions(), gateway.ledger()]);
      rememberAsks(list); // a waiting mission's view has no amount; its last ask does
      setMissions(list);
      setLedger(totals);
      const open = id ? (list.find((m) => m.id === id) ?? (await gateway.mission(id))) : null;
      setDetail(open);
      setError(null);
      return { open };
    } catch (e) {
      setError(plainError(e));
      return null;
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

  /** Run one action, refresh, then confirm it with a toast worded from what changed. */
  const act = useCallback(
    async <T,>(work: () => Promise<T>, done?: (open: MissionView | null, result: T) => void): Promise<T | null> => {
      setBusy(true);
      try {
        const result = await work();
        const fresh = await refresh();
        done?.(fresh?.open ?? null, result);
        return result;
      } catch (e) {
        toastError(e);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const startDemoClaim = () =>
    act(
      async () => {
        const view = await gateway.start(DEMO_MISSION);
        navigate(`/missions/${view.id}`);
        return view;
      },
      () => toast.success("The demo claim has started. Tempo will ask before it acts."),
    );

  const readCard = () =>
    act(async () => {
      const image_b64 = await toBase64("/demo/missed-visit-card.png");
      const read = await gateway.readCard({ image_b64, filename: "missed_visit_card.png", user_id: DEMO_BROADBAND.user_id, display_name: DEMO_BROADBAND.display_name });
      if (read.question) {
        setReading(read);
        speak(read.question);
        toast.info("Tempo read the card. One thing to check.");
      } else if (read.mission) {
        navigate(`/missions/${read.mission.id}`);
        toast.success("Tempo read the card and started the broadband case.");
      } else if (read.visit) {
        const view = await gateway.startOfcom(clean(read.visit));
        navigate(`/missions/${view.id}`);
        toast.success("Tempo read the card and started the broadband case.");
      }
      return read;
    });

  const confirmReading = (date: string, corrected: boolean) =>
    act(
      async () => {
        const visit = clean(reading?.visit ?? {});
        const source = `${visit.source ?? "card#vision"}, ${corrected ? "corrected" : "confirmed"} by you`;
        setReading(null);
        const view = await gateway.startOfcom({ ...visit, event_date: date, source });
        navigate(`/missions/${view.id}`);
        return view;
      },
      () => toast.success(corrected ? "Date corrected. The broadband case has started." : "Thanks. The broadband case has started."),
    );

  const header = (
    <PageTitle
      lede={showcase ? "Recorded missions from a replay-mode Gateway; the buttons walk them through their recorded states." : "Every mission, its state, and the proof behind each pound."}
      right={
        id ? (
          <div className="rounded-full border border-gold-300/20 bg-gold-400/[0.06] px-4 py-2 shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset]">
            <LedgerCounter totals={ledger} compact counted />
          </div>
        ) : clockDays > 0 ? (
          <Badge tone="amber" dot title="The demo clock has been moved forward">
            <Clock size={12} aria-hidden /> Demo clock +{clockDays} days
          </Badge>
        ) : undefined
      }
    >
      Mission Control
    </PageTitle>
  );

  if (error && missions === null) {
    return (
      <div>
        {header}
        <EmptyState
          title="Mission Control can't reach the Gateway"
          tone="error"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="quiet" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh()}>
                Try again
              </Button>
              <a
                {...linkProps("/settings")}
                className={`inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 text-sm font-medium text-slate-100 transition-colors hover:border-white/20 hover:bg-white/[0.09] motion-reduce:transition-none ${FOCUS}`}
              >
                <Settings size={14} aria-hidden /> Settings
              </a>
            </div>
          }
        >
          {error}
        </EmptyState>
      </div>
    );
  }

  if (missions === null) {
    return (
      <div>
        {header}
        {!id && (
          <div aria-hidden className="surface mb-10 flex flex-wrap items-center gap-10 rounded-3xl p-6">
            <div className="space-y-3">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-9 w-20" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        )}
        <SkeletonCards count={3} label="Loading missions" />
      </div>
    );
  }

  if (id) {
    return (
      <div>
        {header}
        {detail ? (
          <MissionDetail
            mission={detail}
            me={user.id}
            health={health}
            events={events}
            busy={busy}
            signs={signs}
            clockDays={clockDays}
            onAnswer={(requestId, approved) =>
              void act(
                () => answerAsk({ gateway, mesh, signs }, requestId, approved),
                (_open, view) => {
                  if (!approved) return void toast.info("You said no. Nothing was sent.");
                  const words = afterYes(view);
                  toast[words.tone](words.text);
                },
              )
            }
            onStop={() => void act(() => gateway.stop(detail.id), () => toast.info("Stopped. Nothing more will be sent."))}
            onTick={() =>
              void act(
                () => gateway.tick(),
                (open, { fired }) =>
                  open?.state === "verified"
                    ? toast.success(open.outcome?.amount_gbp ? `Money arrived: £${open.outcome.amount_gbp}.` : "Money arrived.")
                    : fired.includes(detail.id)
                      ? toast.info("Checked. The money hasn't arrived yet.")
                      : toast.info("Not due yet: Tempo checks on the day it said."),
              )
            }
            onAdvanceClock={(days) =>
              void act(
                () => gateway.advanceClock(days),
                (open, moved) => {
                  setMovedDays(moved.offset_days);
                  toast.info(`The demo clock moved ${days} days ahead.${open?.plan?.action_today === "act" ? " Tempo is acting now." : ""}`);
                },
              )
            }
            onCreditArrives={() => void act(() => gateway.creditArrives(detail.id), () => toast.success("The credit has arrived. The next check will find it."))}
            onRevoke={(mandateId) => void act(() => gateway.revokeMandate(mandateId), () => toast.success("The mandate is revoked. Companies will see it is no longer valid."))}
            onChanged={() => void refresh()}
          />
        ) : (
          <EmptyState title="There is no mission with that id" action={<Button variant="quiet" onClick={() => navigate("/missions")}>All missions</Button>} />
        )}
      </div>
    );
  }

  const mine = missions.filter((m) => who === "everyone" || m.user_id === user.id);
  const shown = mine.filter((m) => phase === "all" || (phase === "live" ? isLive(m.state) : !isLive(m.state)));
  const liveCount = mine.filter((m) => isLive(m.state)).length;

  return (
    <div>
      {header}
      <LedgerCounter totals={ledger} />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button variant="primary" busy={busy} icon={<Play size={14} aria-hidden />} onClick={() => void startDemoClaim()}>
          Start the demo claim
        </Button>
        <Button variant="quiet" busy={busy} icon={<Camera size={14} aria-hidden />} onClick={() => void readCard()}>
          Read the demo missed-visit card
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-100">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-rose-300" />
          <span>{error}</span>
        </p>
      )}
      {reading?.question && reading.visit && (
        <div className="mt-6">
          <ReadBackCard question={reading.question} date={String(reading.visit.event_date ?? "")} busy={busy} onConfirm={(date, corrected) => void confirmReading(date, corrected)} onCancel={() => setReading(null)} />
        </div>
      )}
      <section aria-labelledby="missions-heading" className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-2">
            <h2 id="missions-heading" className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Missions
              <span className="num rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] tracking-normal text-slate-300">{shown.length}</span>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              icon={<RefreshCw size={13} aria-hidden />}
              onClick={() => void refresh().then((fresh) => fresh && toast.info("Missions refreshed."))}
            >
              Refresh
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Who>
              label="Whose missions"
              value={who}
              onChange={setWho}
              options={[
                { value: "mine", label: user.name ?? "Mine" },
                { value: "everyone", label: "Everyone" },
              ]}
            />
            <Segmented<Phase>
              label="Which missions"
              value={phase}
              onChange={setPhase}
              options={[
                { value: "live", label: "Live", count: liveCount },
                { value: "finished", label: "Finished", count: mine.length - liveCount },
                { value: "all", label: "All", count: mine.length },
              ]}
            />
          </div>
        </div>
        {missions.length === 0 ? (
          <EmptyState
            title="No missions yet"
            action={
              <Button variant="primary" busy={busy} icon={<Play size={14} aria-hidden />} onClick={() => void startDemoClaim()}>
                Start the demo claim
              </Button>
            }
          >
            Start the demo claim to watch Tempo work, or tell the chat about a late train.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState
            title={phase === "live" ? "Nothing is running right now" : phase === "finished" ? "Nothing has finished yet" : user.name ? `No missions for ${user.name} yet` : "You have no missions yet"}
            action={
              <Button
                variant="quiet"
                onClick={() => {
                  setWho("everyone");
                  setPhase("all");
                }}
              >
                Show every mission
              </Button>
            }
          />
        ) : (
          <MissionList missions={shown} me={user.id} />
        )}
      </section>
    </div>
  );
}

/** The card's visit facts as the Gateway wants them: strings only. */
function clean(visit: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(visit)) if (v !== null && v !== undefined) out[k] = String(v);
  return out;
}
