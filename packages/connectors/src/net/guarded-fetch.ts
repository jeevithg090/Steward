import type { LookupAddress, LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { pipeline, Readable } from "node:stream";
import zlib from "node:zlib";
import { assertPublicHost, BlockedAddressError, checkWebAddress, type HostPolicy } from "./address.ts";

/** The `fetch` shape Steward passes around: WHATWG in, WHATWG out. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A `fetch` that can only reach addresses the host policy allows, and that connects to exactly the
 * addresses it checked.
 *
 * Checking a name and then handing the URL to the global `fetch` leaves a gap: the second DNS lookup,
 * inside `fetch`, can answer differently (DNS rebinding with a zero TTL). Here the check runs inside
 * the socket's own `lookup`, so the address that was judged is the address that is dialled. Literal
 * IP hosts skip DNS and are judged by {@link checkWebAddress} up front.
 *
 * It never follows redirects (the caller re-checks each hop) and it decodes gzip, deflate and brotli
 * bodies so callers can cap the decoded size, which is what a zip bomb inflates.
 */
export function createGuardedFetch(policy: HostPolicy = {}): FetchLike {
  return async (input, init = {}) => {
    const request = input instanceof Request ? input : undefined;
    const verdict = checkWebAddress(input instanceof Request ? input.url : input, policy);
    if (!verdict.ok) throw verdict.error;
    const url = verdict.url;

    const method = (init.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(request?.headers);
    for (const [k, v] of new Headers(init.headers)) headers.set(k, v);
    const body = await bodyBytes(init.body ?? (request ? await request.arrayBuffer() : undefined));
    if (body && !headers.has("content-length")) headers.set("content-length", String(body.byteLength));
    const signal = init.signal ?? request?.signal ?? undefined;
    signal?.throwIfAborted();

    const transport = url.protocol === "https:" ? https : http;
    return new Promise<Response>((resolve, reject) => {
      const req = transport.request(
        url,
        {
          method,
          headers: Object.fromEntries(headers),
          // A fresh agent per request: no pooled socket opened by someone else's lookup is ever reused.
          agent: false,
          lookup: guardedLookup(policy),
          signal,
        },
        (res) => resolve(toResponse(res, method)),
      );
      req.on("error", (err) => reject(unwrapLookupError(err)));
      if (body) req.end(Buffer.from(body));
      else req.end();
    });
  };
}

/** `net`'s lookup hook, judging every address before the socket connects to it. */
function guardedLookup(policy: HostPolicy) {
  return (
    hostname: string,
    options: LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    assertPublicHost(hostname, policy).then(
      (addresses) => {
        const wanted = options.family === 4 || options.family === 6 ? options.family : undefined;
        const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
        if (options.all) return callback(null, usable);
        const first = usable[0];
        if (!first)
          return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }), "");
        callback(null, first.address, first.family);
      },
      (err: Error) => callback(err as NodeJS.ErrnoException, ""),
    );
  };
}

/** Node wraps lookup failures; surface our own refusal unchanged so callers can tell it apart. */
function unwrapLookupError(err: unknown): unknown {
  if (err instanceof BlockedAddressError) return err;
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof BlockedAddressError) return cause;
  return err;
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function toResponse(res: http.IncomingMessage, method: string): Response {
  const status = res.statusCode ?? 502;
  const headers = new Headers();
  for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
    headers.append(res.rawHeaders[i] as string, res.rawHeaders[i + 1] as string);
  }
  if (method === "HEAD" || NULL_BODY_STATUSES.has(status)) {
    res.resume();
    return new Response(null, { status, statusText: res.statusMessage ?? "", headers });
  }
  let stream: Readable = res;
  const encoding = (headers.get("content-encoding") ?? "").trim().toLowerCase();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? zlib.createGunzip()
      : encoding === "deflate"
        ? zlib.createInflate()
        : encoding === "br"
          ? zlib.createBrotliDecompress()
          : undefined;
  if (decoder) {
    pipeline(res, decoder, () => {
      // Errors surface through `decoder`, which the web stream reads.
    });
    stream = decoder;
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  const web = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(web, { status, statusText: res.statusMessage ?? "", headers });
}

async function bodyBytes(body: BodyInit | ArrayBuffer | null | undefined): Promise<Uint8Array | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  // Blob, FormData and streams: let the platform serialise them.
  return new Uint8Array(await new Response(body).arrayBuffer());
}
