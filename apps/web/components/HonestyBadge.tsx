import type { Health } from "@/lib/api";

/** Says out loud what is real and what is simulated in this run (spec §21). */
export function HonestyBadge({ health }: { health: Health | null }) {
  if (!health || (!health.demo && health.mode === "live" && health.simulated.length === 0)) return null;
  const real = health.mode === "live" ? "LIVE call" : "REPLAY data";
  const simulated = health.simulated.filter((s) => s !== "rail data").map((s) => s.toUpperCase());
  return (
    <p
      role="status"
      className="rounded-full border-2 border-amber-700 bg-amber-50 px-4 py-1 text-sm font-semibold tracking-wide text-amber-900"
    >
      {real} · SIMULATED {simulated.join(" · ") || "COMPANY"}
      {health.clock_offset_days ? ` · DEMO CLOCK +${health.clock_offset_days} DAYS` : ""}
    </p>
  );
}
