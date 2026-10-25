// Connectors (plan.md §14): the places a person's life already is (her email, calendar and bank
// statement, plus the rail records), each a small read-only MCP server Tempo talks to. "Sweep my
// inbox" reads them, keeps nothing, and lists what is worth a look with one tap to act. Below, the
// other direction: how any MCP client can use Tempo, which never lets it approve anything.
import { useCallback, useEffect, useRef, useState } from "react";
import { Cable, Inbox, LockKeyhole, RotateCcw, Sparkles } from "lucide-react";
import { Badge, Button, EmptyState, PageTitle, SkeletonCards, Spinner, toast } from "@/components/ui";
import { plainError, toastError } from "@/components/mission";
import type { Connector, SweepResult } from "@/lib/api";
import { itemsRead, sweepSentence } from "@/lib/connectors";
import type { PageProps } from "@/types/page";
import { ConnectorCard, ConnectorTile } from "./ConnectorCard";
import { FindingCard } from "./FindingCard";
import { McpSection } from "./McpSection";


export const INTRO = "Connect the places your life already is. Tempo reads them, never keeps them, and finds money you're owed.";

/** Long enough to see the progress, short enough not to wait for nothing (none in tests). */
const MIN_SWEEP_MS = import.meta.env.MODE === "test" ? 0 : 900;
const TAP = "min-h-[44px]";

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Plain words for a failed connectors call, with what to do next. */
function connectorsError(err: unknown, what: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/HTTP 404/.test(message) && /\/connectors/.test(message)) return `This Gateway has no connectors yet (${what} is missing). Update the Gateway, or switch on the showcase in Settings.`;
  return `${plainError(err).replace(/\.?$/, ".")} Try again, or check the Gateway in Settings.`;
}

