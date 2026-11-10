import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SERVER_PORT } from "@steward/shared";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEV_ORIGINS,
  isLoopbackHost,
  loadConfig,
  parseFlag,
  REPO_ROOT,
  startupWarnings,
} from "../src/config.ts";
import { devServerTarget, loadEnvFiles, normaliseEnv } from "../src/env.ts";
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
    expect(config.devOrigins).toEqual([]);
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

  it("trusts the Vite ports' origins only with STEWARD_DEV_ORIGINS, and never in production", () => {
    expect(loadConfig({}).devOrigins).toEqual([]);
    const on = loadConfig({ STEWARD_DEV_ORIGINS: "1" });
    expect(on.devOrigins).toEqual(DEV_ORIGINS);
    expect(on.devOrigins).toEqual(
      expect.arrayContaining([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
      ]),
    );
    expect(startupWarnings(on).join(" ")).toMatch(/STEWARD_DEV_ORIGINS is on/);
    expect(startupWarnings(loadConfig({})).join(" ")).not.toMatch(/STEWARD_DEV_ORIGINS/);
    expect(() => loadConfig({ STEWARD_DEV_ORIGINS: "1", NODE_ENV: "production" })).toThrow(/refused/);
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

  it("names each flag or number it could not read, and keeps its default", () => {
    const config = loadConfig({
      STEWARD_DEMO_GOOGLE: "disabled",
      STEWARD_WORKERS: "none",
      STEWARD_HEADFUL: "yes",
      STEWARD_MODEL_MAX_TOKENS: "lots",
      STEWARD_DELEGATION_DEPTH: "3",
      STEWARD_DELEGATION_CONCURRENCY: "50",
    });
    expect(config.demoGoogle).toBe(true);
    expect(config.workers).toBe(true);
    expect(config.unreadable).toEqual([
      'STEWARD_DEMO_GOOGLE is "disabled", which is neither on nor off, so the default (on) is used.',
      'STEWARD_WORKERS is "none", which is neither on nor off, so the default (on) is used.',
      'STEWARD_MODEL_MAX_TOKENS is "lots", which is not a whole number from 256 to 65536, so the default is used.',
      'STEWARD_DELEGATION_CONCURRENCY is "50", which is not a whole number from 1 to 10, so the default is used.',
    ]);
    expect(startupWarnings(config).slice(0, 4)).toEqual(config.unreadable);
    expect(loadConfig({ STEWARD_DEMO_GOOGLE: "off", STEWARD_WORKERS: " " }).unreadable).toEqual([]);
    expect(loadConfig({ STEWARD_HEADFUL: "x".repeat(60) }).unreadable[0]).toContain(`"${"x".repeat(40)}…"`);
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

  it("points the web app's dev proxy where the server will listen, from the shell or .env", () => {
    const { dir, remove } = tempDir();
    try {
      expect(devServerTarget(dir, {})).toBe(`http://127.0.0.1:${DEFAULT_SERVER_PORT}`);
      writeFileSync(join(dir, ".env"), "STEWARD_PORT=9123\nSTEWARD_HOST=\n");
      expect(devServerTarget(dir, {})).toBe("http://127.0.0.1:9123");
      expect(devServerTarget(dir, { STEWARD_PORT: "9200" })).toBe("http://127.0.0.1:9200");
      expect(devServerTarget(dir, { STEWARD_PORT: " " })).toBe("http://127.0.0.1:9123");
      writeFileSync(join(dir, "keys.env"), "STEWARD_PORT=9300\n");
      expect(devServerTarget(dir, { STEWARD_ENV_FILE: "keys.env" })).toBe("http://127.0.0.1:9300");
      expect(devServerTarget(dir, { STEWARD_HOST: "::1" })).toBe("http://[::1]:9123");
      expect(devServerTarget(dir, { STEWARD_HOST: "0.0.0.0" })).toBe("http://127.0.0.1:9123");
      expect(devServerTarget(dir, { STEWARD_HOST: "localhost" })).toBe("http://localhost:9123");
      const env = { STEWARD_SERVER_URL: "http://127.0.0.1:8931" };
      expect(devServerTarget(dir, env)).toBe("http://127.0.0.1:8931");
      expect(env).toEqual({ STEWARD_SERVER_URL: "http://127.0.0.1:8931" });
    } finally {
      remove();
    }
  });

  it("documents every variable the server and its packages read", () => {
    const docs = readFileSync(join(REPO_ROOT, "docs/configuration.md"), "utf8");
    // Passed through to the shell and coding agents, not settings of Steward's.
    const passedThrough = new Set(["HOME", "LANG", "PATH", "RUST_LOG", "TMPDIR"]);
    const reads =
      /\benv\.([A-Z][A-Z0-9_]+)|\benv\["([A-Z][A-Z0-9_]+)"\]|keyEnv: "([A-Z0-9_]+)"|KEY_ENV = "([A-Z0-9_]+)"/g;
    const roots = [
      "apps/server/src",
      ...["agent", "computer", "connectors", "gateway", "harnesses", "proactive"].map(
        (p) => `packages/${p}/src`,
      ),
    ];
    const names = new Set<string>();
    for (const root of roots) {
      for (const file of readdirSync(join(REPO_ROOT, root), { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        for (const m of readFileSync(join(REPO_ROOT, root, file), "utf8").matchAll(reads)) {
          const name = m.slice(1).find(Boolean)!;
          if (!passedThrough.has(name)) names.add(name);
        }
      }
    }
    expect(names.size).toBeGreaterThan(25);
    expect([...names].filter((name) => !docs.includes(`\`${name}`)).sort()).toEqual([]);
  });

  it("leaves reading .env to the server in every script, not to Node's --env-file", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "apps/server/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const script of Object.values(pkg.scripts)) expect(script).not.toMatch(/--env-file/);
  });
});
