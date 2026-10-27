import { assertPublicHost, BlockedAddressError, checkWebAddress, type HostPolicy } from "../net/address.ts";
import type { FetchLike } from "../net/guarded-fetch.ts";
import { htmlToText } from "./html-to-text.ts";

export interface PageFetchConfig extends HostPolicy {
  fetch: FetchLike;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

/** A page Steward could not read, with a sentence the model can relay. */
export class WebFetchError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WebFetchError";
    this.status = status;
  }
}

export const DEFAULT_MAX_CHARS = 20_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetches a public page as readable text.
 *
 * Every hop is judged: the address itself, then every address its name resolves to. A page on the
 * internet that redirects to `http://127.0.0.1:8787/api/...` or to the metadata service is refused at
 * that hop, not followed. With the default guarded fetch the socket re-checks at connect time too.
 */
export async function fetchPage(
  rawUrl: string,
  opts: { signal?: AbortSignal; maxChars?: number },
  config: PageFetchConfig,
): Promise<FetchedPage> {
  const maxChars = clampChars(opts.maxChars);
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let host = "";
  try {
    let current = checked(rawUrl, config);
    current.hash = "";
    host = current.hostname;
    let response: Response | undefined;
    for (let hop = 0; ; hop++) {
      await assertPublicHost(current.hostname, config);
      const res = await config.fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "user-agent": config.userAgent,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
          "accept-language": "en-GB,en;q=0.9",
        },
      });
      if (!REDIRECT_STATUSES.has(res.status)) {
        response = res;
        break;
      }
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location)
        throw new WebFetchError(`The page answered ${res.status} without saying where to go.`, res.status);
      if (hop >= config.maxRedirects) {
        throw new WebFetchError(
          `The page redirected more than ${config.maxRedirects} times, so Steward stopped following it.`,
        );
      }
      current = checked(new URL(location, current).toString(), config);
      current.hash = "";
      host = current.hostname;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new WebFetchError(
        `The page answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        response.status,
      );
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const kind = kindOf(contentType);
    if (kind === "binary") {
      await response.body?.cancel().catch(() => {});
      const type = contentType.split(";")[0]?.trim() || "file";
      throw new WebFetchError(`That address is a ${type} file, which Steward can't read as text.`);
    }

    const { bytes, capped } = await readCapped(response, config.maxBytes);
    const charset = charsetOf(contentType, bytes);
    const decoded = decode(bytes, charset);
    const isHtml =
      kind === "html" ||
      (kind === "unknown" && /^\s*(?:<!doctype html|<html\b|<head\b|<body\b)/i.test(decoded));
    const finalUrl = current.toString();

    let title: string;
    let text: string;
    let truncated = capped;
    if (isHtml) {
      // Only maxChars are kept, so the page is converted only that far.
      const page = htmlToText(decoded, { baseUrl: finalUrl, maxChars });
      ({ title, text } = page);
      truncated ||= page.truncated;
    } else {
      title = "";
      text = decoded.replace(/\r\n/g, "\n").trim();
    }
    if (!title) title = fallbackTitle(current);

    const cut = cutText(text, maxChars);
    return { url: finalUrl, title, text: cut.text, truncated: truncated || cut.truncated };
  } catch (err) {
    if (timeout.aborted && !opts.signal?.aborted) {
      throw new WebFetchError(
        `The page took longer than ${Math.round(config.timeoutMs / 1000)} seconds to answer.`,
      );
    }
    if (err instanceof WebFetchError || err instanceof BlockedAddressError || opts.signal?.aborted) throw err;
    throw new WebFetchError(networkMessage(err, host));
  }
}

/** A connection failure as one plain sentence. */
function networkMessage(err: unknown, host: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("Couldn't")) return message;
  const cause = (err as { cause?: { code?: unknown } }).cause;
  const code = String((err as { code?: unknown }).code ?? cause?.code ?? "");
  if (code === "ECONNREFUSED") return `${host} refused the connection.`;
  if (code === "ECONNRESET" || code === "EPIPE") return `${host} closed the connection before answering.`;
  if (code === "ETIMEDOUT") return `${host} didn't answer in time.`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return `Couldn't find a website at ${host}. Check the address.`;
  if (/CERT|SELF_SIGNED|TLS|SSL/.test(code)) {
    return `${host}'s security certificate isn't valid, so Steward didn't read the page.`;
  }
  return `Couldn't load ${host || "the page"}: ${message}`;
}

function checked(raw: string, policy: HostPolicy): URL {
  const verdict = checkWebAddress(raw, policy);
  if (!verdict.ok) throw verdict.error;
  return verdict.url;
}

function clampChars(maxChars: number | undefined): number {
  if (maxChars === undefined || !Number.isFinite(maxChars)) return DEFAULT_MAX_CHARS;
  return Math.min(200_000, Math.max(200, Math.floor(maxChars)));
}

type BodyKind = "html" | "text" | "binary" | "unknown";

function kindOf(contentType: string): BodyKind {
  const type = contentType.split(";")[0]?.trim() ?? "";
  if (type === "") return "unknown";
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type.startsWith("text/")) return "text";
  if (/^application\/(?:[\w.+-]+\+)?(?:json|xml)$/.test(type) || type === "application/javascript")
    return "text";
  if (type === "application/octet-stream") return "unknown";
  return "binary";
}

/** Reads at most `maxBytes` of the body and cancels the rest, so a huge page cannot fill memory. */
export async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; capped: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), capped: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let capped = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      capped = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, capped };
}

function charsetOf(contentType: string, bytes: Uint8Array): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  return /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ?? "utf-8";
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function fallbackTitle(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).at(-1);
  return last ? decodeURIComponentSafe(last) : url.hostname;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
export function cutText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return { text: text.slice(0, end), truncated: true };
}