export default function ConnectorsPage({ gateway, user, showcase, speak }: PageProps) {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [sweeping, setSweeping] = useState(false);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const findingsRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(() => {
    let live = true;
    setLoadError(null);
    gateway
      .connectors(user.id)
      .then((list) => {
        if (!live) return;
        setConnectors(list.connectors);
        setSimulated(list.simulated);
      })
      .catch((e) => live && setLoadError(connectorsError(e, "GET /connectors")));
    return () => {
      live = false;
    };
  }, [gateway, user.id]);
  useEffect(load, [load]);

  const toggle = useCallback(
    async (connector: Connector, on: boolean) => {
      setPending((p) => new Set(p).add(connector.id));
      try {
        const updated = on ? await gateway.connect(connector.id, user.id) : await gateway.disconnect(connector.id, user.id);
        setConnectors((list) => list?.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)) ?? list);
        if (updated.connected) toast.success(`${updated.name} connected. Tempo reads it only when you sweep, and keeps nothing.`);
        else toast.info(`${updated.name} is off. Tempo won't read it.`);
      } catch (err) {
        toastError(new Error(connectorsError(err, `POST /connectors/${connector.id}/${on ? "connect" : "disconnect"}`)));
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(connector.id);
          return next;
        });
      }
    },
    [gateway, user.id],
  );

  const sweep = useCallback(async () => {
    setSweeping(true);
    setSweepError(null);
    setAnnounce("");
    try {
      const [found] = await Promise.all([gateway.sweep(user.id), wait(MIN_SWEEP_MS)]);
      setResult(found);
      const said = sweepSentence(found);
      setAnnounce(said);
      speak(said);
      // The sweep read the connectors just now: their "last read" moves on (the Gateway counts them).
      gateway
        .connectors(user.id)
        .then((list) => setConnectors(list.connectors))
        .catch(() => undefined);
      requestAnimationFrame(() => findingsRef.current?.focus());
    } catch (err) {
      setSweepError(connectorsError(err, "POST /connectors/sweep"));
    } finally {
      setSweeping(false);
    }
  }, [gateway, speak, user.id]);

  const on = connectors?.filter((c) => c.connected) ?? [];
  const nameOf = (id: string) => connectors?.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="min-w-0 space-y-8">
      <PageTitle lede={INTRO}>Connectors</PageTitle>

      <div className="-mt-3 space-y-3">
        <p className="flex max-w-2xl items-start gap-2.5 text-sm leading-relaxed text-slate-300">
          <span aria-hidden className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
            <LockKeyhole size={12} />
          </span>
          Tempo only uses read-only tools on an allowlist. What it reads is evidence, never instructions, and nothing starts without your yes.
        </p>
        {(showcase || simulated) && (
          <p className="flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-sm text-amber-50">
            <Badge tone="amber" dot>
              {showcase ? "recorded" : "demo data"}
            </Badge>
            {showcase
              ? "There's no Gateway in the showcase: these are Margaret's demo connectors, and the sweep is a recording."
              : "These connectors read Margaret's demo mailbox, calendar and bank statement, not real accounts."}
          </p>
        )}
      </div>

      {/* The sweep: the primary action, then what it found and what it read. */}
      <section aria-labelledby="sweep-heading" className="relative overflow-hidden rounded-3xl border border-violet-400/25 bg-gradient-to-b from-violet-500/[0.14] via-violet-500/[0.05] to-transparent p-5 text-slate-200 shadow-glass lg:p-7">
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-violet-500/25 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-gold-400/[0.07] blur-3xl" />
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/70 to-transparent" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 max-w-2xl">
            <h2 id="sweep-heading" className="flex items-center gap-3 font-display text-[2rem] leading-tight text-white sm:text-[2.4rem]">
              <Sparkles size={22} aria-hidden className="shrink-0 text-violet-300" /> <span>Find money you&apos;re <em className="text-gold pr-1">owed</em></span>
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-300">
              Tempo looks through what you&apos;ve connected for late trains, missed engineer visits, tricks and refunds. It starts nothing: each find has one button for you to press.
            </p>
          </div>
          {on.length > 0 && (
            <div aria-hidden className="flex items-center">
              {on.map((c, i) => (
                <span key={c.id} className={`rounded-[18px] ring-4 ring-ink-900 ${i ? "-ml-3" : ""}`}>
                  <ConnectorTile kind={c.kind} />
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-3">
          <Button size="lg" busy={sweeping} disabled={connectors !== null && on.length === 0} onClick={() => void sweep()} icon={result ? <RotateCcw size={18} aria-hidden /> : <Inbox size={18} aria-hidden />} className={`${TAP} shadow-glow`}>
            {sweeping ? "Sweeping…" : result ? "Sweep again" : "Sweep my inbox"}
          </Button>
          {connectors !== null && on.length === 0 && <p className="text-sm text-slate-300">Switch on a connector below first.</p>}
          {connectors !== null && on.length > 0 && !sweeping && (
            <p className="num text-sm text-slate-400">
              Reads {on.length} {on.length === 1 ? "connector" : "connectors"}, keeps nothing
            </p>
          )}
        </div>

        <div aria-live="polite" className="sr-only">
          {announce}
        </div>

        {sweeping && (
          <div className="relative mt-5 rounded-2xl border border-white/[0.08] bg-black/25 p-4">
            <Spinner label={`Reading ${on.length ? on.map((c) => c.name.toLowerCase()).join(", ") : "your connectors"}…`} />
            <ul aria-hidden className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {on.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5 text-sm text-slate-300">
                  <ConnectorTile kind={c.kind} size="sm" />
                  Reading {c.name.toLowerCase()}…
                  <span className="ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full w-full animate-shimmer rounded-full bg-[linear-gradient(90deg,transparent,rgb(167_139_250/0.9),transparent)] bg-[length:200%_100%] motion-reduce:animate-none" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sweepError && !sweeping && (
          <div className="relative mt-5">
            <EmptyState title="The sweep didn't finish" tone="error" action={<Button variant="quiet" onClick={() => void sweep()} className={TAP}>Try again</Button>}>
              {sweepError}
            </EmptyState>
          </div>
        )}

        {result && !sweeping && (
          <div className="relative mt-7 space-y-4 border-t border-white/[0.08] pt-6 motion-safe:animate-fade-up">
            <div className="flex flex-wrap items-center gap-2">
              <h3 ref={findingsRef} tabIndex={-1} className="text-lg font-semibold text-white focus:outline-none">
                {result.findings.length === 0 ? "Nothing needs you" : `What Tempo found (${result.findings.length})`}
              </h3>
              {showcase && (
                <Badge tone="amber" dot>
                  recorded
                </Badge>
              )}
            </div>
            <p className="text-[15px] leading-relaxed text-slate-200">{sweepSentence(result)}</p>
            {result.findings.length > 0 && (
              <ul aria-label="What Tempo found" className="stagger grid gap-3 lg:grid-cols-2">
                {result.findings.map((f) => (
                  <li key={f.id} className="min-w-0">
                    <FindingCard finding={f} headingLevel="h4" />
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(result.read).length > 0 && (
              <div className="rounded-2xl border border-white/[0.08] bg-black/25 p-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">What Tempo read (and didn&apos;t keep)</p>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(result.read).map(([id, count]) => {
                    const kind = connectors?.find((c) => c.id === id)?.kind ?? id;
                    return (
                      <li key={id} className="flex items-center gap-2.5 text-sm">
                        <ConnectorTile kind={kind} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-100">{nameOf(id)}</span>
                          <span className="num block text-xs text-slate-400">{itemsRead(kind, count)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {result.took_ms > 0 && <p className="num mt-3 text-xs text-slate-400">Took {(result.took_ms / 1000).toFixed(1)} seconds.</p>}
              </div>
            )}
          </div>
        )}
      </section>

      {/* The connectors themselves. */}
      <section aria-labelledby="connectors-heading">
        <h2 id="connectors-heading" className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          <Cable size={12} aria-hidden />
          Your connectors{connectors ? ` · ${on.length} of ${connectors.length} on` : ""}
        </h2>
        {loadError && (
          <EmptyState title="Couldn't load your connectors" tone="error" action={<Button variant="quiet" onClick={load} className={TAP}>Try again</Button>}>
            {loadError}
          </EmptyState>
        )}
        {!loadError && connectors === null && <SkeletonCards count={4} label="Loading your connectors" />}
        {connectors && connectors.length === 0 && <EmptyState title="No connectors yet">The Gateway lists them from connectors/connectors.yaml.</EmptyState>}
        {connectors && connectors.length > 0 && (
          <ul className="stagger grid gap-4 md:grid-cols-2">
            {connectors.map((c) => (
              <ConnectorCard key={c.id} connector={c} pending={pending.has(c.id)} onToggle={(conn, next) => void toggle(conn, next)} />
            ))}
          </ul>
        )}
      </section>

      <McpSection gateway={gateway} showcase={showcase} />
    </div>
  );
}
