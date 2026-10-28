import {
  DEVICE_ROUTES,
  type Device,
  DeviceDecisionBody,
  DevicePairBody,
  type DevicePairReply,
  DeviceRunBody,
  DeviceSayBody,
  SHORTCUT_HEADER,
  STEWARD_SHORTCUT,
} from "@steward/shared";
import { shortcutHeaders } from "@steward/shortcuts";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { isLoopbackHost } from "../config.ts";
import { HttpError, onError, readBody } from "../http/errors.ts";
import { limitBody, requestHost, securityHeaders } from "../http/security.ts";
import type { DeviceApi } from "./api.ts";
import type { InstallStore } from "./installs.ts";
import type { PhoneSettings } from "./phone.ts";
import { RateLimiter } from "./rate-limit.ts";
import { type DeviceStore, PairingError } from "./store.ts";

/**
 * The device listener (docs/plans/phone-and-shortcuts.md §3.2): a second Hono app, on its own port
 * (127.0.0.1:8788 by default), that mounts only `/device/*`. This is the only part of Steward a
 * tunnel may point at.
 *
 * - Every route needs `Authorization: Bearer <device token>`, except pairing (the code is the
 *   credential) and the shortcut downloads.
 * - Its own Host allow-list: loopback, the phone address set in Settings → Phone, and
 *   `STEWARD_DEVICE_HOSTS`.
 * - No page may call it: a request with an `Origin` is refused (a shortcut sends none).
 * - Rate limits on pairing, on failed tokens, and per device.
 * - Below the shortcut's minimum version every route answers 426 with the update.
 */

export interface DeviceListenerDeps {
  api: DeviceApi;
  devices: DeviceStore;
  phone: PhoneSettings;
  /** A Cloudflare Access service token, handed to a phone in its pairing reply. */
  access?: { clientId: string; clientSecret: string };
  /** The generic signed Steward shortcut, when one ships with this build (no token needed). */
  genericShortcut?: () => Uint8Array | undefined;
  /** One-time downloads made on the Mac: personal files and launchers (no token needed). */
  installs?: InstallStore;
  now?: () => number;
}

export interface DeviceEnv {
  Variables: { device: Device };
}

const BODY_LIMIT = 64 * 1024;

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  const colon = h.lastIndexOf(":");
  return colon > -1 && h.indexOf(":") === colon ? h.slice(0, colon) : h;
}

/** Every error a phone sees carries the same words as something to say, so a shortcut can show it. */
function deviceError(c: Context, status: ContentfulStatusCode, message: string, extra: object = {}) {
  return c.json({ error: message, ui: [{ say: message }], ...extra }, status);
}

/**
 * Reads a device request's fields from the JSON body and the query together. A shortcut posts
 * `{ "text": … }` and carries everything else in the address (`?answer=once`), because building
 * JSON with other keys on a phone is fragile. Body values win, except empty ones.
 */
async function readDeviceBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  const query = c.req.query();
  if (Object.keys(query).length === 0) return readBody(c, schema);
  const body = (await readBody(c, z.record(z.unknown()))) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...query };
  for (const [key, value] of Object.entries(body))
    if (value !== "" && value !== undefined) merged[key] = value;
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(
      400,
      `${issue?.path.join(".") ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "That request is not valid."}`,
    );
  }
  return parsed.data;
}

/** `steward@3` → 3 for the generic shortcut; undefined for anything else. */
export function shortcutVersion(header: string | undefined): { id: string; version: number } | undefined {
  const m = /^([a-z0-9][a-z0-9-]{0,40})@(\d{1,6})$/.exec(header?.trim() ?? "");
  return m ? { id: m[1]!, version: Number(m[2]) } : undefined;
}

