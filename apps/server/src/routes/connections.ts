import { BlockedAddressError, McpConfigError, McpLookupError } from "@steward/connectors";
import {
  type ConnectionsInfo,
  McpServerBody,
  type McpServerInfo,
  type McpToolKind,
  ROUTES,
} from "@steward/shared";
import type { Hono } from "hono";
import type { z } from "zod";
import type { StewardServices } from "../context.ts";
import { HttpError, notFound, readBody } from "../http/errors.ts";
import { builtinToolList } from "../tools/catalogue.ts";

type McpBody = z.infer<typeof McpServerBody>;

function checkTransport(body: McpBody): void {
  if (body.transport === "stdio" && !body.command?.trim()) {
    throw new HttpError(400, "A local tool server needs the command that starts it.");
  }
  if (body.transport === "http" && !body.url)
    throw new HttpError(400, "A remote tool server needs its address.");
}

/** A kind as the Connections page names it. */
const KIND_WORDS: Record<McpToolKind, string> = {
  read: '"Only reads"',
  write: '"Changes things"',
  send: '"Sends or posts"',
  delete: '"Deletes things"',
};

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * What a save changed in what Steward may use on a tool server, for the record: the tools allowed
 * and with what kind (a kind decides whether a call asks), the tools no longer allowed, the ones
 * allowed again after their server changed them, and whether its secrets changed (never their
 * values). Undefined when the save changed none of these.
 */
export function connectionChange(
  before: McpServerInfo | undefined,
  after: McpServerInfo,
  body: Pick<McpBody, "allowAgain" | "env" | "bearerToken">,
): Record<string, unknown> | undefined {
  const was = new Map((before?.tools ?? []).map((t) => [t.name, t]));
  const allowed: string[] = [];
  const stopped: string[] = [];
  const again: string[] = [];
  const kinds: Record<string, McpToolKind> = {};
  for (const tool of after.tools) {
    const prev = was.get(tool.name);
    if (tool.granted && !prev?.granted) {
      allowed.push(tool.name);
      kinds[tool.name] = tool.kind;
    } else if (!tool.granted && prev?.granted) stopped.push(tool.name);
    else if (tool.granted && prev && prev.kind !== tool.kind) kinds[tool.name] = tool.kind;
    if (tool.granted && body.allowAgain.includes(tool.name)) again.push(tool.name);
  }
  const names = Object.keys(body.env ?? {});
  const secrets = [
    ...(names.length > 0 ? [`the secret setting${names.length > 1 ? "s" : ""} ${listed(names)}`] : []),
    ...(body.bearerToken !== undefined ? ["the access token"] : []),
  ];
  const remarked = Object.keys(kinds).filter((name) => !allowed.includes(name));
  const parts: string[] = [];
  if (!before) parts.push(`Added the tool server ${after.name}`);
  if (allowed.length > 0)
    parts.push(`Allowed ${listed(allowed.map((n) => `${n} (${KIND_WORDS[kinds[n] ?? "write"]})`))}`);
  if (remarked.length > 0)
    parts.push(`Marked ${listed(remarked.map((n) => `${n} as ${KIND_WORDS[kinds[n] ?? "write"]}`))}`);
  if (stopped.length > 0) parts.push(`Stopped allowing ${listed(stopped)}`);
  if (again.length > 0) parts.push(`Allowed ${listed(again)} again after its server changed what it does`);
  if (secrets.length > 0) parts.push(`Changed ${listed(secrets)}`);
  if (parts.length === 0) return undefined;
  return {
    change: "connection",
    summary: `${parts.join("; ")} on ${after.name}`,
    server: after.id,
    ...(allowed.length > 0 ? { allowed } : {}),
    ...(Object.keys(kinds).length > 0 ? { kinds } : {}),
    ...(stopped.length > 0 ? { stopped } : {}),
    ...(again.length > 0 ? { allowedAgain: again } : {}),
    ...(names.length > 0 ? { secretSettings: names } : {}),
    ...(body.bearerToken !== undefined
      ? { accessToken: body.bearerToken === null ? "removed" : "saved" }
      : {}),
  };
}

/** `/api/connections`: mail, MCP tool servers and the built-in tools. */
export function registerConnectionRoutes(app: Hono, s: StewardServices): void {
  /** What the person allowed a server's tools to do is policy, so it goes in the record. */
  const record = (detail: Record<string, unknown> | undefined) => {
    if (detail) s.gateway.audit.append({ type: "policy.changed", actorId: s.actorId, detail });
  };

  const upsert = async (body: McpBody) => {
    checkTransport(body);
    const before = s.mcp.list().find((x) => x.id === body.id);
    const after = await save(body);
    record(connectionChange(before, after, body));
    return after;
  };

  const save = async (body: McpBody) => {
    try {
      return await s.mcp.upsert({
        id: body.id,
        name: body.name,
        transport: body.transport,
        ...(body.command ? { command: body.command } : {}),
        args: body.args,
        ...(body.url ? { url: body.url } : {}),
        granted: body.granted,
        reads: body.reads,
        sends: body.sends,
        deletes: body.deletes,
        allowAgain: body.allowAgain,
        ...(body.env !== undefined ? { env: body.env } : {}),
        ...(body.bearerToken !== undefined ? { bearerToken: body.bearerToken } : {}),
      });
    } catch (err) {
      // The manager's own sentences say what to fix. A server that saves but fails to connect is not
      // an error here: it comes back with status "error" and the reason.
      if (err instanceof McpConfigError || err instanceof BlockedAddressError) {
        throw new HttpError(400, err.message);
      }
      if (err instanceof McpLookupError) throw new HttpError(502, err.message);
      console.error("[steward] tool server failed:", err instanceof Error ? err.message : err);
      throw new HttpError(502, "Couldn't start or reach that tool server. Check its command or address.");
    }
  };

  app.get(ROUTES.connections, (c) => {
    const mail = s.mail();
    const info: ConnectionsInfo = {
      mail: {
        connected: mail !== undefined,
        label: mail?.label ?? "Not connected",
        isDemo: mail?.isDemo ?? false,
      },
      mcp: s.mcp.list(),
      builtin: builtinToolList(),
    };
    return c.json(info);
  });

  app.post(ROUTES.mcpServers, async (c) => {
    const body = await readBody(c, McpServerBody);
    if (s.mcp.list().some((x) => x.id === body.id)) {
      throw new HttpError(409, "There is already a tool server with that id.");
    }
    return c.json(await upsert(body), 201);
  });

  app.put(ROUTES.mcpServer, async (c) => {
    const id = c.req.param("id");
    const body = await readBody(c, McpServerBody);
    if (body.id !== id) throw new HttpError(400, "The id in the address and the body must match.");
    if (!s.mcp.list().some((x) => x.id === id)) throw notFound("that tool server");
    return c.json(await upsert(body));
  });

  app.post(ROUTES.mcpServerReconnect, async (c) => {
    const id = c.req.param("id");
    if (!s.mcp.list().some((x) => x.id === id)) throw notFound("that tool server");
    return c.json(await s.mcp.reconnect(id));
  });

  app.delete(ROUTES.mcpServer, async (c) => {
    const id = c.req.param("id");
    const server = s.mcp.list().find((x) => x.id === id);
    if (!server) throw notFound("that tool server");
    await s.mcp.remove(id);
    record({ change: "connection", summary: `Removed the tool server ${server.name}`, server: id });
    return c.json({ ok: true });
  });
}
