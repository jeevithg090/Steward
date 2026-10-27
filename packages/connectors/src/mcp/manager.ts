import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { type Db, fromJson, toJson } from "@steward/db";
import { type McpManager, type McpServerInfo, type McpToolDefinition, mcpToolName } from "@steward/shared";
import { migrations } from "../migrations.ts";
import { assertPublicHost, checkWebAddress, type LookupFn } from "../net/address.ts";
import { createGuardedFetch } from "../net/guarded-fetch.ts";
import { type McpCallOutput, resultText } from "./result.ts";

export type McpServerConfig = Parameters<McpManager["upsert"]>[0];

export interface McpManagerOptions {
  db: Db;
  /** Allow http servers on loopback and private networks (local development). Metadata stays refused. */
  allowPrivateHosts?: boolean;
  /** Builds a server's transport. Tests pass an in-memory pair; production leaves it unset. */
  createTransport?: (config: McpServerConfig) => Transport | Promise<Transport>;
  /** Replaces DNS for the http host check. */
  lookup?: LookupFn;
  /** Default 15 s, for the handshake and each tool listing. */
  connectTimeoutMs?: number;
  /** Default 60 s per tool call. */
  callTimeoutMs?: number;
  /** Connect saved servers straight away. Default true; otherwise each connects on first call. */
  connectOnStart?: boolean;
}

/** The manager, plus a way to wait for connections in flight (server start-up, tests). */
export interface StewardMcpManager extends McpManager {
  call(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal },
  ): Promise<McpCallOutput>;
  ready(): Promise<void>;
}

/** A failed call: the server could not be reached, refused, timed out, or reported an error. */
export class McpCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpCallError";
  }
}

interface ListedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The server marked it destructive. Only this hint is believed: it can only make a tool stricter. */
  destructive?: boolean;
}

interface ServerState {
  config: McpServerConfig;
  tools: ListedTool[];
  status: "connected" | "error";
  error?: string;
  client?: Client;
  connecting?: Promise<void>;
  /** The generation the connect in flight was started for. */
  connectingGeneration?: number;
  /** Bumped on every reconfigure or removal, so a slow connect for an old config is thrown away. */
  generation: number;
  stderr: string;
}

interface Row {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args_json: string;
  url: string | null;
  granted_json: string;
  reads_json: string;
  tools_json: string;
  last_error: string | null;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
/** What OpenAI-compatible providers accept as a tool name. */
const MODEL_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** The only parts of Steward's environment a stdio server sees. No keys, no tokens. */
const PASSED_ENV = ["PATH", "HOME", "LANG", "TERM"] as const;
const MAX_TOOL_PAGES = 20;
/** Socket failures that mean the server is gone, not that it refused this one call. */
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);
/** ANSI colour codes in a server's stderr, removed before it is shown. */
const TERMINAL_COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Model Context Protocol servers the person connected, kept in the database and connected for the
 * life of the process.
 *
 * - Saved servers connect at start; one that dropped reconnects on its next call.
 * - stdio servers start without a shell, in the home folder, with only PATH, HOME, LANG and TERM
 *   from Steward's environment (the SDK adds its own safe list: USER, LOGNAME, SHELL).
 * - http servers pass the same private-address checks as `web_fetch`, at save time and on every
 *   request, unless private hosts are allowed. Metadata addresses are refused always.
 * - A tool is a read only when the person listed it in `reads` and the server did not mark it
 *   destructive. Everything else is a write. A server's own `readOnlyHint` is never believed.
 * - Only granted tools are offered to the model, and `call` refuses anything not granted.
 */
