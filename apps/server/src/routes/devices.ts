import { DEVICE_PRESETS } from "@steward/gateway";
import {
  DEFAULT_DEVICE_PORT,
  DEVICE_ROUTES,
  DevicePatchBody,
  PairingBody,
  type PairingOffer,
  type PhoneInfo,
  PhoneSettingsBody,
  pairRunUrl,
  ROUTES,
} from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { detectTransports, machineName } from "../device/phone.ts";
import { HttpError, notFound, readBody } from "../http/errors.ts";

/**
 * `/api/devices` and `/api/phone`: Settings → Phone. These live on the main port, so only this
 * machine's own page can pair, list, change or revoke a phone. A phone never reaches them.
 */
export function registerDeviceRoutes(app: Hono, s: StewardServices): void {
  const { devices, phone } = s;

  const info = (): PhoneInfo => {
    const url = phone.url();
    const warning = phone.warning();
    return {
      listener: { port: s.phoneListener.port, running: s.phoneListener.running },
      url,
      ...(warning ? { urlWarning: warning } : {}),
      hosts: phone.hosts(),
      transports: detectTransports(
        s.phoneListener.port ?? s.config.devicePort ?? DEFAULT_DEVICE_PORT,
        s.config.env,
      ),
      presets: [...DEVICE_PRESETS],
      shortcut: s.deviceApi.manifest(),
    };
  };

  app.get(ROUTES.phone, (c) => c.json(info()));

  app.put(ROUTES.phone, async (c) => {
    const body = await readBody(c, PhoneSettingsBody);
    phone.setUrl(body.url);
    return c.json(info());
  });

  app.get(ROUTES.devices, (c) => c.json(devices.list()));

  app.post(ROUTES.devicesPairing, async (c) => {
    const body = await readBody(c, PairingBody);
    if (!s.phoneListener.running) {
      throw new HttpError(
        409,
        "The phone port is switched off. Remove STEWARD_DEVICE_PORT=off from .env and restart Steward.",
      );
    }
    const url = phone.url();
    if (!url) {
      throw new HttpError(409, "First set the address your phone uses to reach Steward, under Connection.");
    }
    const { code, expiresAt } = devices.createPairing(body.kind);
    const offer: PairingOffer = {
      kind: body.kind,
      code,
      expiresAt,
      qrText: pairRunUrl({ u: url, c: code, n: machineName() }),
      shortcutUrl: `${url}${DEVICE_ROUTES.shortcut}`,
      deviceUrl: url,
    };
    c.header("Cache-Control", "no-store");
    return c.json(offer, 201);
  });

  app.patch(ROUTES.device, async (c) => {
    const body = await readBody(c, DevicePatchBody);
    const updated = devices.update(c.req.param("id"), {
      ...(body.scopes ? { scopes: body.scopes } : {}),
      ...(body.name ? { name: body.name } : {}),
    });
    if (!updated) throw notFound("that phone");
    return c.json(updated);
  });

  app.delete(ROUTES.device, (c) => {
    const revoked = devices.revoke(c.req.param("id"));
    if (!revoked) throw notFound("that phone");
    return c.json({ ok: true });
  });
}
