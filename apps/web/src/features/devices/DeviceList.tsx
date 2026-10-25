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
      <SectionTitle id="device-list-heading" right={<Badge tone="slate">{devices.length}</Badge>}>
        Your devices
      </SectionTitle>
      <ul aria-label="Your devices" className="divide-y divide-white/5">
        {ordered.map((d) => {
          const mine = d.id === thisId;
          const Icon = looksHandheld(d.name) ? Smartphone : Laptop;
          return (
            <li key={d.id} className="py-3 first:pt-1 last:pb-0">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-xl bg-white/5 p-2 text-indigo-200">
                  <Icon size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-100">
                    <span className="break-words">{d.name}</span>
                    {mine && <Badge tone="indigo">this one</Badge>}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5">
                    {d.passkey ? <Badge tone="emerald">Face ID or fingerprint</Badge> : <Badge tone="slate">no Face ID yet</Badge>}
                    {!d.active && <Badge tone="amber">waiting for the code</Badge>}
                    {d.push && <Badge tone="slate">notifications on</Badge>}
                  </p>
                  {d.last_active && <p className="mt-1 text-xs text-slate-400">Last seen {shortDateTime(d.last_active)}</p>}
                </div>
                {!mine && asking !== d.id && (
                  <Button variant="quiet" size="sm" aria-label={`Remove ${d.name}`} onClick={() => setAsking(d.id)}>
                    Remove
                  </Button>
                )}
              </div>
              {asking === d.id && (
                <div role="group" aria-label={`Remove ${d.name}?`} className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3">
                  <p className="text-sm text-rose-100">Remove {d.name}? It won&apos;t be able to answer Tempo any more. You can pair it again later.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
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
