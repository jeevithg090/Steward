/**
 * Checks, before any spec runs, that the server Playwright started is the one the specs expect: the
 * scripted demo model, no model key and no relay. The server reads `<repo>/.env` whatever the run
 * asks, so a contributor's own key would otherwise reach the agents pinned to real providers, and a
 * spec that picked one would spend real credit; their STEWARD_RELAY_URL would carry the run's phone
 * traffic to their relay. Stopping here says why, instead of a spec failing later.
 */
import { SERVER_URL } from "./env.ts";

interface AgentRow {
  id: string;
  available: boolean;
  signIn: string;
}

const MOVE_ENV = "Move .env aside, or unset it, while pnpm e2e runs.";

export default async function globalSetup(): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/agents`);
  if (!res.ok) throw new Error(`The e2e server did not list its agents (${res.status}).`);
  const { agents } = (await res.json()) as { agents: AgentRow[] };
  const keyed = agents.filter((agent) => agent.available && agent.signIn === "api-key").map((a) => a.id);
  if (keyed.length > 0) {
    throw new Error(
      `The e2e server found a model key, in the repository's .env or in the shell, so ${keyed.join(", ")} ` +
        `would run on a real model and spend real credit. ${MOVE_ENV}`,
    );
  }
  const steward = agents.find((agent) => agent.id === "steward");
  if (steward?.signIn !== "scripted") {
    throw new Error("The e2e server's Steward is not on the scripted demo model, so the specs cannot pass.");
  }

  const phone = await fetch(`${SERVER_URL}/api/phone`);
  if (!phone.ok) throw new Error(`The e2e server did not say how phones reach it (${phone.status}).`);
  const { relay } = (await phone.json()) as { relay: { configured: boolean; url?: string } };
  if (relay.configured) {
    throw new Error(
      `The e2e server found STEWARD_RELAY_URL${relay.url ? ` (${relay.url})` : ""}, in the repository's .env ` +
        `or in the shell, so the run's phone traffic would go to that relay. ${MOVE_ENV}`,
    );
  }
}
