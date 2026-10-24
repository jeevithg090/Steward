import type { MissionState } from "@/lib/api";

export interface Agent {
  role: string;
  engine: string;
  spentGbp: number;
  budgetGbp: number;
  activeIn: MissionState[];
  doneAfter: MissionState[];
}

// The Clawback Rail team (spec §16.3). Budgets come from the skill manifest (§9.1).
export const RAIL_TEAM: Agent[] = [
  { role: "Intake", engine: "Rail data · Gemini vision", spentGbp: 0, budgetGbp: 0.05, activeIn: ["received"], doneAfter: ["understood"] },
  { role: "Rights Engine", engine: "Rules as code, no LLM", spentGbp: 0, budgetGbp: 0, activeIn: ["understood"], doneAfter: ["planned"] },
  { role: "Arbiter", engine: "Expected value of your time", spentGbp: 0, budgetGbp: 0, activeIn: ["planned"], doneAfter: ["appraised"] },
  { role: "Consent", engine: "You, by passkey, SMS or voice", spentGbp: 0, budgetGbp: 0, activeIn: ["awaiting_consent"], doneAfter: ["running"] },
  { role: "Claims", engine: "Files once, with an idempotency key", spentGbp: 0, budgetGbp: 0.1, activeIn: ["running"], doneAfter: ["waiting", "completed"] },
  { role: "Watchdog", engine: "Durable timer, survives restarts", spentGbp: 0, budgetGbp: 0, activeIn: ["waiting"], doneAfter: ["verified"] },
];

const ORDER: MissionState[] = [
  "received", "understood", "planned", "appraised", "awaiting_consent", "running", "waiting", "completed", "verified",
];

export function status(agent: Agent, reached: MissionState[], current: MissionState): "done" | "active" | "idle" {
  if (agent.activeIn.includes(current)) return "active";
  if (agent.doneAfter.some((s) => reached.includes(s))) return "done";
  return "idle";
}

export function budgetPercent(agent: Agent): number {
  return agent.budgetGbp === 0 ? 0 : Math.round((agent.spentGbp / agent.budgetGbp) * 100);
}

export function AgentCard({ agent, state }: { agent: Agent; state: "done" | "active" | "idle" }) {
  const percent = budgetPercent(agent);
  return (
    <li
      className={`rounded-xl border-2 p-3 ${state === "active" ? "border-teal-700 bg-teal-50" : "border-slate-200 bg-white"}`}
      aria-current={state === "active" ? "step" : undefined}
    >
      <p className="font-semibold">{agent.role}</p>
      <p className="text-sm text-slate-700">{agent.engine}</p>
      <p className="mt-1 text-sm">
        {state === "done" ? "✓ done" : state === "active" ? "● working" : "waiting"}
        {agent.budgetGbp > 0 && <span className="ml-2 text-slate-600">budget {percent}% of £{agent.budgetGbp.toFixed(2)}</span>}
      </p>
    </li>
  );
}

export function AgentCards({ state, reached }: { state: MissionState; reached: MissionState[] }) {
  const all = [...reached, state].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return (
    <section aria-labelledby="agents-heading">
      <h2 id="agents-heading" className="mb-2 text-lg font-semibold">Agents</h2>
      <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3">
        {RAIL_TEAM.map((agent) => (
          <AgentCard key={agent.role} agent={agent} state={status(agent, all, state)} />
        ))}
      </ul>
    </section>
  );
}
