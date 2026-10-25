import { ShieldCheck } from "lucide-react";
import type { Health } from "@/lib/api";
import { SHOWCASE_LABEL } from "@/lib/showcase";
import { Badge } from "./Badge";

/** What is real in this run (plan.md §1.10): the Gateway's /health, or the showcase label.
 * Phones get a short label; the full sentence is in the title and for screen readers. */
export function HonestyBadge({ health, showcase, connected }: { health: Health | null; showcase: boolean; connected: boolean }) {
  if (showcase) {
    return (
      <Badge tone="amber" dot title="No Gateway: recorded replies from a real replay-mode run">
        <span className="hidden sm:inline">{SHOWCASE_LABEL}</span>
        <span className="sm:hidden" aria-label={SHOWCASE_LABEL}>SHOWCASE · recorded</span>
      </Badge>
    );
  }
  if (!connected || !health) {
    return <Badge tone="rose" dot title="The web app cannot reach the Gateway">NO GATEWAY</Badge>;
  }
  const simulated = health.simulated.length ? `SIMULATED ${health.simulated.join(", ")}` : "nothing simulated";
  const clock = health.clock_offset_days ? ` · DEMO CLOCK +${health.clock_offset_days} DAYS` : "";
  const waiting = health.model?.answering === false ? " (not answering yet)" : "";
  const ai = health.model?.kind === "runpod-vllm" ? "our own model on a RunPod GPU" : (health.model?.processor ?? "");
  const gpu = health.model ? ` · AI: ${ai}${waiting}` : "";
  const full = `${health.mode.toUpperCase()} data · ${simulated}${clock}${gpu}`;
  return (
    <Badge tone={health.mode === "replay" ? "amber" : "emerald"} title={`The honesty badge: ${full}`}>
      <ShieldCheck size={12} aria-hidden />
      <span className="hidden sm:inline">{full}</span>
      <span className="sm:hidden" aria-label={full}>
        {health.mode.toUpperCase()}
        {health.simulated.length ? " · simulated" : ""}
        {health.clock_offset_days ? ` · +${health.clock_offset_days}d` : ""}
        {health.model ? (health.model.answering === false ? " · AI waking" : " · real AI") : ""}
      </span>
    </Badge>
  );
}
