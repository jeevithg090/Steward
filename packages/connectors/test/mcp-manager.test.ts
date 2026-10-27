import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Db, fromJson, memoryDb } from "@steward/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createMcpManager,
  McpCallError,
  type McpManagerOptions,
  objectSchema,
  scrubbedEnv,
} from "../src/mcp/manager.ts";
import { migrations } from "../src/migrations.ts";
import { BlockedAddressError } from "../src/net/address.ts";

/** A notes server with a read, a write, a destructive tool, a failing tool and a slow one. */
function notesServer(): McpServer {
  const server = new McpServer({ name: "notes", version: "1.0.0" });
  server.registerTool(
    "search_notes",
    {
      description: "Finds notes that mention the words.",
      inputSchema: { query: z.string(), limit: z.number().optional() },
    },
    async ({ query }) => ({ content: [{ type: "text", text: `Found 2 notes about ${query}.` }] }),
  );
  server.registerTool(
    "create_note",
    { description: "Saves a new note.", inputSchema: { title: z.string(), body: z.string() } },
    async ({ title }) => ({ content: [{ type: "text", text: `Saved "${title}".` }] }),
  );
  server.registerTool(
    "delete_note",
    {
      description: "Deletes a note.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true, readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: "Deleted." }] }),
  );
  server.registerTool("missing_note", { description: "Always fails." }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Note not found." }],
  }));
  server.registerTool(
    "count_notes",
    { description: "Counts notes.", outputSchema: { count: z.number() } },
    async () => ({ content: [], structuredContent: { count: 42 } }),
  );
  server.registerTool("slow", { description: "Takes its time." }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return { content: [{ type: "text", text: "Finally." }] };
  });
  server.registerTool("export.all", { description: "A name models can't call." }, async () => ({
    content: [{ type: "text", text: "x" }],
  }));
  return server;
}

const NOTES = {
  id: "notes",
  name: "Notes",
  transport: "stdio" as const,
  command: "notes-server",
  args: [],
  granted: [
    "search_notes",
    "create_note",
    "delete_note",
    "missing_note",
    "count_notes",
    "slow",
    "export.all",
  ],
  reads: ["search_notes", "delete_note", "count_notes"],
};

/** Hands the manager one end of an in-memory pair per connection, and keeps the server ends. */
function inMemory() {
  const servers: { server: McpServer; transport: InMemoryTransport }[] = [];
  const createTransport = async (): Promise<InMemoryTransport> => {
    const [client, serverEnd] = InMemoryTransport.createLinkedPair();
    const server = notesServer();
    await server.connect(serverEnd);
    servers.push({ server, transport: serverEnd });
    return client;
  };
  return { createTransport, servers };
}

let db: Db;
const managers: { closeAll(): Promise<void> }[] = [];
function manager(opts: Partial<McpManagerOptions> = {}) {
  const m = createMcpManager({ db, ...opts });
  managers.push(m);
  return m;
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.closeAll()));
});

