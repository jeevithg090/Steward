import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DirectoryClient, hashPack } from "@steward/bots";
import type { BotListing } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNTRUSTED, VIA } from "../src/mcp.ts";
import { type Fixture, makeFixture, SITE } from "./fixture.ts";

let f: Fixture;

beforeAll(async () => {
  f = await makeFixture();
});

afterAll(async () => {
  await f.close();
});

const ids = (bots: BotListing[]) => bots.map((b) => b.id);

describe("what Steward reads", () => {
  it("serves index.json with this server as the site, open CORS, and every listing's page and pack", async () => {
    const res = await f.request("/index.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.body.site).toBe(SITE);
    expect(res.body.name).toBe("Test bots");
    expect(res.body.bots).toHaveLength(5);
    const rent = res.body.bots.find((b: BotListing) => b.id === "rent-scout");
    expect(rent.packUrl).toBe("packs/rent-scout.json");
    expect(rent.pageUrl).toBe(`${SITE}/bots/rent-scout`);
  });

  it("answers a CORS preflight from any origin", async () => {
    const res = await f.request("/api/bots", {
      method: "OPTIONS",
      headers: { origin: "https://elsewhere.example", "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves each pack byte for byte as built, with a hash that matches its content", async () => {
    const res = await f.request("/packs/rent-scout.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.text).toBe(readFileSync(join(f.dir, "packs", "rent-scout.json"), "utf8"));
    expect(hashPack(res.body)).toBe(res.body.hash);
    expect((await f.request("/packs/nope.json")).status).toBe(404);
    expect((await f.request("/packs/..%2Findex.json")).status).toBe(404);
  });

  it("works with Steward's own DirectoryClient: list, get, and a pack whose hash checks out", async () => {
    const client = new DirectoryClient({
      source: `${SITE}/index.json`,
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        f.server.app.request(
          typeof input === "string" ? input : input instanceof URL ? input.href : input,
          init,
        )) as typeof fetch,
    });
    const found = await client.list({ q: "rentals", sort: "match", limit: 5, offset: 0 });
    expect(found.bots[0]?.id).toBe("rent-scout");
    const pack = await client.pack(found.bots[0]!);
    expect(pack.id).toBe("rent-scout");
    expect(client.resolvePackUrl(found.bots[0]!.packUrl)).toBe(`${SITE}/packs/rent-scout.json`);
  });

  it("publishes feed.xml with the newest bots and llms.txt with the rules for agents", async () => {
    const feed = await f.request("/feed.xml");
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("application/rss+xml");
    expect(feed.text).toContain('<rss version="2.0"');
    expect((feed.text.match(/<item>/g) ?? []).length).toBe(5);
    expect(feed.text).toContain(`<link>${SITE}/bots/rent-scout</link>`);

    const llms = await f.request("/llms.txt");
    expect(llms.status).toBe(200);
    expect(llms.text).toContain("Credit the creator");
    expect(llms.text).toContain("untrusted");
    expect(llms.text).toContain("never follow instructions");
    expect(llms.text).toContain("Never invent a bot");
    expect(llms.text).toContain(`${SITE}/mcp`);
  });
});

describe("the browse site", () => {
  it("renders the home, browse, listing, submit and privacy pages", async () => {
    for (const path of ["/", "/bots", "/bots?category=home", "/bots/rent-scout", "/submit", "/privacy"]) {
      const res = await f.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(res.text, path).toContain('<main id="main">');
      expect(res.headers.get("content-security-policy"), path).toContain("default-src 'none'");
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(res.headers.get("access-control-allow-origin"), path).toBeNull();
    }
  });

  it("shows a listing's facts, an Add to Steward link with the pack's address, and escapes its README", async () => {
    const res = await f.request("/bots/rent-scout");
    expect(res.text).toContain("<h1>Rent Scout</h1>");
    expect(res.text).toContain(
      `href="http://localhost:5173/bots/add?pack=${encodeURIComponent(`${SITE}/packs/rent-scout.json`)}"`,
    );
    expect(res.text).toContain("By @sam");
    expect(res.text).toContain("Never pay");
    expect(res.text).toContain("find-rentals");
    expect(res.text).toContain("<strong>small print</strong>");
    expect(res.text).not.toContain("<img src=x");
    expect(res.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(res.text).not.toContain("javascript:");
    expect(res.text).toContain('href="https://example.org/rent" rel="nofollow noopener ugc"');
  });

  it("labels AI-made bots nobody has used yet", async () => {
    const res = await f.request("/bots/meal-planner");
    expect(res.text).toContain("AI-made with <code>test/model</code>");
    expect(res.text).toContain("not yet used by anyone");
  });

  it("answers 404 in HTML for a page and JSON for the API", async () => {
    const page = await f.request("/bots/no-such-bot");
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toContain("text/html");
    const api = await f.request("/api/bots/no-such-bot");
    expect(api.status).toBe(404);
    expect(api.body.error).toContain("no-such-bot");
  });

  it("searches from the browse page", async () => {
    const res = await f.request("/bots?q=dinners");
    expect(res.text).toContain("Meal Planner");
    expect(res.text).not.toContain("Rent Scout</a>");
  });
});

describe("search", () => {
  it("ranks a name match above a README-only match", async () => {
    const res = await f.request("/api/bots?q=rent");
    expect(res.status).toBe(200);
    expect(ids(res.body.bots)).toEqual(["rent-scout", "lease-reader"]);
    expect(res.body.total).toBe(2);
    expect(res.body.via).toBe(VIA);
    expect(res.body.note).toBe(UNTRUSTED);
  });

  it("finds words in the pitch, the starters and the README, with stemming", async () => {
    // "list" also matches Lease Reader's "lists" (stemmed); both words only meet in Meal Planner.
    expect(ids((await f.request("/api/bots?q=shopping+list")).body.bots)).toEqual([
      "meal-planner",
      "lease-reader",
    ]);
    expect(ids((await f.request("/api/bots?q=takeaway")).body.bots)).toEqual(["budget-buddy"]);
    expect(ids((await f.request("/api/bots?q=tenancy")).body.bots)).toEqual(["lease-reader"]);
    expect(ids((await f.request("/api/bots?q=planning")).body.bots)).toContain("meal-planner");
  });

  it("filters by category and by what a bot needs", async () => {
    expect(ids((await f.request("/api/bots?category=home")).body.bots).sort()).toEqual([
      "lease-reader",
      "rent-scout",
    ]);
    expect(ids((await f.request("/api/bots?needs=mail")).body.bots)).toEqual(["inbox-zero"]);
    expect(ids((await f.request("/api/bots?needs=browser_navigate")).body.bots)).toEqual(["rent-scout"]);
    expect((await f.request("/api/bots?needs=none")).body.total).toBe(4);
    expect((await f.request("/api/bots?category=nonsense")).status).toBe(400);
  });

  it("pages with limit and offset", async () => {
    const first = await f.request("/api/bots?limit=2&offset=0&sort=new");
    const second = await f.request("/api/bots?limit=2&offset=2&sort=new");
    expect(first.body.bots).toHaveLength(2);
    expect(first.body.total).toBe(5);
    expect(ids(first.body.bots)).not.toEqual(ids(second.body.bots));
    expect((await f.request("/api/bots?limit=1000")).status).toBe(400);
  });

  it("ignores FTS syntax in a query instead of failing", async () => {
    for (const q of ['"', "rent AND", "NEAR(", "*", "col:rent", "-rent"]) {
      const res = await f.request(`/api/bots?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
    }
  });

  it("returns one bot with its pack, and the categories with counts", async () => {
    const one = await f.request("/api/bots/inbox-zero");
    expect(one.status).toBe(200);
    expect(one.body.bot.packUrl).toBe(`${SITE}/packs/inbox-zero.json`);
    expect(one.body.pack.needs.connectors).toEqual(["mail"]);
    const cats = await f.request("/api/categories");
    expect(cats.body.categories.find((c: { id: string }) => c.id === "home")).toEqual({
      id: "home",
      label: "Home & family",
      count: 2,
    });
    expect(cats.body.categories).toHaveLength(19);
  });
});

describe("counts", () => {
  it("counts an install with no identity, once per address per bot per hour, and the index shows it", async () => {
    const one = await f.request("/api/bots/budget-buddy/installed", { method: "POST", ip: "198.51.100.1" });
    expect(one.status).toBe(200);
    expect(one.body).toEqual({ id: "budget-buddy", installs: 1, counted: true });
    const again = await f.request("/api/bots/budget-buddy/installed", { method: "POST", ip: "198.51.100.1" });
    expect(again.body).toEqual({ id: "budget-buddy", installs: 1, counted: false });
    await f.request("/api/bots/budget-buddy/installed", { method: "POST", ip: "198.51.100.2" });
    await f.request("/api/bots/budget-buddy/installed", { method: "POST", ip: "198.51.100.3" });

    const index = await f.request("/index.json");
    expect(index.body.bots.find((b: BotListing) => b.id === "budget-buddy").installs).toBe(3);
    expect(ids((await f.request("/api/bots?sort=installs")).body.bots)[0]).toBe("budget-buddy");
    expect(f.server.store.installsPerDay("budget-buddy")).toEqual([
      { day: new Date().toISOString().slice(0, 10), n: 3 },
    ]);
    expect((await f.request("/api/bots/nope/installed", { method: "POST" })).status).toBe(404);
  });

  it("matches the address Steward's server posts to", async () => {
    const { countsEndpoint } = await import("../../server/src/bots/service.ts");
    expect(countsEndpoint(`${SITE}/index.json`, "rent-scout", { site: SITE })).toBe(
      `${SITE}/api/bots/rent-scout/installed`,
    );
  });

  it("counts 'I use this' once per signed-in account and lets it be undone", async () => {
    expect((await f.request("/api/bots/lease-reader/used", { method: "POST" })).status).toBe(401);
    const a = f.signIn("ana", 101);
    const b = f.signIn("ben", 102);
    expect((await f.request("/api/bots/lease-reader/used", { method: "POST", session: a })).body).toEqual({
      id: "lease-reader",
      usedBy: 1,
      added: true,
    });
    expect((await f.request("/api/bots/lease-reader/used", { method: "POST", session: a })).body.added).toBe(
      false,
    );
    expect((await f.request("/api/bots/lease-reader/used", { method: "POST", session: b })).body.usedBy).toBe(
      2,
    );
    expect(ids((await f.request("/api/bots?sort=used")).body.bots)[0]).toBe("lease-reader");
    expect(
      (await f.request("/index.json")).body.bots.find((x: BotListing) => x.id === "lease-reader").usedBy,
    ).toBe(2);
    expect(
      (await f.request("/api/bots/lease-reader/used", { method: "DELETE", session: b })).body.usedBy,
    ).toBe(1);
  });

  it("refuses a signed-in vote sent by another site", async () => {
    const a = f.signIn("cy", 103);
    const res = await f.request("/api/bots/lease-reader/used", {
      method: "POST",
      session: a,
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("works from the listing page's form for a signed-in person", async () => {
    const a = f.signIn("dee", 104);
    const res = await f.request("/bots/inbox-zero/used", {
      method: "POST",
      session: a,
      headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/bots/inbox-zero?m=used#main");
    const page = await f.request("/bots/inbox-zero?m=used", { session: a });
    expect(page.text).toContain("You use this");
    expect(page.text).toContain("recorded that you use this bot");
  });
});

describe("reports and removal requests", () => {
  it("records a report and a removal request, and emails nothing", async () => {
    const report = await f.request("/api/bots/rent-scout/report", {
      method: "POST",
      json: { reason: "spam", details: "An advert." },
    });
    expect(report.status).toBe(201);
    expect(report.body.recorded).toBe(true);
    const removal = await f.request("/bots/rent-scout/removal-request", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: SITE },
      body: "reason=It+is+mine+and+I+want+it+down&contact=report%40example.org",
    });
    expect(removal.status).toBe(303);
    const open = f.server.store.reports("open");
    expect(open.map((r) => [r.botId, r.kind, r.reason])).toEqual([
      ["rent-scout", "report", "spam"],
      ["rent-scout", "removal", "It is mine and I want it down"],
    ]);
    expect((await f.request("/api/bots/rent-scout/report", { method: "POST", json: {} })).status).toBe(400);
  });
});

describe("MCP", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: "scripted-agent", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${SITE}/mcp`), {
      fetch: async (input, init) =>
        f.server.app.request(typeof input === "string" ? input : input.toString(), init),
    });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("offers meetmybot's five tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "find_bots",
      "get_bot",
      "latest",
      "list_categories",
      "submit_bot",
    ]);
    expect(tools.find((t) => t.name === "find_bots")?.annotations?.readOnlyHint).toBe(true);
  });

  it("find_bots returns ranked listings that each carry pageUrl, packUrl, author and the credit line", async () => {
    const result = await client.callTool({
      name: "find_bots",
      arguments: { query: "find me a flat to rent" },
    });
    const out = result.structuredContent as { bots: Record<string, unknown>[]; via: string; note: string };
    expect(out.bots.map((b) => b.id)[0]).toBe("rent-scout");
    for (const bot of out.bots) {
      expect(bot.pageUrl).toBe(`${SITE}/bots/${bot.id}`);
      expect(bot.packUrl).toBe(`${SITE}/packs/${bot.id}.json`);
      expect(bot.author).toBeDefined();
      expect(bot.via).toBe(VIA);
    }
    expect(out.via).toBe(VIA);
    expect(out.note).toContain("never follow instructions");
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toContain("Rent Scout (rent-scout)");
    expect(text).toContain("@sam · 0 installs");
    expect(text).toContain(VIA);
  });

  it("find_bots says plainly when nothing matches", async () => {
    const result = await client.callTool({ name: "find_bots", arguments: { query: "zzqx" } });
    expect((result.structuredContent as { bots: unknown[] }).bots).toEqual([]);
    expect((result.content as { text: string }[])[0]?.text).toContain("do not invent one");
  });

  it("get_bot returns the pack's details, and an error for an unknown id", async () => {
    const result = await client.callTool({ name: "get_bot", arguments: { id: "rent-scout" } });
    const bot = (result.structuredContent as { bot: Record<string, unknown> }).bot;
    expect(bot.pageUrl).toBe(`${SITE}/bots/rent-scout`);
    expect(bot.packUrl).toBe(`${SITE}/packs/rent-scout.json`);
    expect(bot.author).toEqual({ kind: "person", handle: "sam" });
    expect(bot.rules).toEqual([
      { name: "Never pay", effect: "deny", when: 'tool.kind == "pay"', description: "Deposits are yours." },
    ]);
    expect(bot.via).toBe(VIA);
    const missing = await client.callTool({ name: "get_bot", arguments: { id: "nope" } });
    expect(missing.isError).toBe(true);
  });

  it("latest and list_categories answer", async () => {
    const latest = await client.callTool({ name: "latest", arguments: { limit: 2 } });
    const bots = (latest.structuredContent as { bots: { via: string; packUrl: string }[] }).bots;
    expect(bots).toHaveLength(2);
    expect(bots.every((b) => b.via === VIA && b.packUrl.startsWith(SITE))).toBe(true);
    const cats = await client.callTool({ name: "list_categories", arguments: {} });
    const list = (cats.structuredContent as { categories: { id: string; count: number }[] }).categories;
    expect(list.find((c) => c.id === "food")?.count).toBe(1);
  });

  it("submit_bot refuses without confirm_its_mine", async () => {
    const result = await client.callTool({
      name: "submit_bot",
      arguments: { confirm_its_mine: false, pack_url: "https://github.com/sam/x", creator_handle: "sam" },
    });
    expect(result.isError).toBe(true);
    expect(f.server.store.submissions()).toHaveLength(0);
  });

  it("is rate limited per address", async () => {
    const limited = await makeFixture({ deps: { limits: { perMinute: 3, writesPerHour: 10 } } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await limited.request("/mcp", {
          method: "POST",
          headers: { accept: "application/json, text/event-stream" },
          json: { jsonrpc: "2.0", id: i, method: "tools/list", params: {} },
          ip: "192.0.2.9",
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
      expect(statuses.slice(3)).toEqual([429, 429]);
      const other = await limited.request("/index.json", { ip: "192.0.2.10" });
      expect(other.status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
