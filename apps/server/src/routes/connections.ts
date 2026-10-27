import { type ConnectionsInfo, McpServerBody, ROUTES } from "@steward/shared";
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

/** `/api/connections`: mail, MCP tool servers and the built-in tools. */
export function registerConnectionRoutes(app: Hono, s: StewardServices): void {
  const upsert = async (body: McpBody) => {
    checkTransport(body);
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
      });
    } catch (err) {
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

  app.delete(ROUTES.mcpServer, async (c) => {
    const id = c.req.param("id");
    if (!s.mcp.list().some((x) => x.id === id)) throw notFound("that tool server");
    await s.mcp.remove(id);
    return c.json({ ok: true });
  });
}
