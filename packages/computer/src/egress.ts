/**
 * Adapted from openbot/agent-computer/src/egress.ts (MIT, CopilotKit).
 *
 * A small forward proxy on 127.0.0.1 that every request from the agent's browser goes through.
 * `context.route` (see browser.ts) is the first check and gives clear refusals, but Playwright
 * hands it only the first URL of a redirect chain, and it never sees WebSockets. The proxy sees
 * every hop: plain HTTP by absolute URL, HTTPS and WebSockets by CONNECT. It resolves each host
 * through the same policy and connects only to the addresses it checked, so a DNS answer that
 * changes between the check and the connection (DNS rebinding) goes nowhere.
 */
import {
  Agent,
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { HostPolicy, HostVerdict, ResolvedAddress } from "./network.ts";

export interface EgressProxy {
  /** `http://127.0.0.1:<port>`, for Playwright's `proxy.server`. */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface BlockedRequest {
  url: string;
  host: string;
  reason: string;
  message: string;
}

/** Response header set on every refusal, so a navigation can tell "blocked" from "the site said 403". */
export const BLOCKED_HEADER = "x-steward-blocked";

const CONNECT_TIMEOUT_MS = 10_000;
/** A forwarded request with no traffic for this long is dropped. Long enough for long polling. */
const IDLE_TIMEOUT_MS = 5 * 60_000;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function blockPage(message: string): string {
  const safe = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>Blocked by Steward</title><body style="font:16px system-ui;margin:3rem;max-width:40rem"><h1>Steward blocked this address</h1><p>${safe}</p></body>`;
}

/** Filters a raw header list (name, value, name, value…) down to end-to-end headers. */
function endToEnd(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] ?? "";
    if (!HOP_BY_HOP.has(name.toLowerCase())) out.push(name, raw[i + 1] ?? "");
  }
  return out;
}

function connectFirst(addresses: readonly ResolvedAddress[], port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let index = 0;
    const attempt = () => {
      const next = addresses[index++];
      if (!next) {
        reject(new Error("unreachable"));
        return;
      }
      const socket = connect({ host: next.address, port, family: next.family });
      let settled = false;
      const timer = setTimeout(() => socket.destroy(new Error("timeout")), CONNECT_TIMEOUT_MS);
      socket.once("connect", () => {
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      });
      // Stays attached: after the connect, the caller's own handler decides what an error means.
      socket.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        attempt();
      });
    };
    attempt();
  });
}

export async function startEgressProxy(opts: {
  policy: HostPolicy;
  onBlocked?: (blocked: BlockedRequest) => void;
}): Promise<EgressProxy> {
  const { policy } = opts;
  const sockets = new Set<Duplex>();
  const track = (s: Duplex) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  };
  const agent = new Agent({ keepAlive: true, maxSockets: 64 });

  const refuse = (url: string, verdict: Extract<HostVerdict, { ok: false }>) => {
    if (verdict.reason !== "unresolved") {
      opts.onBlocked?.({ url, host: verdict.host, reason: verdict.reason, message: verdict.message });
    }
  };

  const handleHttp = async (req: IncomingMessage, res: ServerResponse) => {
    // An unhandled stream error would take the whole server down; a broken request just ends.
    req.on("error", () => res.destroy());
    res.on("error", () => {});
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (target.protocol !== "http:") throw new Error("not http");
    } catch {
      res.writeHead(400, { "content-type": "text/plain" }).end("This proxy only forwards http:// requests.");
      return;
    }
    const verdict = await policy.checkUrl(target);
    if (!verdict.ok) {
      refuse(target.href, verdict);
      const status = verdict.reason === "unresolved" ? 502 : 403;
      res
        .writeHead(status, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...(verdict.reason === "unresolved" ? {} : { [BLOCKED_HEADER]: verdict.reason }),
        })
        .end(blockPage(verdict.message));
      return;
    }
    const address = verdict.addresses[0];
    if (!address) {
      res.writeHead(502).end();
      return;
    }
    const upstream = httpRequest(
      {
        host: address.address,
        family: address.family,
        port: target.port ? Number(target.port) : 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: endToEnd(req.rawHeaders),
        setHost: false,
        agent,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.statusMessage, endToEnd(response.rawHeaders));
        response.pipe(res);
        response.on("error", () => res.destroy());
      },
    );
    upstream.setTimeout(IDLE_TIMEOUT_MS, () => upstream.destroy(new Error("timeout")));
    // The browser gave up on this request (navigated away, closed the tab): so does the proxy.
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "text/plain" }).end("Could not reach that site.");
      else res.destroy();
    });
    req.pipe(upstream);
  };

  const handleConnect = async (req: IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    const authority = req.url ?? "";
    const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(authority);
    const port = Number(match?.[2]);
    if (!match?.[1] || !(port > 0 && port < 65536)) {
      client.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const verdict = await policy.checkHost(match[1]);
    if (!verdict.ok) {
      refuse(`https://${authority}/`, verdict);
      const status = verdict.reason === "unresolved" ? "502 Bad Gateway" : "403 Forbidden";
      client.end(`HTTP/1.1 ${status}\r\n${BLOCKED_HEADER}: ${verdict.reason}\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    let upstream: Socket;
    try {
      upstream = await connectFirst(verdict.addresses, port);
    } catch {
      client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    track(upstream);
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  };

  const server = createServer((req, res) => {
    handleHttp(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
  });
  server.on("connect", (req, socket, head) => {
    handleConnect(req, socket, head).catch(() => socket.destroy());
  });
  // A plain-HTTP upgrade through the proxy is not something Chromium sends; refuse rather than guess.
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("connection", (socket) => track(socket));
  server.on("clientError", (_err, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        agent.destroy();
        server.close(() => resolve());
      }),
  };
}