export function createMcpManager(opts: McpManagerOptions): StewardMcpManager {
  const { db } = opts;
  // Idempotent: the server migrates every package at boot, and this keeps the manager safe if not.
  db.migrate(migrations);
  const connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;
  const callTimeoutMs = opts.callTimeoutMs ?? 60_000;
  const servers = new Map<string, ServerState>();
  let closed = false;

  for (const row of db.all<Row>("SELECT * FROM connectors_mcp_servers ORDER BY id")) {
    const state: ServerState = {
      config: {
        id: row.id,
        name: row.name,
        transport: row.transport,
        ...(row.command ? { command: row.command } : {}),
        args: fromJson<string[]>(row.args_json, []),
        ...(row.url ? { url: row.url } : {}),
        granted: fromJson<string[]>(row.granted_json, []),
        reads: fromJson<string[]>(row.reads_json, []),
      },
      tools: fromJson<ListedTool[]>(row.tools_json, []),
      status: "error",
      error: opts.connectOnStart === false ? "Not connected yet. It connects on first use." : "Connecting…",
      generation: 0,
      stderr: "",
    };
    servers.set(row.id, state);
    if (opts.connectOnStart !== false) void connect(state);
  }

  async function openTransport(state: ServerState): Promise<Transport> {
    const { config } = state;
    if (opts.createTransport) return opts.createTransport(config);
    if (config.transport === "stdio") {
      const transport = new StdioClientTransport({
        command: config.command as string,
        args: config.args,
        env: scrubbedEnv(),
        cwd: homedir(),
        stderr: "pipe",
      });
      transport.stderr?.on("data", (chunk: Buffer) => {
        // Kept short and only for error messages on the Connections page.
        state.stderr = (state.stderr + chunk.toString("utf8")).slice(-2000);
      });
      return transport;
    }
    const url = await checkServerUrl(config.url as string);
    return new StreamableHTTPClientTransport(url, {
      fetch: createGuardedFetch({ allowPrivateHosts: opts.allowPrivateHosts, lookup: opts.lookup }),
    });
  }

  async function checkServerUrl(raw: string): Promise<URL> {
    const verdict = checkWebAddress(raw, { allowPrivateHosts: opts.allowPrivateHosts });
    if (!verdict.ok) throw verdict.error;
    await assertPublicHost(verdict.url.hostname, {
      allowPrivateHosts: opts.allowPrivateHosts,
      lookup: opts.lookup,
    });
    return verdict.url;
  }

  function connect(state: ServerState): Promise<void> {
    if (state.connecting) {
      if (state.connectingGeneration === state.generation) return state.connecting;
      // A connect for an older config is still finishing; start this one once it has.
      return state.connecting.then(() => connect(state));
    }
    const generation = state.generation;
    state.connectingGeneration = generation;
    state.stderr = "";
    const attempt: Promise<void> = (async () => {
      let transport: Transport | undefined;
      let client: Client | undefined;
      try {
        transport = await openTransport(state);
        const c = new Client(
          { name: "steward", version: "0.1.0" },
          {
            listChanged: {
              tools: {
                autoRefresh: false,
                onChanged: () => {
                  if (state.client !== c) return;
                  listAllTools(c, connectTimeoutMs)
                    .then((tools) => {
                      if (state.client !== c) return;
                      state.tools = tools;
                      persistListing(state);
                    })
                    .catch(() => {
                      // The previous listing stays until a refresh succeeds.
                    });
                },
              },
            },
          },
        );
        client = c;
        c.onclose = () => {
          if (state.client !== c) return;
          state.client = undefined;
          state.status = "error";
          state.error = closedMessage(state);
        };
        await c.connect(transport, { timeout: connectTimeoutMs });
        const tools = await listAllTools(c, connectTimeoutMs);
        if (generation !== state.generation || closed) {
          await c.close().catch(() => {});
          return;
        }
        state.client = c;
        state.tools = tools;
        state.status = "connected";
        state.error = undefined;
        persistListing(state);
      } catch (err) {
        await (client ? client.close() : transport?.close())?.catch(() => {});
        if (generation !== state.generation) return;
        state.client = undefined;
        state.status = "error";
        state.error = plainError(err, state);
        db.run("UPDATE connectors_mcp_servers SET last_error = ?, updated_at = ? WHERE id = ?", [
          state.error,
          new Date().toISOString(),
          state.config.id,
        ]);
      }
    })().finally(() => {
      if (state.connecting === attempt) state.connecting = undefined;
    });
    state.connecting = attempt;
    return attempt;
  }

  /**
   * A failed call as the error to throw. When the connection itself is gone, the client is dropped so
   * the next call connects afresh: an http transport never reports a lost session as closed.
   */
  function failed(state: ServerState, client: Client, err: unknown): McpCallError {
    const message = plainError(err, state);
    if (lostConnection(err, client) && state.client === client) {
      state.client = undefined;
      state.status = "error";
      state.error = message;
      void client.close().catch(() => {});
    }
    return new McpCallError(message);
  }

  function persistListing(state: ServerState): void {
    const now = new Date().toISOString();
    db.run(
      "UPDATE connectors_mcp_servers SET tools_json = ?, listed_at = ?, last_error = NULL, updated_at = ? WHERE id = ?",
      [toJson(state.tools), now, now, state.config.id],
    );
  }

  async function disconnect(state: ServerState): Promise<void> {
    state.generation++;
    const client = state.client;
    state.client = undefined;
    await client?.close().catch(() => {});
  }

  function info(state: ServerState): McpServerInfo {
    const { config } = state;
    const connecting =
      state.status === "error" && (state.connecting !== undefined || state.error === "Connecting…");
    return {
      id: config.id,
      name: config.name,
      transport: config.transport,
      status: connecting ? "connecting" : state.status,
      ...(state.status === "error" && state.error && !connecting ? { error: state.error } : {}),
      ...(config.command ? { command: config.command } : {}),
      ...(config.transport === "stdio" ? { args: config.args } : {}),
      ...(config.url ? { url: config.url } : {}),
      tools: state.tools.map((t) => ({
        name: t.name,
        description: t.description,
        granted: config.granted.includes(t.name),
        kind: kindOf(config, t),
      })),
    };
  }

  return {
    list() {
      return [...servers.values()].sort((a, b) => a.config.id.localeCompare(b.config.id)).map(info);
    },

    grantedTools(_agentId) {
      // Grants are per server for now and apply to every agent; agentId is here for per-agent grants.
      const out: McpToolDefinition[] = [];
      for (const state of [...servers.values()].sort((a, b) => a.config.id.localeCompare(b.config.id))) {
        for (const tool of state.tools) {
          if (!state.config.granted.includes(tool.name)) continue;
          const name = mcpToolName(state.config.id, tool.name);
          if (!MODEL_TOOL_NAME.test(name)) continue;
          out.push({
            name,
            server: state.config.id,
            tool: tool.name,
            description: `${tool.description || tool.name}\n\nFrom the MCP server "${state.config.name}".`,
            parameters: objectSchema(tool.inputSchema),
            kind: kindOf(state.config, tool),
          });
        }
      }
      return out;
    },

    async call(server, tool, args, o = {}) {
      if (closed) throw new McpCallError("MCP connections are closed.");
      const state = servers.get(server);
      if (!state) throw new McpCallError(`There is no MCP server called "${server}".`);
      if (!state.config.granted.includes(tool)) {
        throw new McpCallError(
          `"${tool}" on ${state.config.name} isn't granted. Grant it on the Connections page first.`,
        );
      }
      if (!state.client) await connect(state);
      const client = state.client;
      if (!client) throw new McpCallError(`Couldn't reach ${state.config.name}. ${state.error ?? ""}`.trim());
      if (!state.tools.some((t) => t.name === tool)) {
        throw new McpCallError(`${state.config.name} doesn't offer a tool called "${tool}".`);
      }
      const invoke = (c: Client) =>
        c.callTool({ name: tool, arguments: args }, undefined, {
          timeout: callTimeoutMs,
          maxTotalTimeout: callTimeoutMs,
          signal: o.signal,
        });
      let result: { content?: unknown; structuredContent?: unknown; isError?: boolean; toolResult?: unknown };
      try {
        result = await invoke(client);
      } catch (err) {
        if (o.signal?.aborted) throw err;
        // A server that restarted has forgotten the session and refuses it before running anything,
        // so one retry on a fresh session cannot repeat a write. Anything else is not retried.
        const retry = sessionForgotten(err, client);
        const failure = failed(state, client, err);
        if (!retry) throw failure;
        if (!state.client) await connect(state);
        const fresh = state.client;
        if (!fresh)
          throw new McpCallError(`Couldn't reach ${state.config.name}. ${state.error ?? ""}`.trim());
        try {
          result = await invoke(fresh);
        } catch (again) {
          if (o.signal?.aborted) throw again;
          throw failed(state, fresh, again);
        }
      }
      const output =
        result.content === undefined && result.toolResult !== undefined
          ? resultText([], { toolResult: result.toolResult })
          : resultText(result.content, result.structuredContent);
      if (result.isError === true) {
        throw new McpCallError(`${state.config.name} reported an error: ${output.text.slice(0, 2000)}`);
      }
      return output;
    },

    async upsert(input) {
      if (closed) throw new Error("MCP connections are closed.");
      const config = validate(input);
      if (config.transport === "http") await checkServerUrl(config.url as string);
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO connectors_mcp_servers
           (id, name, transport, command, args_json, url, granted_json, reads_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, transport = excluded.transport, command = excluded.command,
           args_json = excluded.args_json, url = excluded.url, granted_json = excluded.granted_json,
           reads_json = excluded.reads_json, updated_at = excluded.updated_at`,
        [
          config.id,
          config.name,
          config.transport,
          config.command ?? null,
          toJson(config.args),
          config.url ?? null,
          toJson(config.granted),
          toJson(config.reads),
          now,
          now,
        ],
      );

      const existing = servers.get(config.id);
      if (existing && sameConnection(existing.config, config) && (existing.client || existing.connecting)) {
        // Grants, reads or the name changed: no reason to restart the server.
        existing.config = config;
        await existing.connecting;
        return info(existing);
      }
      if (existing) {
        await disconnect(existing);
        if (!sameConnection(existing.config, config)) existing.tools = [];
        existing.config = config;
        await connect(existing);
        return info(existing);
      }
      const state: ServerState = {
        config,
        tools: [],
        status: "error",
        error: "Connecting…",
        generation: 0,
        stderr: "",
      };
      servers.set(config.id, state);
      await connect(state);
      return info(state);
    },

    async remove(id) {
      const state = servers.get(id);
      servers.delete(id);
      db.run("DELETE FROM connectors_mcp_servers WHERE id = ?", [id]);
      if (state) await disconnect(state);
    },

    async closeAll() {
      closed = true;
      await Promise.all([...servers.values()].map(disconnect));
    },

    async ready() {
      await Promise.all([...servers.values()].map((s) => s.connecting));
    },
  };
}

/** The http session this client was using, if any. */
function sessionOf(client: Client): string | undefined {
  return client.transport?.sessionId;
}

/** The server answered as if it had never seen this session (404, or 400 as the SDK's examples do). */
function sessionForgotten(err: unknown, client: Client): boolean {
  return (
    err instanceof StreamableHTTPError &&
    (err.code === 404 || err.code === 400) &&
    sessionOf(client) !== undefined
  );
}

/** The connection is unusable, as opposed to this one call having failed. */
function lostConnection(err: unknown, client: Client): boolean {
  if (err instanceof McpError) return err.code === ErrorCode.ConnectionClosed;
  if (err instanceof StreamableHTTPError) return err.code === 404 || sessionForgotten(err, client);
  return networkFailure(err);
}

function networkFailure(err: unknown): boolean {
  return networkCode(err) !== undefined;
}

/** The socket error code behind a failed request, or undefined when it wasn't a socket failure. */
function networkCode(err: unknown): string | undefined {
  const code = codeOf(err) ?? codeOf((err as { cause?: unknown } | null)?.cause);
  if (typeof code === "string" && NETWORK_CODES.has(code)) return code;
  return err instanceof TypeError && err.message === "fetch failed" ? "fetch failed" : undefined;
}

function codeOf(err: unknown): unknown {
  return typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
}

/** Lists every tool, following pagination. */
async function listAllTools(client: Client, timeout: number): Promise<ListedTool[]> {
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const res = await client.listTools(cursor ? { cursor } : undefined, { timeout });
    tools.push(...res.tools.map(listedTool));
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

function listedTool(tool: Tool): ListedTool {
  return {
    name: tool.name,
    description: tool.description ?? tool.annotations?.title ?? "",
    inputSchema: (tool.inputSchema ?? { type: "object" }) as Record<string, unknown>,
    ...(tool.annotations?.destructiveHint === true ? { destructive: true } : {}),
  };
}

/** Read only when the person said so and the server did not say otherwise. Fail closed. */
function kindOf(config: McpServerConfig, tool: ListedTool): "read" | "write" {
  return config.reads.includes(tool.name) && !tool.destructive ? "read" : "write";
}

/** A JSON Schema whose root is an object, as every model provider requires for tool parameters. */
export function objectSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    return { type: "object", properties: {} };
  const { $schema: _drop, ...rest } = schema as Record<string, unknown>;
  if (rest.type !== "object") return { type: "object", properties: {} };
  if (!rest.properties || typeof rest.properties !== "object") rest.properties = {};
  return rest;
}

/** PATH, HOME, LANG and TERM from the given environment; nothing else. */
export function scrubbedEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSED_ENV) {
    const value = source[key];
    if (value !== undefined && !value.startsWith("()")) env[key] = value;
  }
  return env;
}

function sameConnection(a: McpServerConfig, b: McpServerConfig): boolean {
  return (
    a.transport === b.transport &&
    (a.command ?? "") === (b.command ?? "") &&
    (a.url ?? "") === (b.url ?? "") &&
    a.args.length === b.args.length &&
    a.args.every((arg, i) => arg === b.args[i])
  );
}

function validate(input: McpServerConfig): McpServerConfig {
  if (!ID_PATTERN.test(input.id)) {
    throw new Error(
      "A server id is 1 to 41 lower-case letters, digits or dashes, starting with a letter or digit.",
    );
  }
  const name = input.name?.trim();
  if (!name) throw new Error("Give the server a name.");
  const strings = (list: unknown, what: string): string[] => {
    if (!Array.isArray(list) || list.some((v) => typeof v !== "string"))
      throw new Error(`${what} must be a list of text.`);
    return list as string[];
  };
  const args = strings(input.args ?? [], "Arguments");
  if (args.some((a) => a.includes("\0"))) throw new Error("Arguments can't contain NUL characters.");
  const base = {
    id: input.id,
    name,
    granted: [...new Set(strings(input.granted ?? [], "Granted tools"))],
    reads: [...new Set(strings(input.reads ?? [], "Read tools"))],
  };

  if (input.transport === "stdio") {
    const command = input.command?.trim();
    if (!command) throw new Error("A stdio server needs the program to run, such as npx or uvx.");
    if (/[\0\r\n]/.test(command)) throw new Error("The program can't contain line breaks.");
    if (/\s/.test(command) && args.length === 0 && !existsSync(command)) {
      throw new Error(
        'Put just the program in "command" and each argument separately in "args", e.g. npx and ["-y", "@scope/server"].',
      );
    }
    return { ...base, transport: "stdio", command, args };
  }
  if (input.transport === "http") {
    if (!input.url) throw new Error("An http server needs its address, such as https://mcp.example.com/mcp.");
    return { ...base, transport: "http", url: input.url, args: [] };
  }
  throw new Error('The transport must be "stdio" or "http".');
}

function closedMessage(state: ServerState): string {
  const said = stderrHint(state);
  return `The connection to ${state.config.name} closed. It reconnects on the next call.${said}`;
}

function stderrHint(state: ServerState): string {
  const tail = state.stderr
    .replace(TERMINAL_COLOURS, "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-3)
    .join(" ")
    .slice(-300);
  return tail ? ` The server said: ${tail}` : "";
}

/** Any failure as one sentence a person can act on. */
function plainError(err: unknown, state: ServerState): string {
  const { name, command } = state.config;
  const code = codeOf(err);
  if (err instanceof McpError) {
    if (err.code === ErrorCode.RequestTimeout) return `${name} didn't answer in time.`;
    if (err.code === ErrorCode.ConnectionClosed) return closedMessage(state);
  }
  if (code === "ENOENT")
    return `Couldn't start "${command}": the program wasn't found. Check it is installed and on the PATH.`;
  if (code === "EACCES") return `Couldn't start "${command}": it isn't allowed to run.`;
  const network = networkCode(err);
  if (network) return `The connection to ${name} failed (${network}). It reconnects on the next call.`;
  if (code === 401)
    return `${name} turned the connection down (401). It needs a sign-in Steward can't do yet.`;
  if (code === 403) return `${name} refused the connection (403).`;
  if (typeof code === "number" && code >= 400) return `${name} answered ${code}.`;
  const message = err instanceof Error ? err.message : String(err);
  return `${message.slice(0, 300)}${stderrHint(state)}`;
}
