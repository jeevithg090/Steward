import type { WebTools } from "@steward/shared";
import type { LookupFn } from "../net/address.ts";
import { createGuardedFetch, type FetchLike } from "../net/guarded-fetch.ts";
import { fetchPage, type PageFetchConfig } from "./fetch-page.ts";
import { searchWeb } from "./search.ts";

export interface WebToolsOptions {
  /** Allow loopback and private-network addresses (local development only). Metadata stays refused. */
  allowPrivateHosts?: boolean;
  /** Replaces the guarded fetch. Tests pass a mock; production leaves it unset. */
  fetch?: FetchLike;
  /** Replaces DNS resolution for the per-hop host check. */
  lookup?: LookupFn;
  /** Per call, across all redirects. Default 15 s. */
  timeoutMs?: number;
  /** Most body bytes read, after decompression. Default 2 MB. */
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export const STEWARD_USER_AGENT =
  "Mozilla/5.0 (compatible; Steward/0.1; open-source personal agent acting for one person)";

/**
 * The web without the browser: `fetch` reads one public page as text, `search` asks DuckDuckGo.
 * Both refuse private and metadata addresses (see `net/address.ts`), time out after 15 seconds and
 * read at most 2 MB. They do no policy of their own: the gateway decides whether they run.
 */
export function createWebTools(opts: WebToolsOptions = {}): WebTools {
  const policy = { allowPrivateHosts: opts.allowPrivateHosts ?? false, lookup: opts.lookup };
  const config: PageFetchConfig = {
    ...policy,
    fetch: opts.fetch ?? createGuardedFetch(policy),
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxBytes: opts.maxBytes ?? 2 * 1024 * 1024,
    maxRedirects: opts.maxRedirects ?? 5,
    userAgent: opts.userAgent ?? STEWARD_USER_AGENT,
  };
  return {
    fetch: (url, o = {}) => fetchPage(url, o, config),
    search: (query, o = {}) => searchWeb(query, o, config),
  };
}
