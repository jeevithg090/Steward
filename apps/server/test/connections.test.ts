import { createMcpManager, type McpManagerOptions } from "@steward/connectors";
import { memoryDb } from "@steward/db";
import type { AuditLog, McpManager, McpServerInfo, McpToolKind } from "@steward/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { StewardServices } from "../src/context.ts";
import { onError } from "../src/http/errors.ts";
import { connectionChange, registerConnectionRoutes } from "../src/routes/connections.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** Just the connection routes, over a real MCP manager (or the one given). `recorded` is the record. */
function app(opts: Partial<McpManagerOptions> = {}, given?: McpManager) {
  const mcp = given ?? createMcpManager({ db: memoryDb(), ...opts });
  closers.push(() => mcp.closeAll());
  const hono = new Hono();
  hono.onError(onError);
  const recorded: Parameters<AuditLog["append"]>[0][] = [];
  const gateway = { audit: { append: (event: Parameters<AuditLog["append"]>[0]) => recorded.push(event) } };
  registerConnectionRoutes(hono, {
    mcp,
    mail: () => undefined,
    gateway,
    actorId: "local",
  } as unknown as StewardServices);
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await hono.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { mcp, send, recorded };
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

  it("tries a server again on request, and refuses one it doesn't know", async () => {
    const reconnected: string[] = [];
    const server = { id: "github", name: "GitHub", transport: "stdio", status: "connected", tools: [] };
    const mcp = {
      list: () => [server],
      reconnect: async (id: string) => {
        reconnected.push(id);
        return server;
      },
      closeAll: async () => {},
    } as unknown as McpManager;
    const { send } = app({}, mcp);
    expect(await send("POST", "/api/connections/mcp/github/reconnect")).toEqual({
      status: 200,
      body: server,
    });
    expect(reconnected).toEqual(["github"]);
    const missing = await send("POST", "/api/connections/mcp/nowhere/reconnect");
    expect(missing.status).toBe(404);
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

  describe("the record of what the person allowed", () => {
    type Tool = McpServerInfo["tools"][number];
    const tool = (name: string, granted: boolean, kind: McpToolKind = "write"): Tool => ({
      name,
      description: "",
      granted,
      kind,
      offerable: true,
    });
    const notes = (tools: Tool[]): McpServerInfo => ({
      id: "notes",
      name: "Notes",
      transport: "stdio",
      status: "connected",
      tools,
    });

    /** A manager that holds one server: `list` shows `current`, a save turns it into `next`. */
    function holding(current: McpServerInfo | undefined, next: McpServerInfo): McpManager {
      let shown = current;
      return {
        list: () => (shown ? [shown] : []),
        upsert: async () => {
          shown = next;
          return next;
        },
        remove: async () => {
          shown = undefined;
        },
        closeAll: async () => {},
      } as unknown as McpManager;
    }
    const BODY = { id: "notes", name: "Notes", transport: "stdio", command: "notes-server" };

    it("records a new server and the tools allowed on it, with their kinds", async () => {
      const after = notes([tool("find", true, "read"), tool("post", true, "send"), tool("erase", false)]);
      const { send, recorded } = app({}, holding(undefined, after));
      expect((await send("POST", "/api/connections/mcp", BODY)).status).toBe(201);
      expect(recorded).toEqual([
        {
          type: "policy.changed",
          actorId: "local",
          detail: {
            change: "connection",
            summary:
              'Added the tool server Notes; Allowed find ("Only reads") and post ("Sends or posts") on Notes',
            server: "notes",
            allowed: ["find", "post"],
            kinds: { find: "read", post: "send" },
          },
        },
      ]);
    });

    it("records tools switched off, marked again or allowed again, and secrets by name only", async () => {
      const before = notes([tool("find", true, "write"), tool("post", true, "send"), tool("look", true)]);
      const after = notes([tool("find", true, "read"), tool("post", false, "send"), tool("look", true)]);
      const { send, recorded } = app({}, holding(before, after));
      const res = await send("PUT", "/api/connections/mcp/notes", {
        ...BODY,
        allowAgain: ["look"],
        env: { NOTES_TOKEN: "sk-live-very-secret" },
      });
      expect(res.status).toBe(200);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.detail).toEqual({
        change: "connection",
        summary:
          'Marked find as "Only reads"; Stopped allowing post; Allowed look again after its server changed what it does; Changed the secret setting NOTES_TOKEN on Notes',
        server: "notes",
        kinds: { find: "read" },
        stopped: ["post"],
        allowedAgain: ["look"],
        secretSettings: ["NOTES_TOKEN"],
      });
      expect(JSON.stringify(recorded)).not.toContain("sk-live");
    });

    it("records nothing for a save that changes none of it, and records a removal", async () => {
      const same = notes([tool("find", true, "read")]);
      const { send, recorded } = app({}, holding(same, same));
      await send("PUT", "/api/connections/mcp/notes", { ...BODY, name: "Notes" });
      expect(recorded).toEqual([]);
      expect(connectionChange(same, same, { allowAgain: [] })).toBeUndefined();
      const token = connectionChange(same, same, { allowAgain: [], bearerToken: "tok-very-secret" });
      expect(token).toEqual({
        change: "connection",
        summary: "Changed the access token on Notes",
        server: "notes",
        accessToken: "saved",
      });
      expect(connectionChange(same, same, { allowAgain: [], bearerToken: null })).toMatchObject({
        accessToken: "removed",
      });

      expect((await send("DELETE", "/api/connections/mcp/notes")).status).toBe(200);
      expect(recorded.map((r) => r.detail)).toEqual([
        { change: "connection", summary: "Removed the tool server Notes", server: "notes" },
      ]);
    });
  });
});
