import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEV_ORIGINS } from "../src/config.ts";
import { HttpError, onError, readBody } from "../src/http/errors.ts";
import {
  devCors,
  hostGuard,
  isAllowedHost,
  limitBody,
  originGuard,
  type SecurityOptions,
  securityHeaders,
} from "../src/http/security.ts";
import { resolveStatic, serveWebApp } from "../src/http/static.ts";
import { tempDir } from "./helpers.ts";

const opts: SecurityOptions = { bindHost: "127.0.0.1", allowedHosts: [], devOrigins: DEV_ORIGINS };

function guarded() {
  const app = new Hono();
  app.onError(onError);
  app.use("*", securityHeaders());
  app.use("*", hostGuard(opts));
  app.use("/api/*", devCors(opts));
  app.use("/api/*", limitBody(1024));
  app.use("/api/*", originGuard(opts));
  app.get("/api/thing", (c) => c.json({ ok: true }));
  app.post("/api/ping", (c) => c.json({ ok: true }));
  app.post("/api/thing", async (c) => c.json(await readBody(c, z.object({ name: z.string().min(1) }))));
  app.get("/api/boom", () => {
    throw new Error("SQLITE_CONSTRAINT: secret detail at db.ts:42");
  });
  app.get("/api/teapot", () => {
    throw new HttpError(409, "That was already answered.");
  });
  return app;
}

const post = (headers: Record<string, string>, body = '{"name":"x"}') =>
  guarded().request("http://127.0.0.1:8787/api/thing", {
    method: "POST",
    headers: {
      host: "127.0.0.1:8787",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      ...headers,
    },
    body,
  });

describe("host guard", () => {
  it("answers on loopback names only (DNS rebinding)", async () => {
    const app = guarded();
    for (const host of ["127.0.0.1:8787", "localhost:5173", "[::1]:8787", "steward.localhost"]) {
      expect((await app.request("http://x/api/thing", { headers: { host } })).status).toBe(200);
    }
    const evil = await app.request("http://x/api/thing", { headers: { host: "evil.example:8787" } });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: "Steward only answers on this machine's own address." });
  });

  it("accepts a named bind address and STEWARD_ALLOWED_HOSTS", () => {
    expect(isAllowedHost("192.168.1.5:8787", { ...opts, bindHost: "192.168.1.5" })).toBe(true);
    expect(isAllowedHost("192.168.1.5:8787", { ...opts, bindHost: "0.0.0.0" })).toBe(false);
    expect(isAllowedHost("box.lan:8787", { ...opts, allowedHosts: ["box.lan"] })).toBe(true);
  });
});

describe("origin guard", () => {
  it("allows same-origin, the Vite dev server and programs without an Origin", async () => {
    expect((await post({ origin: "http://127.0.0.1:8787" })).status).toBe(200);
    expect((await post({ origin: "http://localhost:5173" })).status).toBe(200);
    expect((await post({})).status).toBe(200);
  });

  it("refuses other sites, by Origin or Sec-Fetch-Site", async () => {
    const res = await post({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Requests from other sites are refused." });
    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ origin: "null" })).status).toBe(403);
  });

  it("only takes JSON bodies, and lets bodyless requests through", async () => {
    const res = await post({ "content-type": "text/plain" });
    expect(res.status).toBe(415);
    const bodyless = await guarded().request("http://127.0.0.1:8787/api/ping", {
      method: "POST",
      headers: { host: "127.0.0.1:8787" },
    });
    expect(bodyless.status).toBe(200);
  });

  it("validates bodies and limits their size", async () => {
    const bad = await post({}, '{"name":""}');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/^name: /);
    expect((await post({}, "{not json")).status).toBe(400);
    expect((await post({}, JSON.stringify({ name: "x".repeat(5000) }))).status).toBe(413);
  });

  it("answers CORS preflights for the dev origin only", async () => {
    const app = guarded();
    const ok = await app.request("http://x/api/thing", {
      method: "OPTIONS",
      headers: {
        host: "127.0.0.1:8787",
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const no = await app.request("http://x/api/thing", {
      method: "OPTIONS",
      headers: {
        host: "127.0.0.1:8787",
        origin: "https://evil.example",
        "access-control-request-method": "POST",
      },
    });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("errors and headers", () => {
  it("never leaks internals, and passes person-facing errors through", async () => {
    const app = guarded();
    const boom = await app.request("http://x/api/boom", { headers: { host: "localhost" } });
    expect(boom.status).toBe(500);
    const text = await boom.text();
    expect(text).not.toContain("SQLITE");
    expect(JSON.parse(text)).toEqual({ error: "Something went wrong on Steward's side. Try again." });
    const teapot = await app.request("http://x/api/teapot", { headers: { host: "localhost" } });
    expect(teapot.status).toBe(409);
    expect(await teapot.json()).toEqual({ error: "That was already answered." });
  });

  it("sets protective headers on every response", async () => {
    const res = await guarded().request("http://x/api/thing", { headers: { host: "localhost" } });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("static web app", () => {
  it("serves files, falls back to index.html for app routes, and never escapes dist", async () => {
    const { dir, remove } = tempDir();
    try {
      const dist = join(dir, "dist");
      mkdirSync(join(dist, "assets"), { recursive: true });
      writeFileSync(join(dist, "index.html"), "<!doctype html><title>Steward</title>");
      writeFileSync(join(dist, "assets", "app-123.js"), "console.log(1)");
      writeFileSync(join(dir, "secret.txt"), "nope");
      symlinkSync(join(dir, "secret.txt"), join(dist, "link.txt"));

      const app = new Hono();
      app.get("/api/x", (c) => c.json({ api: true }));
      expect(serveWebApp(app, dist)).toBe(true);
      app.notFound((c) => c.json({ error: "Couldn't find that." }, 404));

      const asset = await app.request("/assets/app-123.js");
      expect(asset.headers.get("content-type")).toContain("javascript");
      expect(asset.headers.get("cache-control")).toContain("immutable");
      const route = await app.request("/chat/thr_1");
      expect(await route.text()).toContain("<title>Steward</title>");
      expect((await app.request("/api/x")).status).toBe(200);
      expect((await app.request("/api/missing")).status).toBe(404);
      expect((await app.request("/missing.png")).status).toBe(404);
      expect(resolveStatic(dist, "/../secret.txt")).toBeUndefined();
      expect(resolveStatic(dist, "/%2e%2e/secret.txt")).toBeUndefined();
      expect(resolveStatic(dist, "/link.txt")).toBeUndefined();
    } finally {
      remove();
    }
  });

  it("does nothing when the web app is not built", () => {
    expect(serveWebApp(new Hono(), "/definitely/not/here")).toBe(false);
  });
});
