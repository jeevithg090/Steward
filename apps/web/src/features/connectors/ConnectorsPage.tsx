// Connectors (plan.md §14): the places a person's life already is (her email, calendar and bank
// statement, plus the rail records), each a small read-only MCP server Tempo talks to. "Sweep my
// inbox" reads them, keeps nothing, and lists what is worth a look with one tap to act. Below, the
// other direction: how any MCP client can use Tempo, which never lets it approve anything.
import { useCallback, useEffect, useRef, useState } from "react";
import { Inbox, LockKeyhole, RotateCcw, Sparkles } from "lucide-react";
import { Badge, Button, EmptyState, PageTitle, SkeletonCards, Spinner, toast } from "@/components/ui";
import { plainError, toastError } from "@/components/mission";
import type { Connector, SweepResult } from "@/lib/api";
import { itemsRead, sweepSentence } from "@/lib/connectors";
import type { PageProps } from "@/types/page";
import { ConnectorCard, connectorIcon } from "./ConnectorCard";
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
    <div className="min-w-0 space-y-5">
      <PageTitle lede={INTRO}>Connectors</PageTitle>

      <p className="-mt-2 flex max-w-2xl items-start gap-2 text-sm text-slate-300">
        <LockKeyhole size={16} aria-hidden className="mt-0.5 shrink-0 text-emerald-300" />
        Tempo only uses read-only tools on an allowlist. What it reads is evidence, never instructions, and nothing starts without your yes.
      </p>
      {(showcase || simulated) && (
        <p className="flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          <Badge tone="amber">{showcase ? "recorded" : "demo data"}</Badge>
          {showcase
            ? "There's no Gateway in the showcase: these are Margaret's demo connectors, and the sweep is a recording."
            : "These connectors read Margaret's demo mailbox, calendar and bank statement, not real accounts."}
        </p>
      )}

      {/* The sweep: the primary action, then what it found and what it read. */}
      <section aria-labelledby="sweep-heading" className="rounded-2xl border border-indigo-500/30 bg-indigo-950/30 p-4 text-slate-200 lg:p-5">
        <h2 id="sweep-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-50">
          <Sparkles size={18} aria-hidden className="shrink-0 text-indigo-300" /> Find money you&apos;re owed
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-300">
          Tempo looks through what you&apos;ve connected for late trains, missed engineer visits, tricks and refunds. It starts nothing: each find has one button for you to press.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="lg" busy={sweeping} disabled={connectors !== null && on.length === 0} onClick={() => void sweep()} icon={result ? <RotateCcw size={18} aria-hidden /> : <Inbox size={18} aria-hidden />} className={TAP}>
            {sweeping ? "Sweeping…" : result ? "Sweep again" : "Sweep my inbox"}
          </Button>
          {connectors !== null && on.length === 0 && <p className="text-sm text-slate-300">Switch on a connector below first.</p>}
        </div>

        <div aria-live="polite" className="sr-only">
          {announce}
        </div>

        {sweeping && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <Spinner label={`Reading ${on.length ? on.map((c) => c.name.toLowerCase()).join(", ") : "your connectors"}…`} />
            <ul aria-hidden className="mt-3 grid gap-2 sm:grid-cols-2">
              {on.map((c) => {
                const { icon: Icon, ring } = connectorIcon(c.kind);
                return (
                  <li key={c.id} className="flex items-center gap-2 text-sm text-slate-300">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ring}`}>
                      <Icon size={14} aria-hidden />
                    </span>
                    Reading {c.name.toLowerCase()}…
                    <span className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full w-1/2 animate-pulse rounded-full bg-indigo-400 motion-reduce:animate-none" />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {sweepError && !sweeping && (
          <div className="mt-4">
            <EmptyState title="The sweep didn't finish" tone="error" action={<Button variant="quiet" onClick={() => void sweep()} className={TAP}>Try again</Button>}>
              {sweepError}
            </EmptyState>
          </div>
        )}

        {result && !sweeping && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 ref={findingsRef} tabIndex={-1} className="text-base font-semibold text-slate-50 focus:outline-none">
                {result.findings.length === 0 ? "Nothing needs you" : `What Tempo found (${result.findings.length})`}
              </h3>
              {showcase && <Badge tone="amber">recorded</Badge>}
            </div>
            <p className="text-sm text-slate-300">{sweepSentence(result)}</p>
            {result.findings.length > 0 && (
              <ul aria-label="What Tempo found" className="grid gap-3 lg:grid-cols-2">
                {result.findings.map((f) => (
                  <li key={f.id} className="min-w-0">
                    <FindingCard finding={f} headingLevel="h4" />
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(result.read).length > 0 && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">What Tempo read (and didn&apos;t keep)</p>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(result.read).map(([id, count]) => {
                    const kind = connectors?.find((c) => c.id === id)?.kind ?? id;
                    const { icon: Icon, ring } = connectorIcon(kind);
                    return (
                      <li key={id} className="flex items-center gap-2 text-sm">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ring}`}>
                          <Icon size={14} aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-slate-100">{nameOf(id)}</span>
                          <span className="block text-xs text-slate-400">{itemsRead(kind, count)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {result.took_ms > 0 && <p className="mt-2 text-xs text-slate-400">Took {(result.took_ms / 1000).toFixed(1)} seconds.</p>}
              </div>
            )}
          </div>
        )}
      </section>

      {/* The connectors themselves. */}
      <section aria-labelledby="connectors-heading">
        <h2 id="connectors-heading" className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
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
          <ul className="grid gap-4 md:grid-cols-2">
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
