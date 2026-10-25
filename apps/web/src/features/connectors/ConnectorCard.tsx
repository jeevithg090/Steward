// One connector (plan.md §14.2): its icon, name and a Connected/Off switch, what Tempo may read,
// the read-only tools it may call, and when it last read it.
import { useId, type ComponentType } from "react";
import { CalendarDays, Cable, History, Landmark, Lock, Mail, TrainFront } from "lucide-react";
import { FOCUS } from "@/components/ui";
import type { Connector } from "@/lib/api";

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

/** A lucide icon and a colour for each kind of connector: `ring` for small circles, `tile` for the logo tile. */
export const CONNECTOR_ICON: Record<string, { icon: Icon; ring: string; tile: string }> = {
  mail: { icon: Mail, ring: "bg-violet-500/15 text-violet-200", tile: "from-violet-400 to-indigo-600" },
  calendar: { icon: CalendarDays, ring: "bg-amber-500/15 text-amber-200", tile: "from-amber-300 to-orange-500" },
  bank: { icon: Landmark, ring: "bg-emerald-500/15 text-emerald-200", tile: "from-emerald-300 to-teal-600" },
  rail: { icon: TrainFront, ring: "bg-sky-500/15 text-sky-200", tile: "from-sky-300 to-blue-600" },
};

const FALLBACK = { icon: Cable, ring: "bg-white/10 text-slate-200", tile: "from-slate-400 to-slate-600" };

export function connectorIcon(kind: string): { icon: Icon; ring: string; tile: string } {
  return CONNECTOR_ICON[kind] ?? FALLBACK;
}

/** A logo-like tile: the kind's icon in white on its own gradient, dimmed when the connector is off. */
export function ConnectorTile({ kind, on = true, size = "md" }: { kind: string; on?: boolean; size?: "sm" | "md" }) {
  const { icon: KindIcon, tile } = connectorIcon(kind);
  const box = size === "sm" ? "h-8 w-8 rounded-[10px]" : "h-12 w-12 rounded-2xl";
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center bg-gradient-to-br text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_10px_24px_-12px_rgb(0_0_0/0.9)] ${tile} ${box} ${on ? "" : "opacity-40 grayscale"}`}
    >
      <span className="absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/20 to-transparent" />
      <KindIcon size={size === "sm" ? 15 : 22} className="relative drop-shadow-[0_1px_1px_rgb(0_0_0/0.35)]" aria-hidden />
    </span>
  );
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
  const lastRead = when(c.last_read_at);
  return (
    <li
      className={`group relative flex min-w-0 flex-col gap-4 rounded-3xl p-5 text-slate-200 transition-[border-color,box-shadow,opacity] duration-200 motion-reduce:transition-none lg:p-6 ${
        c.connected ? "surface hover:border-white/[0.14] hover:shadow-lift" : "border border-dashed border-white/[0.16] bg-white/[0.01]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <ConnectorTile kind={c.kind} on={c.connected} />
          <div className="min-w-0">
            <h3 id={nameId} className="break-words text-[15px] font-semibold text-white">
              {c.name}
            </h3>
            <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${c.connected ? "text-slate-400" : "text-slate-400"}`}>
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.connected ? "bg-emerald-400 shadow-[0_0_0_3px_rgb(16_185_129/0.18)]" : "bg-slate-500"}`} />
              {c.connected ? "Read only when you sweep." : "Off: Tempo won't read it."}
            </p>
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
          className={`inline-flex min-h-[44px] shrink-0 items-center gap-2.5 rounded-full py-1.5 pl-2 pr-3.5 text-sm font-medium ring-1 ring-inset transition-colors disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${
            c.connected ? "bg-violet-500/[0.12] text-violet-50 ring-violet-400/30 hover:bg-violet-500/20" : "bg-white/[0.04] text-slate-300 ring-white/15 hover:bg-white/[0.08]"
          } ${FOCUS}`}
        >
          <span
            aria-hidden
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 ring-1 ring-inset transition-colors duration-200 motion-reduce:transition-none ${
              c.connected ? "bg-gradient-to-b from-violet-500 to-violet-700 ring-violet-300/30 shadow-[0_6px_18px_-8px_rgb(124_58_237/0.9)]" : "bg-white/[0.08] ring-white/15"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.4)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${c.connected ? "translate-x-5" : "translate-x-0"}`}
            />
          </span>
          <span aria-hidden>{c.connected ? "Connected" : "Off"}</span>
        </button>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">What Tempo may read</p>
        <ul className="space-y-1.5 text-sm leading-snug text-slate-200">
          {c.scopes.map((scope) => (
            <li key={scope} className="flex items-start gap-2.5">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400 shadow-[0_0_0_3px_rgb(139_92_246/0.18)]" />
              <span className="min-w-0 break-words">{scope}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Tools (read-only)</p>
        <ul aria-label={`Tools Tempo may use on ${c.name}`} className="flex flex-wrap gap-1.5">
          {c.tools.map((tool) => (
            <li key={tool} className="inline-flex max-w-full items-center gap-1.5 break-all rounded-lg border border-white/[0.08] bg-ink-900/70 px-2 py-1 font-mono text-[11.5px] text-slate-200">
              <Lock size={10} aria-hidden className="shrink-0 text-emerald-300" />
              {tool}
            </li>
          ))}
        </ul>
      </div>

      <p className="num mt-auto flex items-center gap-1.5 border-t border-white/[0.06] pt-3.5 text-xs text-slate-400">
        <History size={12} aria-hidden className="shrink-0" />
        <span>
          {lastRead ? (
            <>
              Last read {lastRead} · {c.items_read} {c.items_read === 1 ? "item" : "items"} read so far, none kept
            </>
          ) : (
            "Not read yet."
          )}
        </span>
      </p>
    </li>
  );
}
