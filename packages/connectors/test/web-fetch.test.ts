import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BlockedAddressError, type LookupFn } from "../src/net/address.ts";
import { createGuardedFetch, type FetchLike } from "../src/net/guarded-fetch.ts";
import { WebFetchError } from "../src/web/fetch-page.ts";
import { createWebTools } from "../src/web/web-tools.ts";

const dns: LookupFn = async (host) => {
  const table: Record<string, string> = {
    "news.example": "93.184.215.14",
    "other.example": "93.184.215.15",
    "evil.example": "93.184.215.66",
    "rebind.example": "127.0.0.1",
    "cloud.example": "169.254.169.254",
  };
  const address = table[host];
  if (!address) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
  return [{ address, family: 4 }];
};

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

/** A mock fetch keyed by URL. Records every URL it was asked for. */
function routes(table: Record<string, () => Response>) {
  const seen: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = String(input);
    seen.push(url);
    const make = table[url];
    if (!make) return new Response("not found", { status: 404, statusText: "Not Found" });
    return make();
  };
  return { fetch, seen };
}

describe("web fetch: host checks", () => {
  it.each([
    "http://127.0.0.1:8787/api/info",
    "http://localhost/",
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[::1]/",
  ])("refuses %s before making any request", async (url) => {
    const fetch = vi.fn<FetchLike>();
    const web = createWebTools({ fetch, lookup: dns });
    await expect(web.fetch(url)).rejects.toBeInstanceOf(BlockedAddressError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a public name that resolves to loopback", async () => {
    const fetch = vi.fn<FetchLike>();
    await expect(createWebTools({ fetch, lookup: dns }).fetch("http://rebind.example/")).rejects.toThrow(
      /private network/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses metadata even when private hosts are allowed", async () => {
    const fetch = vi.fn<FetchLike>();
    const web = createWebTools({ fetch, lookup: dns, allowPrivateHosts: true });
    await expect(web.fetch("http://cloud.example/")).rejects.toThrow(/metadata/);
    await expect(web.fetch("http://169.254.169.254/")).rejects.toThrow(/metadata/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses file: and other schemes", async () => {
    await expect(createWebTools({ lookup: dns }).fetch("file:///etc/passwd")).rejects.toThrow(
      /Only web addresses/,
    );
  });
});

describe("web fetch: redirects", () => {
  it("follows redirects and reports the final address", async () => {
    const { fetch, seen } = routes({
      "https://news.example/a": () => redirect("/b", 301),
      "https://news.example/b": () => redirect("https://other.example/story"),
      "https://other.example/story": () => html("<title>Story</title><p>Hello</p>"),
    });
    const page = await createWebTools({ fetch, lookup: dns }).fetch("https://news.example/a#top");
    expect(page).toEqual({
      url: "https://other.example/story",
      title: "Story",
      text: "Hello",
      truncated: false,
    });
    expect(seen).toEqual(["https://news.example/a", "https://news.example/b", "https://other.example/story"]);
  });

  it("re-checks every hop and refuses a redirect to loopback", async () => {
    const { fetch, seen } = routes({
      "https://evil.example/": () => redirect("http://127.0.0.1:8787/api/settings"),
    });
    await expect(
      createWebTools({ fetch, lookup: dns }).fetch("https://evil.example/"),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    expect(seen).toEqual(["https://evil.example/"]);
  });

  it("refuses a redirect to the metadata service", async () => {
    const { fetch, seen } = routes({
      "https://evil.example/": () => redirect("http://169.254.169.254/latest/meta-data/"),
    });
    await expect(createWebTools({ fetch, lookup: dns }).fetch("https://evil.example/")).rejects.toThrow(
      /metadata/,
    );
    expect(seen).toHaveLength(1);
  });

  it("refuses a redirect to a name that resolves privately", async () => {
    const { fetch, seen } = routes({
      "https://evil.example/": () => redirect("http://rebind.example/admin"),
    });
    await expect(createWebTools({ fetch, lookup: dns }).fetch("https://evil.example/")).rejects.toThrow(
      /private network/,
    );
    expect(seen).toEqual(["https://evil.example/"]);
  });

  it("stops after five redirects", async () => {
    const table: Record<string, () => Response> = {};
    for (let i = 0; i < 7; i++) table[`https://news.example/${i}`] = () => redirect(`/${i + 1}`);
    const { fetch, seen } = routes(table);
    await expect(createWebTools({ fetch, lookup: dns }).fetch("https://news.example/0")).rejects.toThrow(
      /redirected more than 5 times/,
    );
    expect(seen).toHaveLength(6);
  });
});

describe("web fetch: content", () => {
  it("caps the body at maxBytes and marks it truncated", async () => {
    const big = `<title>Big</title><p>${"word ".repeat(10_000)}</p>`;
    const { fetch } = routes({ "https://news.example/big": () => html(big) });
    const page = await createWebTools({ fetch, lookup: dns, maxBytes: 1000 }).fetch(
      "https://news.example/big",
    );
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThan(1000);
  });

  it("cuts the text at maxChars", async () => {
    const { fetch } = routes({ "https://news.example/p": () => html(`<p>${"abc ".repeat(500)}</p>`) });
    const page = await createWebTools({ fetch, lookup: dns }).fetch("https://news.example/p", {
      maxChars: 300,
    });
    expect(page.text).toHaveLength(300);
    expect(page.truncated).toBe(true);
  });

  it("converts a page only as far as maxChars needs, and says when it stopped early", async () => {
    // Line breaks fill the converter's budget before any text, so it stops before "Later".
    const { fetch } = routes({
      "https://news.example/breaks": () => html(`${"<br>".repeat(10_000)}<p>Later</p>`),
    });
    const page = await createWebTools({ fetch, lookup: dns }).fetch("https://news.example/breaks", {
      maxChars: 300,
    });
    expect(page.text).not.toContain("Later");
    expect(page.truncated).toBe(true);
  });

  it("returns plain text and JSON as they are, titled by the path", async () => {
    const { fetch } = routes({
      "https://news.example/data/report.json": () =>
        new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    });
    const page = await createWebTools({ fetch, lookup: dns }).fetch("https://news.example/data/report.json");
    expect(page).toMatchObject({ title: "report.json", text: '{"ok":true}', truncated: false });
  });

  it("refuses binary files in plain words", async () => {
    const { fetch } = routes({
      "https://news.example/f.pdf": () =>
        new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
    });
    await expect(createWebTools({ fetch, lookup: dns }).fetch("https://news.example/f.pdf")).rejects.toThrow(
      "That address is a application/pdf file, which Steward can't read as text.",
    );
  });

  it("reports an error status", async () => {
    const { fetch } = routes({});
    const err = await createWebTools({ fetch, lookup: dns })
      .fetch("https://news.example/missing")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebFetchError);
    expect((err as WebFetchError).message).toBe("The page answered 404 Not Found.");
  });

  it("decodes the charset the page declares", async () => {
    const latin1 = new Uint8Array([...Buffer.from("<p>caf"), 0xe9, ...Buffer.from("</p>")]);
    const { fetch } = routes({
      "https://news.example/fr": () =>
        new Response(latin1, { headers: { "content-type": "text/html; charset=iso-8859-1" } }),
    });
    expect((await createWebTools({ fetch, lookup: dns }).fetch("https://news.example/fr")).text).toBe("café");
  });

  it("times out with a clear sentence", async () => {
    const fetch: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await expect(
      createWebTools({ fetch, lookup: dns, timeoutMs: 50 }).fetch("https://news.example/slow"),
    ).rejects.toThrow("The page took longer than 0 seconds to answer.");
  });

  it("sends a User-Agent that says who is asking", async () => {
    const fetch = vi.fn<FetchLike>(async () => html("<p>x</p>"));
    await createWebTools({ fetch, lookup: dns }).fetch("https://news.example/");
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("user-agent")).toMatch(/Steward/);
  });
});

describe("guarded fetch against a real local server", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/gzip") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("<title>Zipped</title><p>Unzipped text</p>"));
      } else if (req.url === "/hop") {
        res.writeHead(302, { location: "/gzip" });
        res.end();
      } else if (req.url === "/echo" && req.method === "POST") {
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c.toString();
        });
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ body, type: req.headers["content-type"] }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reads a gzipped page through a redirect when private hosts are allowed", async () => {
    const page = await createWebTools({ allowPrivateHosts: true }).fetch(`${base}/hop`);
    expect(page).toEqual({ url: `${base}/gzip`, title: "Zipped", text: "Unzipped text", truncated: false });
  });

  it("says plainly when a server refuses the connection", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const err = await createWebTools({ allowPrivateHosts: true })
      .fetch(`http://127.0.0.1:${port}/`)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebFetchError);
    expect((err as Error).message).toBe("127.0.0.1 refused the connection.");
  });

  it("refuses the same server when private hosts are not allowed", async () => {
    await expect(createWebTools().fetch(`${base}/gzip`)).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("judges the address inside the socket's own lookup, so a rebinding name never connects", async () => {
    const port = (server.address() as AddressInfo).port;
    const guarded = createGuardedFetch({ lookup: dns });
    await expect(guarded(`http://rebind.example:${port}/gzip`)).rejects.toBeInstanceOf(BlockedAddressError);
    const allowed = createGuardedFetch({ lookup: dns, allowPrivateHosts: true });
    const res = await allowed(`http://rebind.example:${port}/gzip`);
    expect(await res.text()).toContain("Unzipped text");
  });

  it("sends request bodies and leaves redirects to the caller", async () => {
    const guarded = createGuardedFetch({ allowPrivateHosts: true });
    const res = await guarded(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"hello":"world"}',
    });
    expect(await res.json()).toEqual({ body: '{"hello":"world"}', type: "application/json" });
    const hop = await guarded(`${base}/hop`);
    expect(hop.status).toBe(302);
    expect(hop.headers.get("location")).toBe("/gzip");
  });
});
