import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../src/net/guarded-fetch.ts";
import { parseDuckDuckGoHtml, unwrapResultUrl, WebSearchError } from "../src/web/search.ts";
import { createWebTools } from "../src/web/web-tools.ts";

const FIXTURE = readFileSync(new URL("./fixtures/ddg-results.html", import.meta.url), "utf8");

describe("parseDuckDuckGoHtml", () => {
  const results = parseDuckDuckGoHtml(FIXTURE);

  it("unwraps the uddg redirect, skips ads, duplicates and non-web links", () => {
    expect(results.map((r) => r.url)).toEqual([
      "https://sqlite.example.org/wal.html",
      "https://blog.example.com/posts/wal?ref=ddg&lang=en",
      "https://forum.example.net/t/wal-on-nfs",
    ]);
  });

  it("strips markup and decodes entities in titles and snippets", () => {
    expect(results[0]).toEqual({
      title: "Write-Ahead Logging - SQLite",
      url: "https://sqlite.example.org/wal.html",
      snippet:
        'The default method by which SQLite implements atomic commit is a rollback journal. Beginning with version 3.7.0, a new "Write-Ahead Log" option is available.',
    });
    expect(results[1]?.title).toBe("WAL mode explained & when to use it");
    expect(results[1]?.snippet).toBe("It's faster for most workloads because readers do not block writers.");
  });

  it("honours the limit", () => {
    expect(parseDuckDuckGoHtml(FIXTURE, 2)).toHaveLength(2);
  });

  it("reads the lite layout too", () => {
    const lite = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F" class='result-link'>A result</a></td></tr>
      <tr><td class='result-snippet'>Lite <b>snippet</b></td></tr></table>`;
    expect(parseDuckDuckGoHtml(lite)).toEqual([
      { title: "A result", url: "https://a.example/", snippet: "Lite snippet" },
    ]);
  });
});

describe("unwrapResultUrl", () => {
  it("handles protocol-relative, entity-encoded and direct links", () => {
    expect(unwrapResultUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.example%2Fa%3Fb%3D1&amp;rut=z")).toBe(
      "https://x.example/a?b=1",
    );
    expect(unwrapResultUrl("https://y.example/direct")).toBe("https://y.example/direct");
    expect(unwrapResultUrl("https://duckduckgo.com/y.js?ad_domain=z")).toBeUndefined();
    expect(unwrapResultUrl("javascript:alert(1)")).toBeUndefined();
  });
});

describe("web search", () => {
  it("asks DuckDuckGo's HTML endpoint with a polite User-Agent", async () => {
    const fetch = vi.fn<FetchLike>(
      async () => new Response(FIXTURE, { headers: { "content-type": "text/html" } }),
    );
    const results = await createWebTools({ fetch }).search("sqlite wal mode", { limit: 1 });
    expect(results).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://html.duckduckgo.com/html/?q=sqlite%20wal%20mode");
    expect(new Headers(init?.headers).get("user-agent")).toMatch(/Steward/);
  });

  it("returns an empty list only when DuckDuckGo says there are no results", async () => {
    const fetch: FetchLike = async () => new Response('<div class="no-results">No results.</div>');
    await expect(createWebTools({ fetch }).search("zzqqxx")).resolves.toEqual([]);
  });

  it("says so when DuckDuckGo is limiting automated searches", async () => {
    const fetch: FetchLike = async () => new Response("", { status: 202 });
    await expect(createWebTools({ fetch }).search("anything")).rejects.toThrow(/limiting automated searches/);
    const challenge: FetchLike = async () => new Response("<form id='challenge-form'>anomaly</form>");
    await expect(createWebTools({ fetch: challenge }).search("anything")).rejects.toThrow(
      /asked for a check/,
    );
  });

  it("does not pass off an unreadable page as no results", async () => {
    const fetch: FetchLike = async () => new Response("<html><body>Something new</body></html>");
    await expect(createWebTools({ fetch }).search("anything")).rejects.toThrow(/couldn't read any results/);
  });

  it("wraps network failures in a clear error", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND html.duckduckgo.com");
    };
    const err = await createWebTools({ fetch })
      .search("anything")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebSearchError);
    expect((err as Error).message).toMatch(/^Couldn't reach DuckDuckGo/);
  });

  it("refuses an empty query", async () => {
    await expect(createWebTools({ fetch: vi.fn<FetchLike>() }).search("   ")).rejects.toThrow(/some words/);
  });
});
