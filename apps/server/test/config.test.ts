import { readFileSync, writeFileSync } from "node:fs";
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

  it("answers the Vite dev server and `vite preview` in development", () => {
    expect(loadConfig({}).devOrigins).toEqual(
      expect.arrayContaining([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
      ]),
    );
  });

  it("points at the bundled bot directory by default, and never posts counts unless asked", () => {
    const config = loadConfig({});
    expect(config.directoryUrl).toBe(join(REPO_ROOT, "directory", "index.json"));
    expect(config.directoryCounts).toBe(false);
    expect(loadConfig({ STEWARD_DIRECTORY_URL: "my-bots/index.json" }).directoryUrl).toBe(
      join(REPO_ROOT, "my-bots/index.json"),
    );
    expect(
      loadConfig({ STEWARD_DIRECTORY_URL: "https://bots.example/index.json", STEWARD_DIRECTORY_COUNTS: "1" }),
    ).toMatchObject({ directoryUrl: "https://bots.example/index.json", directoryCounts: true });
    expect(loadConfig({ STEWARD_DIRECTORY_URL: "http://127.0.0.1:8790/index.json" }).directoryUrl).toBe(
      "http://127.0.0.1:8790/index.json",
    );
    expect(() => loadConfig({ STEWARD_DIRECTORY_URL: "http://bots.example/index.json" })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ STEWARD_DIRECTORY_URL: "ftp://bots.example/index.json" })).toThrow(ConfigError);
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

  it("counts a blank value as unset, so `KEY=` in .env never hides STEWARD_ENV_FILE's key", () => {
    const { dir, remove } = tempDir();
    try {
      writeFileSync(join(dir, ".env"), "OPENROUTER_API_KEY=\nSTEWARD_TEST_D=\nSTEWARD_TEST_E=from-dotenv\n");
      writeFileSync(join(dir, "keys.env"), "OPENROUTER_API_KEY=sk-or-real\nSTEWARD_TEST_D=\n");
      // What Node's --env-file would already have set from .env, blank included.
      const env: NodeJS.ProcessEnv = {
        STEWARD_ENV_FILE: "keys.env",
        OPENROUTER_API_KEY: "",
        STEWARD_TEST_E: " ",
      };
      loadEnvFiles(dir, env);
      expect(env.OPENROUTER_API_KEY).toBe("sk-or-real");
      expect(env.STEWARD_TEST_D).toBe("");
      expect(env.STEWARD_TEST_E).toBe("from-dotenv");
      expect(process.env.OPENROUTER_API_KEY).not.toBe("sk-or-real");
    } finally {
      remove();
    }
  });

  it("leaves reading .env to the server in every script, not to Node's --env-file", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "apps/server/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const script of Object.values(pkg.scripts)) expect(script).not.toMatch(/--env-file/);
  });
});
