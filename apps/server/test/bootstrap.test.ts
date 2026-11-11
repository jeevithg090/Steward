import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selfAddress } from "../src/bootstrap.ts";
import { ConfigError, loadConfig } from "../src/config.ts";
import { missingPackages, tempRepo } from "./helpers.ts";
import { startTestServer } from "./server.ts";

const missing = await missingPackages();
if (missing.length > 0) it.todo(`bootstrap (waiting for ${missing.join(", ")})`);

/** Whether this machine can listen on IPv6 loopback at all. */
const ipv6 = await new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

describe("selfAddress", () => {
  const v4 = (address: string) => ({ address, family: "IPv4", port: 1 });
  const v6 = (address: string) => ({ address, family: "IPv6", port: 1 });

  it("follows the socket for loopback names and wildcards", () => {
    expect(selfAddress("127.0.0.1", v4("127.0.0.1"))).toBe("127.0.0.1");
    expect(selfAddress("localhost", v6("::1"))).toBe("[::1]");
    expect(selfAddress("localhost", v4("127.0.0.1"))).toBe("127.0.0.1");
    expect(selfAddress("::1", v6("::1"))).toBe("[::1]");
    expect(selfAddress("0.0.0.0", v4("0.0.0.0"))).toBe("127.0.0.1");
    expect(selfAddress("::", v6("::"))).toBe("[::1]");
  });

  it("keeps a name or address beyond this machine, which the host guard accepts", () => {
    expect(selfAddress("steward.lan", v4("192.168.1.5"))).toBe("steward.lan");
    expect(selfAddress("192.168.1.5", v4("192.168.1.5"))).toBe("192.168.1.5");
    expect(selfAddress("fd00::5", v6("fd00::5"))).toBe("[fd00::5]");
  });
});

describe.runIf(missing.length === 0)("createApp and listen", () => {
  it.skipIf(process.platform === "win32")(
    "keeps the data folder and the database readable by this user only",
    async () => {
      const t = await startTestServer({}, {}, ({ dataDir }) => {
        // As an older Steward left them: readable by everyone.
        mkdirSync(dataDir, { recursive: true, mode: 0o755 });
        chmodSync(dataDir, 0o755);
        writeFileSync(join(dataDir, "steward.db"), "");
        chmodSync(join(dataDir, "steward.db"), 0o644);
      });
      try {
        const { dataDir, dbPath } = t.server.services.config;
        expect(statSync(dataDir).mode & 0o777).toBe(0o700);
        expect(statSync(dbPath).mode & 0o777).toBe(0o600);
        expect(statSync(`${dbPath}-wal`).mode & 0o077).toBe(0);
      } finally {
        await t.close();
      }
    },
  );

  it.runIf(ipv6)("reaches itself on IPv6 loopback: the printed address and the demo inbox", async () => {
    const t = await startTestServer({ STEWARD_HOST: "::1" });
    try {
      expect(t.base).toMatch(/^http:\/\/\[::1\]:\d+$/);
      expect((await fetch(`${t.base}/api/health`)).status).toBe(200);
      const inbox = await t.api<unknown[]>("/api/inbox");
      expect(inbox.status).toBe(200);
      expect(inbox.body.length).toBeGreaterThan(0);
    } finally {
      await t.close();
    }
  });

  it("says what to do when the port is taken", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const port = (taken.address() as AddressInfo).port;
    const repo = tempRepo();
    const { createApp } = await import("../src/bootstrap.ts");
    const app = await createApp(
      loadConfig(
        { STEWARD_DATA_DIR: repo.dataDir, STEWARD_MODEL_PROVIDER: "scripted" },
        { tenantDir: repo.tenantDir, workers: false, webDistDir: `${repo.root}/no-web` },
      ),
    );
    try {
      const error = await app
        .listen({ port, host: "127.0.0.1", devicePort: null })
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toBe(
        `Port ${port} is already in use. Is Steward already running? Stop it, or set STEWARD_PORT to a free port.`,
      );
    } finally {
      await app.close();
      repo.remove();
      await new Promise((resolve) => taken.close(resolve));
    }
  });
});
