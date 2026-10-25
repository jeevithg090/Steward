// The person's devices: which one this is, which hold Face ID, which are still waiting for the
// code, and Remove for a lost one (asked once more before it goes).
import { useState } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import { shortDateTime } from "@/components/mission";
import type { DeviceInfo } from "@/lib/mesh";
import { looksHandheld } from "./deviceName";

export function DeviceList({ devices, thisId, onRemove }: { devices: DeviceInfo[]; thisId: string | null; onRemove: (device: DeviceInfo) => Promise<boolean> }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ordered = [...devices].sort((a, b) => Number(b.id === thisId) - Number(a.id === thisId));

  const remove = async (device: DeviceInfo) => {
    setBusy(device.id);
    const ok = await onRemove(device);
    setBusy(null);
    if (ok) setAsking(null);
  };

  return (
    <Card as="section" aria-labelledby="device-list-heading">
      <SectionTitle id="device-list-heading" right={<span className="num grid h-6 min-w-6 place-items-center rounded-full bg-white/[0.07] px-2 text-[11px] font-semibold text-slate-300 ring-1 ring-inset ring-white/10">{devices.length}</span>}>
        Your devices
      </SectionTitle>
      <ul aria-label="Your devices" className="space-y-2">
        {ordered.map((d) => {
          const mine = d.id === thisId;
          const Icon = looksHandheld(d.name) ? Smartphone : Laptop;
          const light = !d.active ? "bg-amber-300" : d.passkey ? "bg-emerald-400" : "bg-slate-400";
          return (
            <li
              key={d.id}
              className={`rounded-2xl border px-3.5 py-3 transition-colors motion-reduce:transition-none ${mine ? "border-accent-400/25 bg-accent-500/[0.06]" : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"}`}
            >
              <div className="flex items-start gap-3">
                <span aria-hidden className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-accent-200 ring-1 ring-inset ring-white/10">
                  <Icon size={18} />
                  <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-ink-900 ${light}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                    <span className="break-words">{d.name}</span>
                    {mine && <Badge tone="indigo">this one</Badge>}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {d.passkey ? (
                      <Badge tone="emerald" dot>
                        Face ID or fingerprint
                      </Badge>
                    ) : (
                      <Badge tone="slate" dot>
                        no Face ID yet
                      </Badge>
                    )}
                    {!d.active && (
                      <Badge tone="amber" dot>
                        waiting for the code
                      </Badge>
                    )}
                    {d.push && (
                      <Badge tone="slate" dot>
                        notifications on
                      </Badge>
                    )}
                  </p>
                  {d.last_active && <p className="num mt-1.5 text-xs text-slate-400">Last seen {shortDateTime(d.last_active)}</p>}
                </div>
                {!mine && asking !== d.id && (
                  <Button variant="ghost" size="sm" aria-label={`Remove ${d.name}`} onClick={() => setAsking(d.id)} className="shrink-0 !text-rose-200 hover:!bg-rose-500/10 hover:!text-rose-100">
                    Remove
                  </Button>
                )}
              </div>
              {asking === d.id && (
                <div role="group" aria-label={`Remove ${d.name}?`} className="mt-3 rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] p-3.5 motion-safe:animate-scale-in">
                  <p className="text-sm leading-relaxed text-rose-50">Remove {d.name}? It won&apos;t be able to answer Tempo any more. You can pair it again later.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="danger" size="sm" busy={busy === d.id} onClick={() => void remove(d)}>
                      Yes, remove it
                    </Button>
                    <Button variant="quiet" size="sm" disabled={busy === d.id} onClick={() => setAsking(null)}>
                      Keep it
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
