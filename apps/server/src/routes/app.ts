import { type AppInfo, ROUTES, SettingsBody } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { readBody } from "../http/errors.ts";

export function appInfo(s: StewardServices): AppInfo {
  const mail = s.mail();
  const model = s.models.info;
  return {
    brand: s.tenant.brand,
    agents: s.tenant.agents,
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

/** `/api/health`, `/api/info`, `/api/settings`, `/api/setup`. */
export function registerAppRoutes(app: Hono, s: StewardServices): void {
  app.get(ROUTES.health, (c) => c.json({ ok: true }));

  app.get(ROUTES.info, (c) => c.json(appInfo(s)));

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
    if (changed) await s.models.configure(after);
    return c.json(s.settings.read(shown()));
  });

  app.get(ROUTES.setup, async (c) => c.json(await s.setup.list()));

  app.post(`${ROUTES.setup}/check`, async (c) => c.json(await s.setup.recheck()));
}
