import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { ROUTES, type WorkspaceFile } from "@steward/shared";
import type { Context, Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { asUserError, HttpError, notFound } from "../http/errors.ts";
import { intQuery } from "./query.ts";

/** Where `@steward/computer` keeps an agent's workspace (PLAN §3: `computers/<agent>/workspace`). */
export function workspaceDir(dataDir: string, agentId: string): string {
  return join(dataDir, "computers", agentId, "workspace");
}

/**
 * Lists a workspace folder straight from disk, read only, so opening the Files tab does not start a
 * browser. Paths are contained with `realpath`: nothing outside the workspace is ever listed.
 */
export function listWorkspace(root: string, dir = ""): WorkspaceFile[] {
  const outside = () => new HttpError(400, "That folder is outside the workspace.");
  const asked = resolve(root, dir.replace(/^\/+/, ""));
  if (asked !== resolve(root) && !asked.startsWith(resolve(root) + sep)) throw outside();
  if (!existsSync(root)) return [];
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, dir.replace(/^\/+/, ""));
  if (target !== realRoot && !target.startsWith(realRoot + sep)) throw outside();
  if (!existsSync(target)) return [];
  const real = realpathSync(target);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw outside();
  const out: WorkspaceFile[] = [];
  for (const name of readdirSync(real)) {
    const full = join(real, name);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    out.push({
      path: relative(realRoot, full).split(sep).join("/"),
      size: stat.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString(),
      isDirectory: stat.isDirectory(),
    });
  }
  return out.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.path.localeCompare(b.path));
}

/** `/api/computer/:agentId`: the agent's computer, its activity and its workspace files. */
export function registerComputerRoutes(app: Hono, s: StewardServices): void {
  const agentOf = (c: Context) => {
    const agentId = c.req.param("agentId");
    if (!agentId || !s.hasAgent(agentId)) throw notFound("that agent");
    return agentId;
  };

  app.get(ROUTES.computer, (c) => c.json(s.computers.status(agentOf(c))));

  app.get(ROUTES.computerActivity, (c) => {
    const agentId = agentOf(c);
    const limit = intQuery(c, "limit", { min: 1, max: 500, fallback: 100 });
    return c.json(s.computers.activity(agentId, limit));
  });

  app.get(ROUTES.computerFiles, async (c) => {
    const agentId = agentOf(c);
    const dir = c.req.query("dir") ?? "";
    if (dir.length > 1024 || dir.includes("\0")) throw new HttpError(400, "That folder name can't be read.");
    if (s.computers.status(agentId).running) {
      try {
        const computer = await s.computers.get(agentId);
        return c.json(await computer.listFiles(dir || undefined));
      } catch (err) {
        asUserError(err);
      }
    }
    return c.json(listWorkspace(workspaceDir(s.config.dataDir, agentId), dir));
  });

  app.post(ROUTES.computerReset, async (c) => c.json(await s.computers.reset(agentOf(c))));
}
