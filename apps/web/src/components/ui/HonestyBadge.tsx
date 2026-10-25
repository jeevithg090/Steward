import { ShieldCheck } from "lucide-react";
import type { Health } from "@/lib/api";
import { SHOWCASE_LABEL } from "@/lib/showcase";
import { Badge } from "./Badge";

/** What is real in this run (plan.md §1.10): the Gateway's /health, or the showcase label. */
export function HonestyBadge({ health, showcase, connected }: { health: Health | null; showcase: boolean; connected: boolean }) {
  if (showcase) {
    return <Badge tone="amber" title="No Gateway: recorded replies from a real replay-mode run">{SHOWCASE_LABEL}</Badge>;
  }
  if (!connected || !health) {
    return <Badge tone="rose" title="The web app cannot reach the Gateway">NO GATEWAY · check Settings</Badge>;
  }
  const simulated = health.simulated.length ? `SIMULATED ${health.simulated.join(", ")}` : "nothing simulated";
  const clock = health.clock_offset_days ? ` · DEMO CLOCK +${health.clock_offset_days} DAYS` : "";
  return (
    <Badge tone={health.mode === "replay" ? "amber" : "emerald"} title="The honesty badge: what is live and what is recorded in this run">
      <ShieldCheck size={12} aria-hidden /> {health.mode.toUpperCase()} data · {simulated}{clock}
    </Badge>
  );
}
