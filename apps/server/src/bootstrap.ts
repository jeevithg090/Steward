// Must stay the first import: it fixes the environment before the CopilotKit runtime loads.
import "./runtime-env.ts";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { type ServerType, serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { loadTenant } from "@steward/agent";
import { DirectoryClient } from "@steward/bots";
import { createComputerManager } from "@steward/computer";
import {
  migrations as connectorMigrations,
  createDemoGoogleApp,
  createGoogleMailCalendar,
  createMcpManager,
  createWebTools,
} from "@steward/connectors";
import { Db } from "@steward/db";
import { createGateway, migrations as gatewayMigrations } from "@steward/gateway";
import { createProactive, migrations as proactiveMigrations } from "@steward/proactive";
import { COPILOTKIT_PATH, type MailCalendar, ROUTES, type TenantPackage } from "@steward/shared";
import { Hono } from "hono";
import { BotService, botAgentSources } from "./bots/service.ts";
import { ConfigError, DEV_PORTS, isLoopbackHost, type ServerConfig } from "./config.ts";
import type { ProactiveServices, StewardServices } from "./context.ts";
import { onError } from "./http/errors.ts";
import {
  BODY_LIMITS,
  devCors,
  hostGuard,
  isAllowedUpgrade,
  limitBody,
  originGuard,
  type SecurityOptions,
  securityHeaders,
} from "./http/security.ts";
import { serveWebApp } from "./http/static.ts";
import { createEventBus } from "./live/bus.ts";
import { computerSocket, MAX_CLIENT_FRAME } from "./live/computer-ws.ts";
import { liveEventsHandler } from "./live/events-route.ts";
import { registerAppRoutes } from "./routes/app.ts";
import { registerBotRoutes } from "./routes/bots.ts";
import { registerComputerRoutes } from "./routes/computer.ts";
import { registerConnectionRoutes } from "./routes/connections.ts";
import { registerDayRoutes } from "./routes/day.ts";
import { registerGovernanceRoutes } from "./routes/governance.ts";
import { registerKnowledgeRoutes } from "./routes/knowledge.ts";
import { registerNotificationRoutes } from "./routes/notifications.ts";
import { registerRoutineRoutes } from "./routes/routines.ts";
import { registerTaskRoutes } from "./routes/tasks.ts";
import { registerThreadRoutes } from "./routes/threads.ts";
import { AgentHost, maxOutputTokens } from "./runtime/agents.ts";
import { wireRunLifecycle } from "./runtime/lifecycle.ts";
import { interruptSummary } from "./runtime/run-summary.ts";
import { NodeSqliteAgentRunner } from "./runtime/runner.ts";
import { ServerRuns } from "./runtime/server-runs.ts";
import { SetupService } from "./setup/checks.ts";
import { InstalledBotStore } from "./store/bots.ts";
import { migrations as serverMigrations } from "./store/migrations.ts";
import { SettingsStore } from "./store/settings.ts";
import { ThreadStore } from "./store/threads.ts";
import { ResumeSweep } from "./workers/resume-sweep.ts";
import { Workers } from "./workers/workers.ts";

/** Single-user mode: every action is the local person's. */
export const LOCAL_ACTOR = "local";

const VERSION: string = (() => {
  try {
    return (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
    ).version;
  } catch {
    return "0.0.0";
  }
})();

export interface Listening {
  url: string;
  port: number;
  host: string;
}

export interface StewardServer {
  readonly app: Hono;
  readonly services: StewardServices;
  /** True when the built web app is served at `/`. */
  readonly servesWebApp: boolean;
  /** Starts the HTTP server. Port 0 picks a free port (tests). */
  listen(opts?: { port?: number; host?: string }): Promise<Listening>;
  /** Stops workers and runs, closes computers, MCP clients, the model and the database. */
  close(): Promise<void>;
}

/** The address the server uses to reach itself (the demo inbox lives on the same server). */
function selfAddress(host: string): string {
  if (host === "0.0.0.0" || host === "" || isLoopbackHost(host)) return "127.0.0.1";
  if (host === "::" || host === "[::]") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function step(name: string, work: Promise<unknown> | (() => unknown), ms = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const promise = typeof work === "function" ? Promise.resolve().then(work) : work;
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ms);
      }),
    ]);
  } catch (err) {
    console.error(`[steward] closing ${name} failed:`, err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}

function loadTenantOrExplain(config: ServerConfig): TenantPackage {
  try {
    const tenant = loadTenant(config.tenantDir);
    if (tenant.agents.length === 0) throw new Error("it defines no agents");
    return tenant;
  } catch (err) {
    throw new ConfigError(
      `Couldn't load the tenant package "${config.tenantId}" from tenants/${config.tenantId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Builds the whole server: one database, the gateway, the computer, the connectors, the proactive
 * layer, the agents and the CopilotKit runtime, behind one Hono app (PLAN §5.1). Nothing listens
 * until `listen()`; tests may use `app.request(...)` directly.
 */
export async function createApp(config: ServerConfig): Promise<StewardServer> {
  const db = new Db(config.dbPath);
  const cleanups: (() => Promise<void> | void)[] = [];
  try {
    db.migrate([...gatewayMigrations, ...connectorMigrations, ...proactiveMigrations, ...serverMigrations]);
    const tenant = loadTenantOrExplain(config);
    const defaultAgentId = tenant.agents[0]!.id;

    const bus = createEventBus();
    const settings = new SettingsStore(db);
    const gateway = createGateway({
      db,
      bus,
      tenantRules: tenant.rules,
      expiryHours: () => settings.approvalExpiryHours(),
    });
    const computers = createComputerManager({
      dataDir: config.dataDir,
      headful: config.headful,
      allowPrivateHosts: config.allowPrivateHosts,
      // Steward's own server and the Vite dev and preview servers (they proxy the API), whatever
      // STEWARD_ALLOW_PRIVATE_HOSTS says.
      protectedPorts: [config.port, ...DEV_PORTS],
      audit: gateway.audit,
      actorId: LOCAL_ACTOR,
    });
    cleanups.push(() => computers.closeAll());

    // The demo inbox lives on this server, so its client is made once the port is known.
    const mailRef: { current?: MailCalendar } = {};
    const mail = () => mailRef.current;
    const mcp = createMcpManager({ db, allowPrivateHosts: config.allowPrivateHosts });
    cleanups.push(() => mcp.closeAll());
    const web = createWebTools({ allowPrivateHosts: config.allowPrivateHosts });

    let models: AgentHost | undefined;
    const proactive: ProactiveServices = createProactive({
      db,
      bus,
      mail,
      model: () => models?.textModel(),
      timezone: () => settings.timezone(),
      tenantSkills: tenant.skills,
      approvals: gateway.approvals,
    });

    const runner = new NodeSqliteAgentRunner(db);
    const threads = new ThreadStore(db, runner);
    const serverRunToken = randomBytes(32).toString("base64url");

    // The bot directory (a URL or a file) and the bots installed from it. Each installed bot
    // becomes an agent beside the tenant's, rebuilt whenever one is added, updated or removed.
    const directory = new DirectoryClient({ source: config.directoryUrl });
    const installedBots = new InstalledBotStore(db);

    const host = new AgentHost({
      tenant,
      env: config.env,
      serverRunToken,
      bots: () => botAgentSources(installedBots, proactive.skills),
      shared: {
        governance: gateway.governance,
        computers,
        mail,
        web,
        mcp,
        directory,
        stores: {
          tasks: proactive.tasks,
          memory: proactive.memory,
          skills: proactive.skills,
          routines: proactive.routines,
          brief: proactive.brief,
          triage: proactive.triage,
        },
        bus,
        settings: () => ({ plainLanguage: settings.plainLanguage(), timezone: settings.timezone() }),
        actorId: LOCAL_ACTOR,
      },
    });
    models = host;
    cleanups.push(() => host.close());
    await host.configure(settings.modelChoice());
    const hasAgent = (id: string) => host.hasAgent(id);

    const bots = new BotService({
      db,
      directory,
      directorySource: config.directoryUrl,
      counts: config.directoryCounts,
      store: installedBots,
      gateway,
      proactive,
      threads,
      settings,
      mail,
      mcp,
      host,
      bus,
      actorId: LOCAL_ACTOR,
      tenantAgentIds: tenant.agents.map((a) => a.id),
    });

    const runs = new ServerRuns({
      runner,
      agent: (id) => host.agent(id),
      serverRunToken,
      approvals: gateway.approvals,
    });
    const sweep = new ResumeSweep({
      approvals: gateway.approvals,
      runner,
      runs,
      delayMs: config.resumeDelayMs,
      onResumed: (approval, result) => {
        // Task threads are reported by the run lifecycle; everything else is said here.
        if (result.outcome !== "interrupt" || proactive.tasks.byThread(approval.threadId)) return;
        proactive.notifications.add({
          title: "Steward needs your answer",
          body: interruptSummary(result),
          href: `/chat/${approval.threadId}`,
          level: "needs_you",
        });
      },
    });
    const workers = new Workers({
      routines: proactive.routines,
      brief: proactive.brief,
      notifications: proactive.notifications,
      approvals: gateway.approvals,
      sweep,
      runs,
      settings,
      threads,
    });
    const setup = new SetupService({
      model: () => ({ info: host.info, text: host.textModel(), version: host.version }),
      mail,
      computers,
      agentId: defaultAgentId,
      mcp,
      brandName: tenant.brand.name,
      maxOutputTokens: maxOutputTokens(config.env),
    });
    const unwire = wireRunLifecycle({
      runner,
      threads,
      tasks: proactive.tasks,
      notifications: proactive.notifications,
      runs,
      bus,
      audit: gateway.audit,
      actorId: LOCAL_ACTOR,
    });

    const security: SecurityOptions = {
      bindHost: config.host,
      allowedHosts: config.allowedHosts,
      devOrigins: config.devOrigins,
    };

    const services: StewardServices = {
      config,
      version: VERSION,
      db,
      bus,
      tenant,
      gateway,
      computers,
      mcp,
      web,
      mail,
      proactive,
      models: host,
      runner,
      runs,
      sweep,
      workers,
      threads,
      settings,
      setup,
      directory,
      installedBots,
      bots,
      security,
      actorId: LOCAL_ACTOR,
      defaultAgentId,
      hasAgent,
    };

    // ── HTTP ───────────────────────────────────────────────────────────────────────────────────

    const app = new Hono();
    app.onError(onError);
    app.use("*", securityHeaders());
    app.use("*", hostGuard(security));
    app.use("/api/*", devCors(security));
    const agentLimit = limitBody(BODY_LIMITS.agent);
    const apiLimit = limitBody(BODY_LIMITS.api);
    app.use("/api/*", (c, next) =>
      (c.req.path.startsWith(`${COPILOTKIT_PATH}/`) ? agentLimit : apiLimit)(c, next),
    );
    app.use("/api/*", originGuard(security));
    app.use("/demo-google/*", limitBody(BODY_LIMITS.demo));
    // The demo inbox is the brief's inbox: another site's page must not plant mail or events in it.
    // Steward's own client sends JSON with no Origin, so it still passes.
    app.use("/demo-google/*", originGuard(security));

    // The CopilotKit runtime (AG-UI over SSE). Mounted with app.all, never at a prefix: a mounted
    // Hono handler strips the prefix and the routes land at /api/copilotkit/api/copilotkit/*.
    const runtime = new CopilotRuntime({
      agents: () => host.agents as Record<string, AbstractAgent> & { [k: string]: AbstractAgent },
      runner,
    });
    const copilot = createCopilotRuntimeHandler({ runtime, basePath: COPILOTKIT_PATH });
    app.all(`${COPILOTKIT_PATH}/*`, (c) => copilot(c.req.raw));

    const sseClosers = new Set<() => void>();
    app.get(ROUTES.events, liveEventsHandler(bus, sseClosers));

    registerAppRoutes(app, services);
    registerThreadRoutes(app, services);
    registerGovernanceRoutes(app, services);
    registerTaskRoutes(app, services);
    registerDayRoutes(app, services);
    registerRoutineRoutes(app, services);
    registerKnowledgeRoutes(app, services);
    registerConnectionRoutes(app, services);
    registerComputerRoutes(app, services);
    registerNotificationRoutes(app, services);
    registerBotRoutes(app, services);

    if (config.demoGoogle) app.route("/demo-google", createDemoGoogleApp());

    // The computer's screen. Browsers do not apply CORS to WebSockets, so the origin is checked here.
    const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({ app });
    (wss.options as { maxPayload?: number }).maxPayload = MAX_CLIENT_FRAME;
    const sockets = new Set<{
      readyState: number;
      send(d: string): void;
      close(code?: number, reason?: string): void;
    }>();
    app.get(
      ROUTES.computerWs,
      async (c, next) => {
        if (!hasAgent(c.req.param("agentId"))) return c.json({ error: "Couldn't find that agent." }, 404);
        if (!isAllowedUpgrade(c, security))
          return c.json({ error: "Requests from other sites are refused." }, 403);
        await next();
      },
      upgradeWebSocket((c) => {
        const socket = computerSocket(computers, c.req.param("agentId") ?? defaultAgentId, sockets);
        return {
          onOpen: (_event, ws) => socket.onOpen(ws),
          onMessage: (event, ws) => {
            if (typeof event.data !== "string") {
              ws.send(JSON.stringify({ type: "error", message: "Send messages as text." }));
              return;
            }
            socket.onMessage(event.data);
          },
          onClose: () => socket.onClose(),
          onError: () => socket.onError(),
        };
      }),
    );

    const servesWebApp = serveWebApp(app, config.webDistDir);
    app.notFound((c) => c.json({ error: "Couldn't find that." }, 404));

    // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────

    let server: ServerType | undefined;
    let closing: Promise<void> | undefined;

    const listen = async (opts: { port?: number; host?: string } = {}): Promise<Listening> => {
      if (server) throw new Error("Steward is already listening.");
      const port = opts.port ?? config.port;
      const hostname = opts.host ?? config.host;
      server = await new Promise<ServerType>((resolve, reject) => {
        const s = serve({ fetch: app.fetch, port, hostname }, () => resolve(s));
        s.once("error", reject);
      });
      injectWebSocket(server);
      const actualPort = (server.address() as AddressInfo).port;
      const self = selfAddress(hostname);
      if (config.demoGoogle) {
        mailRef.current = createGoogleMailCalendar({
          baseUrl: `http://${self}:${actualPort}/demo-google`,
          label: "Demo inbox",
          isDemo: true,
        });
      }
      if (config.workers) workers.start();
      return { url: `http://${self}:${actualPort}`, port: actualPort, host: hostname };
    };

    const close = (): Promise<void> => {
      closing ??= (async () => {
        workers.stop();
        sweep.stop();
        for (const end of sseClosers) end();
        for (const ws of sockets) {
          try {
            ws.close(1001, "Steward is shutting down");
          } catch {
            // Already closed.
          }
        }
        const httpServer = server as Server | undefined;
        const closed = httpServer
          ? new Promise<void>((resolve) => httpServer.close(() => resolve()))
          : Promise.resolve();
        await runner.stopAll(5_000);
        httpServer?.closeAllConnections?.();
        await step("the web server", closed);
        await step("websockets", () => wss.close());
        unwire();
        for (const cleanup of cleanups.reverse()) await step("a service", () => cleanup());
        db.close();
      })();
      return closing;
    };

    return { app, services, servesWebApp, listen, close };
  } catch (err) {
    for (const cleanup of cleanups.reverse()) await step("a service", () => cleanup());
    db.close();
    throw err;
  }
}
