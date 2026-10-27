import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLOCKED_HEADER, startEgressProxy } from "../src/egress.ts";
import { HostPolicy } from "../src/network.ts";

let target: Server;
let targetPort = 0;

beforeAll(async () => {
  target = createServer((req, res) => {
    res.setHeader("content-type", "text/plain");
    res.end(`hello from ${req.headers.host} ${req.url}`);
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const address = target.address();
  targetPort = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

function viaProxy(
  proxyPort: number,
  url: string,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { host: "127.0.0.1", port: proxyPort, path: url, headers: { host: u.host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function tunnel(proxyPort: number, authority: string, send?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    let data = "";
    let sent = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      data += chunk;
      if (!sent && send && data.includes("\r\n\r\n") && data.startsWith("HTTP/1.1 200")) {
        sent = true;
        socket.write(send);
      }
    });
    socket.on("end", () => resolve(data));
    socket.on("close", () => resolve(data));
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      resolve(data);
    }, 1500);
  });
}

describe("egress proxy", () => {
  it("forwards allowed plain HTTP and refuses metadata with a marked page", async () => {
    const blocked: string[] = [];
    const proxy = await startEgressProxy({
      policy: new HostPolicy({ allowPrivateHosts: true }),
      onBlocked: (b) => blocked.push(b.host),
    });
    try {
      const ok = await viaProxy(proxy.port, `http://127.0.0.1:${targetPort}/ok?x=1`);
      expect(ok.status).toBe(200);
      expect(ok.body).toBe(`hello from 127.0.0.1:${targetPort} /ok?x=1`);

      const meta = await viaProxy(proxy.port, "http://169.254.169.254/latest/meta-data/");
      expect(meta.status).toBe(403);
      expect(meta.headers[BLOCKED_HEADER]).toBe("metadata");
      expect(meta.body).toContain("cloud metadata");
      expect(blocked).toEqual(["169.254.169.254"]);
    } finally {
      await proxy.close();
    }
  });

  it("refuses private hosts unless allowed, for plain HTTP and tunnels alike", async () => {
    const proxy = await startEgressProxy({ policy: new HostPolicy({ allowPrivateHosts: false }) });
    try {
      const plain = await viaProxy(proxy.port, `http://127.0.0.1:${targetPort}/`);
      expect(plain.status).toBe(403);
      expect(plain.headers[BLOCKED_HEADER]).toBe("private");
      const reply = await tunnel(proxy.port, `127.0.0.1:${targetPort}`);
      expect(reply).toMatch(/^HTTP\/1.1 403/);
    } finally {
      await proxy.close();
    }
  });

  it("tunnels allowed CONNECTs and pins them to the checked address", async () => {
    // "pinned.test" resolves to loopback only through the policy's own lookup: the proxy must
    // connect to that answer, not ask the system resolver again.
    const policy = new HostPolicy({
      allowPrivateHosts: true,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    const proxy = await startEgressProxy({ policy });
    try {
      const raw = await tunnel(
        proxy.port,
        `pinned.test:${targetPort}`,
        `GET /tunnelled HTTP/1.1\r\nHost: pinned.test\r\nConnection: close\r\n\r\n`,
      );
      expect(raw).toMatch(/^HTTP\/1.1 200 Connection Established/);
      expect(raw).toContain("hello from pinned.test /tunnelled");
      const plain = await viaProxy(proxy.port, `http://pinned.test:${targetPort}/plain`);
      expect(plain.body).toBe(`hello from pinned.test:${targetPort} /plain`);
    } finally {
      await proxy.close();
    }
  });
});