export function createDeviceApp(deps: DeviceListenerDeps): Hono<DeviceEnv> {
  const { api, devices, phone } = deps;
  const now = deps.now ?? (() => Date.now());
  // Wrong codes only: a person pairing several phones is never slowed, a guesser is.
  const pairFailures = new RateLimiter(10, 60_000, now);
  const failedTokens = new RateLimiter(30, 60_000, now);
  const perDevice = new RateLimiter(120, 60_000, now);
  const runs = new RateLimiter(20, 60_000, now);

  const app = new Hono<DeviceEnv>();
  app.onError((err, c) => {
    if (err instanceof HttpError) return deviceError(c, err.status, err.message);
    if (err instanceof PairingError) return deviceError(c, 400, err.message);
    const res = onError(err, c);
    return res;
  });
  app.use("*", securityHeaders());

  // Loopback (a tunnel on this machine may present it), the phone address, STEWARD_DEVICE_HOSTS.
  app.use("*", async (c, next) => {
    const host = hostnameOf(requestHost(c));
    if (!isLoopbackHost(host) && !phone.hosts().includes(host)) {
      return deviceError(
        c,
        403,
        "This address isn't set up for Steward's phone access. Check the phone address in Settings → Phone.",
      );
    }
    await next();
  });

  // Shortcuts send no Origin. A web page's fetch does, and has no business here.
  app.use("*", async (c, next) => {
    if (c.req.header("origin") !== undefined)
      return deviceError(c, 403, "Web pages can't call Steward's phone port.");
    await next();
  });

  app.use("/device/*", limitBody(BODY_LIMIT));
  app.use("/device/*", async (c, next) => {
    if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
      const length = c.req.header("content-length");
      const hasBody =
        length !== undefined ? Number(length) > 0 : c.req.header("transfer-encoding") !== undefined;
      const type = (c.req.header("content-type") ?? "").toLowerCase();
      if (hasBody && !type.includes("application/json"))
        return deviceError(c, 415, "Send the request body as JSON.");
    }
    await next();
  });

  // The update check comes before anything else a shortcut asks, pairing included.
  app.use("/device/*", async (c, next) => {
    const named = shortcutVersion(c.req.header(SHORTCUT_HEADER));
    if (named && named.id === STEWARD_SHORTCUT.id && named.version < STEWARD_SHORTCUT.minVersion) {
      const update = api.manifest();
      return c.json(
        {
          error: "This Steward shortcut is out of date.",
          update,
          ui: [{ show: { title: "Update the Steward shortcut", body: update.notes } }, { open: update.url }],
        },
        426,
      );
    }
    await next();
  });

  // The two downloads a phone makes before it has a key. The generic file holds no secret; a
  // personal file is behind a 128-bit, ten-minute, one-time id.
  const installMisses = new RateLimiter(30, 60_000, now);
  app.get(DEVICE_ROUTES.shortcut, (c) => {
    const bytes = deps.genericShortcut?.();
    if (!bytes) {
      return deviceError(
        c,
        404,
        "This copy of Steward has no signed Steward shortcut yet. A maintainer signs it at release (docs/phone.md).",
      );
    }
    return c.body(bytes as unknown as ArrayBuffer, 200, shortcutHeaders("Steward", false));
  });
  app.get(DEVICE_ROUTES.install, (c) => {
    if (installMisses.blocked("all")) return deviceError(c, 429, "Too many tries. Wait a minute.");
    const id = (c.req.param("id") ?? "").replace(/\.shortcut$/, "");
    const file = /^[0-9a-f]{32}$/.test(id) ? deps.installs?.take(id) : undefined;
    if (!file) {
      installMisses.take("all");
      return deviceError(
        c,
        404,
        "That download link was used already or has expired. Make a new one on your Mac.",
      );
    }
    return c.body(file.bytes as unknown as ArrayBuffer, 200, shortcutHeaders(file.name, file.personal));
  });

  app.post(DEVICE_ROUTES.pair, async (c) => {
    if (pairFailures.blocked("pair")) {
      c.header("Retry-After", String(pairFailures.retryAfter("pair")));
      return deviceError(c, 429, "Too many pairing tries. Wait a minute, then make a new code on your Mac.");
    }
    const body = await readBody(c, DevicePairBody);
    let paired: ReturnType<DeviceStore["pair"]>;
    try {
      paired = devices.pair({
        code: body.code,
        deviceName: body.deviceName,
        kind: body.kind,
        ...(body.publicKey ? { publicKey: body.publicKey } : {}),
      });
    } catch (err) {
      if (err instanceof PairingError) pairFailures.take("pair");
      throw err;
    }
    const { device, token } = paired;
    devices.touch(device, c.req.header(SHORTCUT_HEADER));
    const reply: DevicePairReply = {
      token,
      deviceId: device.id,
      scopes: device.scopes,
      minShortcutVersion: STEWARD_SHORTCUT.minVersion,
      ...(deps.access ? { access: deps.access } : {}),
      ui: [{ say: "Paired. Try asking Steward what needs you." }],
    };
    c.header("Cache-Control", "no-store");
    return c.json(reply);
  });

  // Everything below needs a device token.
  const authenticate: MiddlewareHandler<DeviceEnv> = async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const device = token ? devices.authenticate(token) : undefined;
    if (!device) {
      if (!failedTokens.take("all")) {
        c.header("Retry-After", String(failedTokens.retryAfter("all")));
        return deviceError(c, 429, "Too many tries. Wait a minute.");
      }
      c.header("WWW-Authenticate", 'Bearer realm="steward-device"');
      return deviceError(
        c,
        401,
        "This phone isn't paired with Steward any more. Pair it again from Settings → Phone on your Mac.",
      );
    }
    if (!perDevice.take(device.id)) {
      c.header("Retry-After", String(perDevice.retryAfter(device.id)));
      return deviceError(c, 429, "That's a lot of requests. Wait a minute.");
    }
    devices.touch(device, c.req.header(SHORTCUT_HEADER));
    c.set("device", device);
    c.header("Cache-Control", "no-store");
    await next();
  };
  app.use("/device/*", authenticate);

  const both = (path: string, handler: (c: Context<DeviceEnv>) => Response | Promise<Response>) => {
    app.get(path, handler);
    app.post(path, handler);
  };

  both(DEVICE_ROUTES.manifest, (c) => c.json(api.manifest()));
  both(DEVICE_ROUTES.home, (c) => c.json(api.home(c.get("device"))));
  both(DEVICE_ROUTES.brief, (c) => c.json(api.brief(c.get("device"))));
  both(DEVICE_ROUTES.approvals, (c) => {
    const status = c.req.query("status");
    if (status && status !== "pending")
      throw new HttpError(400, "A phone sees only what is waiting: status=pending.");
    return c.json(api.approvals(c.get("device")));
  });
  both(DEVICE_ROUTES.approval, (c) => c.json(api.approval(c.get("device"), c.req.param("id") ?? "")));

  app.post(DEVICE_ROUTES.approvalDecide, async (c) => {
    const body = await readDeviceBody(c, DeviceDecisionBody);
    return c.json(api.decide(c.get("device"), c.req.param("id"), body.answer, body.note));
  });

  const limitRuns = (c: Context<DeviceEnv>) => {
    const id = c.get("device").id;
    if (!runs.take(id)) {
      c.header("Retry-After", String(runs.retryAfter(id)));
      throw new HttpError(429, "Steward is busy with your last few requests. Wait a minute.");
    }
  };

  app.post(DEVICE_ROUTES.say, async (c) => {
    limitRuns(c);
    const body = await readDeviceBody(c, DeviceSayBody);
    return c.json(
      await api.say(c.get("device"), {
        text: body.text,
        ...(body.skill ? { skill: body.skill } : {}),
        ...(body.threadId ? { threadId: body.threadId } : {}),
      }),
    );
  });

  app.post(DEVICE_ROUTES.run, async (c) => {
    limitRuns(c);
    const body = await readDeviceBody(c, DeviceRunBody);
    return c.json(await api.run(c.get("device"), c.req.param("actionId"), body.text));
  });

  app.notFound((c) => deviceError(c, 404, "Couldn't find that."));
  return app;
}
