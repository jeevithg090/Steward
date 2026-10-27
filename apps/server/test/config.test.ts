import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, DEV_ORIGINS, isLoopbackHost, loadConfig, parseFlag, REPO_ROOT } from "../src/config.ts";
import { loadEnvFiles, normaliseEnv } from "../src/env.ts";
import { tempDir } from "./helpers.ts";

describe("loadConfig", () => {
  it("has safe defaults: loopback, port 8787, data and tenant under the repo root", () => {
    const config = loadConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8787);
    expect(config.dataDir).toBe(join(REPO_ROOT, ".steward-data"));
    expect(config.dbPath).toBe(join(REPO_ROOT, ".steward-data", "steward.db"));
    expect(config.tenantDir).toBe(join(REPO_ROOT, "tenants", "steward"));
    expect(config.demoGoogle).toBe(true);
    expect(config.allowPrivateHosts).toBe(false);
    expect(config.devOrigins).toEqual(DEV_ORIGINS);
    expect(config.workers).toBe(true);
  });

  it("resolves a relative data dir from the repo root, not the working directory", () => {
    expect(loadConfig({ STEWARD_DATA_DIR: "elsewhere/data" }).dataDir).toBe(
      join(REPO_ROOT, "elsewhere/data"),
    );
    expect(loadConfig({ STEWARD_DATA_DIR: "/abs/data" }).dataDir).toBe("/abs/data");
  });

  it("reads flags, port and tenant", () => {
    const config = loadConfig({
      STEWARD_PORT: "9000",
      STEWARD_DEMO_GOOGLE: "0",
      STEWARD_HEADFUL: "yes",
      STEWARD_TENANT: "tempo",
      STEWARD_ALLOWED_HOSTS: "steward.lan, Box.Local ",
    });
    expect(config.port).toBe(9000);
    expect(config.demoGoogle).toBe(false);
    expect(config.headful).toBe(true);
    expect(config.tenantDir).toBe(join(REPO_ROOT, "tenants", "tempo"));
    expect(config.allowedHosts).toEqual(["steward.lan", "box.local"]);
  });

  it("refuses unsafe or unreadable values", () => {
    expect(() => loadConfig({ STEWARD_PORT: "eighty" })).toThrow(ConfigError);
    expect(() => loadConfig({ STEWARD_TENANT: "../etc" })).toThrow(ConfigError);
    expect(() => loadConfig({ STEWARD_ALLOW_PRIVATE_HOSTS: "1", NODE_ENV: "production" })).toThrow(/refused/);
    expect(loadConfig({ STEWARD_ALLOW_PRIVATE_HOSTS: "1" }).allowPrivateHosts).toBe(true);
    expect(loadConfig({ NODE_ENV: "production" }).devOrigins).toEqual([]);
  });

  it("parses flags leniently", () => {
    expect(parseFlag("on", false)).toBe(true);
    expect(parseFlag("OFF", true)).toBe(false);
    expect(parseFlag("maybe", true)).toBe(true);
    expect(parseFlag(undefined, false)).toBe(false);
  });

  it("knows loopback names", () => {
    for (const h of ["localhost", "app.localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ["0.0.0.0", "192.168.1.2", "example.com", "localhost.evil.com"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe("environment", () => {
  it("drops blank base URLs and switches telemetry off", () => {
    const env: NodeJS.ProcessEnv = {
      OPENAI_BASE_URL: "",
      ANTHROPIC_BASE_URL: "  ",
      STEWARD_MODEL_BASE_URL: "http://x",
    };
    normaliseEnv(env);
    expect("OPENAI_BASE_URL" in env).toBe(false);
    expect("ANTHROPIC_BASE_URL" in env).toBe(false);
    expect(env.STEWARD_MODEL_BASE_URL).toBe("http://x");
    expect(env.COPILOTKIT_TELEMETRY_DISABLED).toBe("true");
    expect(env.DO_NOT_TRACK).toBe("1");
  });

  it("loads .env files without overriding what is already set", () => {
    const { dir, remove } = tempDir();
    try {
      writeFileSync(join(dir, ".env"), "STEWARD_TEST_A=from-file\nSTEWARD_TEST_B=from-file\n");
      writeFileSync(join(dir, "keys.env"), "STEWARD_TEST_C=extra\n");
      process.env.STEWARD_TEST_A = "from-shell";
      process.env.STEWARD_ENV_FILE = "keys.env";
      const loaded = loadEnvFiles(dir, process.env);
      expect(loaded).toEqual([join(dir, "keys.env"), join(dir, ".env")]);
      expect(process.env.STEWARD_TEST_A).toBe("from-shell");
      expect(process.env.STEWARD_TEST_B).toBe("from-file");
      expect(process.env.STEWARD_TEST_C).toBe("extra");
    } finally {
      for (const k of ["STEWARD_TEST_A", "STEWARD_TEST_B", "STEWARD_TEST_C", "STEWARD_ENV_FILE"])
        delete process.env[k];
      remove();
    }
  });
});
