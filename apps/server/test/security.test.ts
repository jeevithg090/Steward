import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { type ServerType, serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
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

/** What the server runs with: no other origin trusted. */
const opts: SecurityOptions = { bindHost: "127.0.0.1", allowedHosts: [], devOrigins: [] };
/** With STEWARD_DEV_ORIGINS=1, for a web app that calls the server directly. */
const devOpts: SecurityOptions = { ...opts, devOrigins: DEV_ORIGINS };

function guarded(opts: SecurityOptions = devOpts) {
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
  app.get("/api/huge", () => {
    throw new HTTPException(413);
  });
  return app;
}

const post = (headers: Record<string, string>, body = '{"name":"x"}', options = devOpts) =>
  guarded(options).request("http://127.0.0.1:8787/api/thing", {
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
  it("allows same-origin and programs without an Origin", async () => {
    expect((await post({ origin: "http://127.0.0.1:8787" }, undefined, opts)).status).toBe(200);
    expect((await post({}, undefined, opts)).status).toBe(200);
  });

  it("trusts no page on another port unless STEWARD_DEV_ORIGINS is on", async () => {
    // Any page on these ports, another project's dev server included, would get the whole API.
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:4173"]) {
      expect((await post({ origin }, undefined, opts)).status).toBe(403);
      const read = await guarded(opts).request("http://127.0.0.1:8787/api/thing", {
        headers: { host: "127.0.0.1:8787", origin },
      });
      expect(read.status).toBe(403);
      expect(read.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect((await post({ origin: "http://localhost:5173" })).status).toBe(200);
    expect((await post({ origin: "http://localhost:4173" })).status).toBe(200);
    expect((await post({ origin: "http://127.0.0.1:4174" })).status).toBe(403);
  });

  it("answers a page served through Vite's proxy, which passes the browser's Host through", async () => {
    const res = await guarded(opts).request("http://127.0.0.1:5173/api/thing", {
      method: "POST",
      headers: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        "content-type": "application/json",
        "content-length": "12",
      },
      body: '{"name":"x"}',
    });
    expect(res.status).toBe(200);
  });

  it("refuses other sites, by Origin or Sec-Fetch-Site, reads included", async () => {
    const res = await post({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Requests from other sites are refused." });
    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ origin: "null" })).status).toBe(403);
    const read = (headers: Record<string, string>) =>
      guarded(opts).request("http://127.0.0.1:8787/api/thing", {
        headers: { host: "127.0.0.1:8787", ...headers },
      });
    expect((await read({ origin: "https://evil.example" })).status).toBe(403);
    expect((await read({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await read({ origin: "null" })).status).toBe(403);
    expect((await read({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await read({ "sec-fetch-site": "none" })).status).toBe(200);
  });

  it("only takes JSON bodies, and lets bodyless requests through", async () => {
    const res = await post({ "content-type": "text/plain" });
    expect(res.status).toBe(415);
    // The media type itself, not a mention of JSON somewhere in the header.
    expect((await post({ "content-type": "text/plain; application/json" })).status).toBe(415);
    expect((await post({ "content-type": "application/json-patch" })).status).toBe(415);
    expect((await post({ "content-type": "Application/JSON; charset=utf-8" })).status).toBe(200);
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

  it("closes the connection after a body too large, so the next request is not reset", async () => {
    const app = guarded(opts);
    const server = await new Promise<ServerType>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (let round = 0; round < 3; round++) {
        const big = await fetch(`${base}/api/thing`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x".repeat(300 * 1024) }),
        });
        expect(big.status).toBe(413);
        expect(big.headers.get("connection")).toBe("close");
        expect(await big.json()).toEqual({ error: "That request is too large." });
        for (let i = 0; i < 3; i++) expect((await fetch(`${base}/api/thing`)).status).toBe(200);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
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
    const huge = await app.request("http://x/api/huge", { headers: { host: "localhost" } });
    expect(huge.status).toBe(413);
    expect(huge.headers.get("connection")).toBe("close");
    expect(await huge.json()).toEqual({ error: "That request is too large." });
  });

  it("sets protective headers on every response", async () => {
    const res = await guarded().request("http://x/api/thing", { headers: { host: "localhost" } });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("loads images only from this server, data: and blob:", async () => {
    const res = await guarded().request("http://x/api/thing", { headers: { host: "localhost" } });
    const directives = (res.headers.get("content-security-policy") ?? "").split(";").map((d) => d.trim());
    // An image in a reply that points at another host must not load.
    expect(directives.find((d) => d.startsWith("img-src"))).toBe("img-src 'self' data: blob:");
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
      // The phone's routes live only on the device port: here they are a plain 404, never the page.
      expect((await app.request("/device/home")).status).toBe(404);
      expect((await app.request("/device")).status).toBe(404);
      expect(await (await app.request("/devices-guide")).text()).toContain("<title>Steward</title>");
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
