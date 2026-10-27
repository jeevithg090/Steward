import type { PageFetchConfig } from "./fetch-page.ts";
import { readCapped } from "./fetch-page.ts";
import { decodeEntities } from "./html-to-text.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchError";
  }
}

export const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

/**
 * Searches the web with DuckDuckGo's HTML endpoint, which needs no key and no account.
 *
 * One request per search, a User-Agent that says who is asking, and no retries: if DuckDuckGo turns
 * the request away, the model is told so in plain words rather than given an empty list it would
 * read as "nothing exists".
 */
export async function searchWeb(
  query: string,
  opts: { signal?: AbortSignal; limit?: number },
  config: PageFetchConfig,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) throw new WebSearchError("Give the search some words to look for.");
  if (q.length > 500) throw new WebSearchError("That search is too long. Keep it under 500 characters.");
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)));

  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`;

  let html: string;
  try {
    const res = await config.fetch(url, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "user-agent": config.userAgent,
        accept: "text/html",
        "accept-language": "en-GB,en;q=0.9",
      },
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      throw new WebSearchError(
        res.status === 202 || res.status === 403 || res.status === 429
          ? "DuckDuckGo is limiting automated searches right now. Try again in a minute, or open duckduckgo.com in the browser."
          : `DuckDuckGo answered ${res.status}, so the search did not run.`,
      );
    }
    html = new TextDecoder().decode((await readCapped(res, config.maxBytes)).bytes);
  } catch (err) {
    if (err instanceof WebSearchError) throw err;
    if (timeout.aborted && !opts.signal?.aborted) {
      throw new WebSearchError(
        `DuckDuckGo took longer than ${Math.round(config.timeoutMs / 1000)} seconds to answer.`,
      );
    }
    if (opts.signal?.aborted) throw err;
    throw new WebSearchError(`Couldn't reach DuckDuckGo: ${(err as Error).message}`);
  }

  const results = parseDuckDuckGoHtml(html, limit);
  if (results.length > 0) return results;
  if (/class="[^"]*\bno-results\b/i.test(html) || /No results found|No more results/i.test(html)) return [];
  if (/anomaly|challenge|captcha|unusual traffic/i.test(html)) {
    throw new WebSearchError(
      "DuckDuckGo asked for a check that Steward can't answer. Try again in a minute, or open duckduckgo.com in the browser.",
    );
  }
  throw new WebSearchError("DuckDuckGo answered, but Steward couldn't read any results from the page.");
}

const RESULT_LINK =
  /<a\b((?:[^>"']|"[^"]*"|'[^']*')*\bclass\s*=\s*["'][^"']*\b(?:result__a|result-link)\b[^"']*["'](?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi;
const SNIPPET =
  /<(a|div|td|span)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:result__snippet|result-snippet)\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i;

/**
 * Reads results from DuckDuckGo's HTML (and lite) result pages: each result's title link, its
 * snippet, and the real destination unwrapped from the `/l/?uddg=` redirect. Ads (`/y.js` links) and
 * anything that is not http or https are dropped, and duplicates are kept once.
 */
export function parseDuckDuckGoHtml(html: string, limit = MAX_LIMIT): SearchResult[] {
  const links = [...html.matchAll(RESULT_LINK)];
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < links.length && results.length < limit; i++) {
    const link = links[i];
    if (!link) continue;
    const attrs = link[1] ?? "";
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const url = unwrapResultUrl(href?.[1] ?? href?.[2] ?? "");
    if (!url || seen.has(url)) continue;
    const start = (link.index ?? 0) + link[0].length;
    const end = links[i + 1]?.index ?? html.length;
    const snippet = SNIPPET.exec(html.slice(start, end))?.[2] ?? "";
    const title = textOf(link[2] ?? "");
    if (!title) continue;
    seen.add(url);
    results.push({ title, url, snippet: textOf(snippet) });
  }
  return results;
}

/** The destination of a result link: `//duckduckgo.com/l/?uddg=<encoded>&rut=...` or a direct URL. */
export function unwrapResultUrl(rawHref: string): string | undefined {
  const href = decodeEntities(rawHref.trim());
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href.startsWith("//") ? `https:${href}` : href, "https://duckduckgo.com");
  } catch {
    return undefined;
  }
  if (/(^|\.)duckduckgo\.com$/.test(url.hostname)) {
    if (url.pathname === "/y.js" || url.searchParams.has("ad_domain")) return undefined;
    const target = url.searchParams.get("uddg");
    if (!target) return undefined;
    try {
      url = new URL(target);
    } catch {
      return undefined;
    }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return url.toString();
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
