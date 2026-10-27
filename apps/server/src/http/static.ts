import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/** Paths the web app never owns: the API, the WebSocket and the demo Google server. */
const RESERVED = /^\/(?:api|ws|demo-google)(?:\/|$)/;

/** Resolves a URL path inside `root`, or `undefined` when it escapes it or is not a file. */
export function resolveStatic(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const candidate = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;
  try {
    const real = realpathSync(candidate);
    if (real !== root && !real.startsWith(root + sep)) return undefined;
    return statSync(real).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

function fileResponse(path: string, cacheForever: boolean, method: string): Response {
  const size = statSync(path).size;
  const headers = new Headers({
    "Content-Type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": String(size),
    "Cache-Control": cacheForever ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (method === "HEAD") return new Response(null, { headers });
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers });
}

/**
 * Serves the built web app (`apps/web/dist`) at `/` with a single-page-app fallback: any GET that
 * is not a file, not the API and not the WebSocket gets `index.html`. Hashed files under `/assets`
 * are cached for good; everything else is revalidated.
 */
export function serveWebApp(app: Hono, distDir: string): boolean {
  const index = join(distDir, "index.html");
  if (!existsSync(index)) return false;
  const root = realpathSync(distDir);
  app.on(["GET", "HEAD"], "*", async (c, next) => {
    const path = c.req.path;
    if (RESERVED.test(path)) return next();
    const file = resolveStatic(root, path);
    if (file) return fileResponse(file, path.startsWith("/assets/"), c.req.method);
    // Unknown files with an extension are real 404s; anything else is a route in the app.
    if (extname(path) !== "") return next();
    return fileResponse(realpathSync(index), false, c.req.method);
  });
  return true;
}
