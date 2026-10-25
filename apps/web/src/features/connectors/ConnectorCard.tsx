// One connector (plan.md §14.2): its icon, name and a Connected/Off switch, what Tempo may read,
// the read-only tools it may call, and when it last read it.
import { useId, type ComponentType } from "react";
import { CalendarDays, Cable, Landmark, Mail, TrainFront } from "lucide-react";
import { FOCUS } from "@/components/ui";
import type { Connector } from "@/lib/api";

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

/** A lucide icon and a colour for each kind of connector. */
export const CONNECTOR_ICON: Record<string, { icon: Icon; ring: string }> = {
  mail: { icon: Mail, ring: "bg-indigo-500/15 text-indigo-300" },
  calendar: { icon: CalendarDays, ring: "bg-amber-500/15 text-amber-300" },
  bank: { icon: Landmark, ring: "bg-emerald-500/15 text-emerald-300" },
  rail: { icon: TrainFront, ring: "bg-purple-500/15 text-purple-300" },
};

const FALLBACK = { icon: Cable, ring: "bg-white/10 text-slate-200" };

export function connectorIcon(kind: string): { icon: Icon; ring: string } {
  return CONNECTOR_ICON[kind] ?? FALLBACK;
}

function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

interface ConnectorCardProps {
  connector: Connector;
  /** A switch is on its way to the Gateway. */
  pending: boolean;
  onToggle: (connector: Connector, on: boolean) => void;
}

export function ConnectorCard({ connector: c, pending, onToggle }: ConnectorCardProps) {
  const nameId = useId();
  const { icon: KindIcon, ring } = connectorIcon(c.kind);
  const lastRead = when(c.last_read_at);
  return (
    <li
      className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-4 text-slate-200 lg:p-5 ${c.connected ? "border-white/10 bg-nexus-card" : "border-dashed border-white/20 bg-transparent"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ring}`}>
            <KindIcon size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 id={nameId} className="break-words text-base font-semibold text-slate-50">
              {c.name}
            </h3>
            <p className="text-xs text-slate-400">{c.connected ? "Read only when you sweep." : "Off: Tempo won't read it."}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={c.connected}
          aria-labelledby={nameId}
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={() => onToggle(c, !c.connected)}
          className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${c.connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" : "border-white/15 bg-white/5 text-slate-300"} ${FOCUS}`}
        >
          <span aria-hidden className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${c.connected ? "bg-emerald-500" : "bg-slate-600"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${c.connected ? "translate-x-[18px]" : "translate-x-0.5"}`} />
          </span>
          <span aria-hidden>{c.connected ? "Connected" : "Off"}</span>
        </button>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">What Tempo may read</p>
        <ul className="space-y-1 text-sm text-slate-200">
          {c.scopes.map((scope) => (
            <li key={scope} className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              <span className="min-w-0 break-words">{scope}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tools (read-only)</p>
        <ul aria-label={`Tools Tempo may use on ${c.name}`} className="flex flex-wrap gap-1.5">
          {c.tools.map((tool) => (
            <li key={tool} className="max-w-full">
              <code className="inline-block max-w-full break-all rounded-full border border-white/10 bg-black/30 px-2.5 py-0.5 font-mono text-[11px] text-slate-200">{tool}</code>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-auto border-t border-white/10 pt-3 text-xs text-slate-400">
        {lastRead ? (
          <>
            Last read {lastRead} · {c.items_read} {c.items_read === 1 ? "item" : "items"} read so far, none kept
          </>
        ) : (
          "Not read yet."
        )}
      </p>
    </li>
  );
}
