import { type AgentsResponse, type AppInfo, type ModelConfig, ROUTES, SettingsBody } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { readBody } from "../http/errors.ts";

export function appInfo(s: StewardServices): AppInfo {
  const mail = s.mail();
  const model = s.models.info;
  return {
    brand: s.tenant.brand,
    // The tenant's agents, then one per installed bot, each saying where it came from.
    agents: s.models.profiles,
    starters: s.tenant.starters,
    model: { provider: model.provider, model: model.model, scripted: model.scripted },
    mail: {
      connected: mail !== undefined,
      label: mail?.label ?? "Not connected",
      isDemo: mail?.isDemo ?? false,
    },
    version: s.version,
    singleUser: true,
  };
}

/**
 * A model choice as the record keeps it: the provider, the model and only the host of an address,
 * which can carry a key in its user part or query.
 */
function modelFacts(m: Pick<ModelConfig, "provider" | "model" | "baseUrl">): Record<string, string> {
  let host: string | undefined;
  try {
    host = m.baseUrl ? new URL(m.baseUrl).host : undefined;
  } catch {
    host = undefined;
  }
  return { provider: m.provider, model: m.model, ...(host ? { host } : {}) };
}

/** `/api/health`, `/api/info`, `/api/agents`, `/api/settings`, `/api/setup`. */
export function registerAppRoutes(app: Hono, s: StewardServices): void {
  app.get(ROUTES.health, (c) => c.json({ ok: true }));

  app.get(ROUTES.info, (c) => c.json(appInfo(s)));

  // Every agent with the model it runs on and whether it can answer now; the picker reads this.
  // A coding agent installed (or removed) since the last look is picked up here, with no restart.
  app.get(ROUTES.agents, async (c) => {
    await s.models.refreshHarnesses();
    return c.json({ agents: s.models.agentInfos() } satisfies AgentsResponse);
  });

  // The external coding agents the tenant offers, and whether each one's program is installed.
  app.get(ROUTES.harnesses, (c) => c.json(s.models.harnessInfos()));

  // Settings show the model the person chose; /api/info and the checklist show the one running
  // (they differ when the chosen provider has no key and Steward fell back to the scripted model).
  // Either carries an address only when someone gave one for a provider that takes one, never a
  // provider's own endpoint: the page sends it back with the next choice, whatever the provider.
  const shown = () => s.settings.modelChoice() ?? s.models.info;

  app.get(ROUTES.settings, (c) => c.json(s.settings.read(shown())));

  app.put(ROUTES.settings, async (c) => {
    const body = await readBody(c, SettingsBody);
    const before = s.settings.modelChoice();
    s.settings.update(body);
    const after = s.settings.modelChoice();
    const changed =
      after !== undefined &&
      (after.provider !== before?.provider ||
        after.model !== before?.model ||
        after.baseUrl !== before?.baseUrl);
    if (changed) {
      // Where every conversation goes from now on: on the record before the model is switched.
      s.gateway.audit.append({
        type: "settings.model_changed",
        actorId: s.actorId,
        detail: { ...(before ? { from: modelFacts(before) } : {}), to: modelFacts(after) },
      });
      await s.models.configure(after);
    }
    return c.json(s.settings.read(shown()));
  });

  app.get(ROUTES.setup, async (c) => c.json(await s.setup.list()));

  app.post(`${ROUTES.setup}/check`, async (c) => c.json(await s.setup.recheck()));
}