describe("MCP manager with an in-process server", () => {
  beforeAll(() => {
    db = memoryDb(migrations);
  });
  afterEach(() => {
    db.run("DELETE FROM connectors_mcp_servers");
  });

  it("connects on upsert and lists tools with grants and kinds, failing closed", async () => {
    const mem = inMemory();
    const mcp = manager({ createTransport: mem.createTransport });
    const info = await mcp.upsert({ ...NOTES, granted: ["search_notes", "delete_note"] });
    expect(info.status).toBe("connected");
    const tools = Object.fromEntries(info.tools.map((t) => [t.name, t]));
    expect(tools.search_notes).toMatchObject({
      granted: true,
      kind: "read",
      description: "Finds notes that mention the words.",
    });
    expect(tools.create_note).toMatchObject({ granted: false, kind: "write" });
    // Listed as a read by the person, but the server says it destroys: a write. readOnlyHint is ignored.
    expect(tools.delete_note).toMatchObject({ granted: true, kind: "write" });
    expect(mcp.list()).toEqual([info]);
  });

  it("keeps the config and the last listing in its own table", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert(NOTES);
    const row = db.get<{ name: string; granted_json: string; tools_json: string; last_error: string | null }>(
      "SELECT * FROM connectors_mcp_servers WHERE id = 'notes'",
    );
    expect(row?.name).toBe("Notes");
    expect(fromJson<string[]>(row?.granted_json, [])).toEqual(NOTES.granted);
    expect(fromJson<{ name: string }[]>(row?.tools_json, []).map((t) => t.name)).toContain("search_notes");
    expect(row?.last_error).toBeNull();
  });

  it("offers granted tools to the model as mcp__<server>__<tool> with an object schema", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert({ ...NOTES, granted: ["search_notes", "export.all"] });
    const tools = mcp.grantedTools("steward");
    expect(tools.map((t) => t.name)).toEqual(["mcp__notes__search_notes"]);
    const [search] = tools;
    expect(search).toMatchObject({ server: "notes", tool: "search_notes", kind: "read" });
    expect(search?.description).toMatch(
      /^Finds notes that mention the words\.\n\nFrom the MCP server "Notes"\.$/,
    );
    expect(search?.parameters).toMatchObject({
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    });
    expect(search?.parameters).not.toHaveProperty("$schema");
  });

  it("calls a granted tool and returns its text", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert(NOTES);
    await expect(mcp.call("notes", "search_notes", { query: "boiler" })).resolves.toEqual({
      text: "Found 2 notes about boiler.",
      truncated: false,
    });
  });

  it("returns structured content as JSON text when that is all the tool sent", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert(NOTES);
    const out = await mcp.call("notes", "count_notes", {});
    expect(JSON.parse(out.text)).toEqual({ count: 42 });
    expect(out.structured).toEqual({ count: 42 });
  });

  it("refuses tools that are not granted, unknown tools and unknown servers", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert({ ...NOTES, granted: ["search_notes", "no_such_tool"] });
    await expect(mcp.call("notes", "create_note", { title: "x", body: "y" })).rejects.toThrow(
      /isn't granted/,
    );
    await expect(mcp.call("notes", "no_such_tool", {})).rejects.toThrow(
      /doesn't offer a tool called "no_such_tool"/,
    );
    await expect(mcp.call("elsewhere", "search_notes", {})).rejects.toThrow(
      /no MCP server called "elsewhere"/,
    );
  });

  it("turns a tool's own error into a failed call", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert(NOTES);
    const err = await mcp.call("notes", "missing_note", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpCallError);
    expect((err as Error).message).toBe("Notes reported an error: Note not found.");
  });

  it("gives up on a call after the timeout", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport, callTimeoutMs: 100 });
    await mcp.upsert(NOTES);
    await expect(mcp.call("notes", "slow", {})).rejects.toThrow("Notes didn't answer in time.");
  });

  it("changes grants without restarting the server", async () => {
    const mem = inMemory();
    const mcp = manager({ createTransport: mem.createTransport });
    await mcp.upsert({ ...NOTES, granted: [] });
    expect(mcp.grantedTools("steward")).toEqual([]);
    await mcp.upsert({ ...NOTES, name: "My notes", granted: ["create_note"] });
    expect(mem.servers).toHaveLength(1);
    expect(mcp.grantedTools("steward").map((t) => t.name)).toEqual(["mcp__notes__create_note"]);
    expect(mcp.list()[0]?.name).toBe("My notes");
  });

  it("connects the new config when it changes while an older connect is still in flight", async () => {
    const mem = inMemory();
    const seen: string[][] = [];
    const mcp = manager({
      createTransport: async (config) => {
        seen.push(config.args);
        if (config.args[0] === "--slow") await new Promise((resolve) => setTimeout(resolve, 50));
        return mem.createTransport();
      },
    });
    const first = mcp.upsert({ ...NOTES, args: ["--slow"] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await mcp.upsert({ ...NOTES, args: ["--fast"] });
    await first;
    expect(second.status).toBe("connected");
    expect(seen).toEqual([["--slow"], ["--fast"]]);
    expect(mcp.list()[0]?.status).toBe("connected");
    await expect(mcp.call("notes", "search_notes", { query: "x" })).resolves.toMatchObject({
      truncated: false,
    });
  });

  it("reconnects on the next call after the server goes away", async () => {
    const mem = inMemory();
    const mcp = manager({ createTransport: mem.createTransport });
    await mcp.upsert(NOTES);
    await mem.servers[0]?.server.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mcp.list()[0]).toMatchObject({
      status: "error",
      error: expect.stringMatching(/reconnects on the next call/),
    });
    await expect(mcp.call("notes", "search_notes", { query: "rent" })).resolves.toMatchObject({
      text: "Found 2 notes about rent.",
    });
    expect(mem.servers).toHaveLength(2);
    expect(mcp.list()[0]?.status).toBe("connected");
  });

  it("connects saved servers at start, and can offer cached tools before connecting", async () => {
    await manager({ createTransport: inMemory().createTransport }).upsert(NOTES);

    const restarted = manager({ createTransport: inMemory().createTransport });
    expect(restarted.list()[0]).toMatchObject({ status: "connecting" });
    await restarted.ready();
    expect(restarted.list()[0]?.status).toBe("connected");

    const mem = inMemory();
    const lazy = manager({ createTransport: mem.createTransport, connectOnStart: false });
    expect(lazy.grantedTools("steward").map((t) => t.tool)).toContain("search_notes");
    expect(mem.servers).toHaveLength(0);
    await expect(lazy.call("notes", "search_notes", { query: "x" })).resolves.toMatchObject({
      truncated: false,
    });
    expect(mem.servers).toHaveLength(1);
  });

  it("removes a server for good", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert(NOTES);
    await mcp.remove("notes");
    expect(mcp.list()).toEqual([]);
    expect(db.get("SELECT id FROM connectors_mcp_servers WHERE id = 'notes'")).toBeUndefined();
    await expect(mcp.call("notes", "search_notes", {})).rejects.toThrow(/no MCP server/);
  });

  it("refuses calls after closeAll", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await mcp.upsert(NOTES);
    await mcp.closeAll();
    await expect(mcp.call("notes", "search_notes", {})).rejects.toThrow("MCP connections are closed.");
  });

  it("validates configs with plain messages", async () => {
    const mcp = manager({ createTransport: inMemory().createTransport });
    await expect(mcp.upsert({ ...NOTES, id: "Bad Id" })).rejects.toThrow(/lower-case letters/);
    await expect(mcp.upsert({ ...NOTES, command: "" })).rejects.toThrow(/needs the program to run/);
    await expect(mcp.upsert({ ...NOTES, command: "npx -y @scope/server" })).rejects.toThrow(
      /each argument separately/,
    );
    await expect(mcp.upsert({ ...NOTES, transport: "http", command: undefined })).rejects.toThrow(
      /needs its address/,
    );
    expect(mcp.list()).toEqual([]);
  });
});

