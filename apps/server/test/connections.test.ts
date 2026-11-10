import { createMcpManager, type McpManagerOptions } from "@steward/connectors";
import { memoryDb } from "@steward/db";
import type { McpManager } from "@steward/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { StewardServices } from "../src/context.ts";
import { onError } from "../src/http/errors.ts";
import { registerConnectionRoutes } from "../src/routes/connections.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** Just the connection routes, over a real MCP manager (or the one given). */
function app(opts: Partial<McpManagerOptions> = {}, given?: McpManager) {
  const mcp = given ?? createMcpManager({ db: memoryDb(), ...opts });
  closers.push(() => mcp.closeAll());
  const hono = new Hono();
  hono.onError(onError);
  registerConnectionRoutes(hono, { mcp, mail: () => undefined } as unknown as StewardServices);
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await hono.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { mcp, send };
}

const STDIO = { id: "github", name: "GitHub", transport: "stdio", command: "npx", args: ["-y", "x"] };

describe("the MCP connection routes", () => {
  it("passes on the manager's own sentence for a config it won't save", async () => {
    const { send } = app();
    const res = await send("POST", "/api/connections/mcp", {
      ...STDIO,
      command: "npx -y @modelcontextprotocol/server-github",
      args: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Put just the program in "command" and each argument separately/);
  });

  it("explains a private address, and a name that can't be found", async () => {
    const { send } = app({
      lookup: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    const local = await send("POST", "/api/connections/mcp", {
      id: "local",
      name: "Local",
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
    });
    expect(local.status).toBe(400);
    expect(local.body.error).toMatch(/STEWARD_ALLOW_PRIVATE_HOSTS=1/);

    const missing = await send("POST", "/api/connections/mcp", {
      id: "missing",
      name: "Missing",
      transport: "http",
      url: "https://mcp.nowhere.example/mcp",
    });
    expect(missing.status).toBe(502);
    expect(missing.body.error).toBe("Couldn't find a website at mcp.nowhere.example. Check the address.");
  });

  it("saves a server that didn't connect, and says why in its status", async () => {
    const { send } = app({
      createTransport: () => Promise.reject(Object.assign(new Error("spawn"), { code: "ENOENT" })),
    });
    const res = await send("POST", "/api/connections/mcp", STDIO);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "github",
      status: "error",
      error: expect.stringMatching(/wasn't found/),
    });
  });

  it("hands the manager every mark the person made", async () => {
    const saved: Parameters<McpManager["upsert"]>[0][] = [];
    const mcp = {
      list: () => [],
      upsert: async (config: Parameters<McpManager["upsert"]>[0]) => {
        saved.push(config);
        return {
          id: config.id,
          name: config.name,
          transport: config.transport,
          status: "connected",
          tools: [],
        };
      },
      closeAll: async () => {},
    } as unknown as McpManager;
    const { send } = app({}, mcp);
    const res = await send("POST", "/api/connections/mcp", {
      ...STDIO,
      granted: ["post", "erase", "find"],
      reads: ["find"],
      sends: ["post"],
      deletes: ["erase"],
      allowAgain: ["find"],
    });
    expect(res.status).toBe(201);
    expect(saved[0]).toMatchObject({
      granted: ["post", "erase", "find"],
      reads: ["find"],
      sends: ["post"],
      deletes: ["erase"],
      allowAgain: ["find"],
    });
  });
});
