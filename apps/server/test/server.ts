import type { StewardServer } from "../src/bootstrap.ts";
import { loadConfig, type ServerConfig } from "../src/config.ts";
import { tempRepo } from "./helpers.ts";

export interface TestServer {
  server: StewardServer;
  base: string;
  api<T = unknown>(
    path: string,
    init?: RequestInit & { json?: unknown },
  ): Promise<{ status: number; body: T }>;
  close(): Promise<void>;
}

/**
 * Boots the whole server on a free port with a temporary data folder, an empty tenant folder (the
 * agent package's defaults apply) and the scripted model. Workers are off: tests drive them.
 */
export async function startTestServer(
  env: NodeJS.ProcessEnv = {},
  overrides: Partial<ServerConfig> = {},
): Promise<TestServer> {
  const repo = tempRepo();
  const { createApp } = await import("../src/bootstrap.ts");
  const config = loadConfig(
    { STEWARD_DATA_DIR: repo.dataDir, STEWARD_MODEL_PROVIDER: "scripted", ...env },
    {
      tenantDir: repo.tenantDir,
      workers: false,
      resumeDelayMs: 300,
      webDistDir: `${repo.root}/no-web`,
      ...overrides,
    },
  );
  const server = await createApp(config);
  const { url } = await server.listen({ port: 0 });
  return {
    server,
    base: url,
    async api(path, init = {}) {
      const { json, headers, ...rest } = init;
      const res = await fetch(`${url}${path}`, {
        ...rest,
        headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON; the caller asked for the raw text.
      }
      return { status: res.status, body: body as never };
    },
    async close() {
      await server.close();
      repo.remove();
    },
  };
}