describe("MCP manager: http address checks", () => {
  beforeAll(() => {
    db = memoryDb(migrations);
  });

  it.each(["http://127.0.0.1:9000/mcp", "http://localhost:9000/mcp", "http://10.0.0.5/mcp"])(
    "refuses the private address %s unless private hosts are allowed",
    async (url) => {
      const mcp = manager();
      await expect(mcp.upsert({ ...NOTES, transport: "http", url })).rejects.toBeInstanceOf(
        BlockedAddressError,
      );
      expect(mcp.list()).toEqual([]);
    },
  );

  it("never allows a metadata address", async () => {
    const mcp = manager({ allowPrivateHosts: true });
    await expect(
      mcp.upsert({ ...NOTES, transport: "http", url: "http://169.254.169.254/latest/meta-data" }),
    ).rejects.toThrow(/metadata/);
  });

  it("refuses a public name that resolves privately", async () => {
    const mcp = manager({ lookup: async () => [{ address: "192.168.1.20", family: 4 }] });
    await expect(
      mcp.upsert({ ...NOTES, transport: "http", url: "https://mcp.example.com/mcp" }),
    ).rejects.toThrow(/private network/);
  });
});

describe("MCP manager over real transports", () => {
  beforeAll(() => {
    db = memoryDb(migrations);
  });

  it("starts a stdio server without a shell, in the home folder, with a scrubbed environment", async () => {
    process.env.STEWARD_TEST_SECRET = "do-not-leak";
    try {
      const mcp = manager();
      const fixture = fileURLToPath(new URL("./fixtures/stdio-server.ts", import.meta.url));
      const info = await mcp.upsert({
        id: "fixture",
        name: "Fixture",
        transport: "stdio",
        command: process.execPath,
        args: [fixture],
        granted: ["env_keys", "cwd", "echo"],
        reads: ["env_keys", "cwd", "echo"],
      });
      expect(info.status).toBe("connected");
      const keys = JSON.parse((await mcp.call("fixture", "env_keys", {})).text) as string[];
      expect(keys).toContain("PATH");
      expect(keys).not.toContain("STEWARD_TEST_SECRET");
      const allowed = new Set(["PATH", "HOME", "LANG", "TERM", "USER", "LOGNAME", "SHELL"]);
      // macOS adds __CF_USER_TEXT_ENCODING to every process itself.
      expect(keys.filter((k) => !allowed.has(k) && !k.startsWith("__CF_"))).toEqual([]);
      expect((await mcp.call("fixture", "cwd", {})).text).toBe(homedir());
      expect((await mcp.call("fixture", "echo", { text: "a; rm -rf / $(whoami)" })).text).toBe(
        "a; rm -rf / $(whoami)",
      );
    } finally {
      delete process.env.STEWARD_TEST_SECRET;
    }
  });

  it("explains a program that cannot be found", async () => {
    const mcp = manager();
    const info = await mcp.upsert({
      id: "ghost",
      name: "Ghost",
      transport: "stdio",
      command: "steward-no-such-program-anywhere",
      args: [],
      granted: [],
      reads: [],
    });
    expect(info.status).toBe("error");
    expect(info.error).toMatch(/wasn't found/);
    const row = db.get<{ last_error: string }>(
      "SELECT last_error FROM connectors_mcp_servers WHERE id = 'ghost'",
    );
    expect(row?.last_error).toMatch(/wasn't found/);
  });

  describe("streamable http", () => {
    let url: string;
    let close: () => Promise<void>;

    beforeAll(async () => {
      const server = serve({
        fetch: async (req) => {
          // Stateless: a fresh server and transport per request, as the SDK recommends for this mode.
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          await notesServer().connect(transport);
          return transport.handleRequest(req);
        },
        hostname: "127.0.0.1",
        port: 0,
      });
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
      close = () => new Promise<void>((resolve) => server.close(() => resolve()));
    });
    afterAll(() => close());

    it("connects and calls tools through the guarded fetch when private hosts are allowed", async () => {
      const mcp = manager({ allowPrivateHosts: true });
      const info = await mcp.upsert({ ...NOTES, id: "remote", transport: "http", url, command: undefined });
      expect(info.status).toBe("connected");
      await expect(mcp.call("remote", "search_notes", { query: "invoices" })).resolves.toMatchObject({
        text: "Found 2 notes about invoices.",
      });
    });
  });

  describe("streamable http with sessions", () => {
    /**
     * A stateful server, the SDK's default: sessions live in its memory, so a restart forgets them and
     * it answers the old session id with 404 (the spec) or 400 (the SDK's example servers).
     */
    async function listen(fetch: (req: Request) => Promise<Response>, port = 0) {
      const server = serve({ fetch, hostname: "127.0.0.1", port }) as Server;
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const bound = (server.address() as AddressInfo).port;
      return {
        port: bound,
        url: `http://127.0.0.1:${bound}/mcp`,
        stop: () =>
          new Promise<void>((resolve) => {
            // The client holds a standing event stream open; drop it so the port frees at once.
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      };
    }

    async function sessionServer(port = 0, unknownSession: 400 | 404 = 404) {
      const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
      return listen(async (req) => {
        const id = req.headers.get("mcp-session-id");
        if (id) {
          const known = sessions.get(id);
          if (known) return known.handleRequest(req);
          const error = { code: -32001, message: "Session not found" };
          return Response.json({ jsonrpc: "2.0", error, id: null }, { status: unknownSession });
        }
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport);
          },
        });
        await notesServer().connect(transport);
        return transport.handleRequest(req);
      }, port);
    }

    const remote = (mcp: { list(): { id: string }[] }) => mcp.list().find((s) => s.id === "remote");

    let running: { stop(): Promise<void> } | undefined;
    beforeEach(() => {
      db.run("DELETE FROM connectors_mcp_servers");
    });
    afterEach(async () => {
      await running?.stop();
      running = undefined;
    });

    it.each([404, 400] as const)(
      "starts a fresh session when the server restarts and answers the old one with %i",
      async (status) => {
        const first = await sessionServer(0, status);
        running = first;
        const mcp = manager({ allowPrivateHosts: true });
        await mcp.upsert({ ...NOTES, id: "remote", transport: "http", url: first.url, command: undefined });
        await expect(mcp.call("remote", "search_notes", { query: "rent" })).resolves.toMatchObject({
          text: "Found 2 notes about rent.",
        });

        await first.stop();
        running = await sessionServer(first.port, status);
        // The server never ran the call on the forgotten session, so it is retried once on a new one.
        await expect(mcp.call("remote", "search_notes", { query: "gas" })).resolves.toMatchObject({
          text: "Found 2 notes about gas.",
        });
        expect(remote(mcp)).toMatchObject({ status: "connected" });
      },
    );

    it("shows an http server as down when it stops answering, and reconnects when it is back", async () => {
      const first = await sessionServer();
      running = first;
      const mcp = manager({ allowPrivateHosts: true });
      await mcp.upsert({ ...NOTES, id: "remote", transport: "http", url: first.url, command: undefined });

      await first.stop();
      running = undefined;
      const err = await mcp.call("remote", "search_notes", { query: "rent" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(McpCallError);
      expect((err as Error).message).toBe(
        "The connection to Notes failed (ECONNREFUSED). It reconnects on the next call.",
      );
      expect(remote(mcp)).toMatchObject({ status: "error", error: (err as Error).message });

      running = await sessionServer(first.port);
      await expect(mcp.call("remote", "search_notes", { query: "rent" })).resolves.toMatchObject({
        text: "Found 2 notes about rent.",
      });
      expect(remote(mcp)).toMatchObject({ status: "connected" });
    });

    it("does not retry a call the server failed for any other reason", async () => {
      let failing = false;
      let posts = 0;
      const server = await sessionServer();
      running = server;
      const flaky = await listen(async (req) => {
        if (req.method === "POST" && failing) {
          posts++;
          return new Response("boom", { status: 500 });
        }
        // Healthy for the handshake: pass it through to the real server.
        return fetch(new Request(server.url, req));
      });
      running = { stop: () => Promise.all([server.stop(), flaky.stop()]).then(() => {}) };
      const mcp = manager({ allowPrivateHosts: true });
      await mcp.upsert({ ...NOTES, id: "remote", transport: "http", url: flaky.url, command: undefined });
      failing = true;
      await expect(mcp.call("remote", "create_note", { title: "x", body: "y" })).rejects.toThrow(
        "Notes answered 500.",
      );
      expect(posts).toBe(1);
      expect(remote(mcp)).toMatchObject({ status: "connected" });
    });
  });
});

describe("helpers", () => {
  it("scrubs the environment down to four names", () => {
    expect(
      scrubbedEnv({
        PATH: "/bin",
        HOME: "/h",
        LANG: "en_GB.UTF-8",
        TERM: "xterm",
        OPENAI_API_KEY: "sk-x",
        X: "()",
      }),
    ).toEqual({
      PATH: "/bin",
      HOME: "/h",
      LANG: "en_GB.UTF-8",
      TERM: "xterm",
    });
  });

  it("always gives tool parameters an object root", () => {
    expect(objectSchema(undefined)).toEqual({ type: "object", properties: {} });
    expect(objectSchema({ type: "string" })).toEqual({ type: "object", properties: {} });
    expect(objectSchema({ $schema: "x", type: "object" })).toEqual({ type: "object", properties: {} });
    expect(objectSchema({ type: "object", properties: { a: { type: "string" } }, required: ["a"] })).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });
  });
});
