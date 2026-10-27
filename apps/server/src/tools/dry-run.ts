import { buildToolCatalogue, type GateFacts, type StewardTool, type ToolServices } from "@steward/agent";
import type { ComputerManager, GateCall, Initiator, McpManager } from "@steward/shared";
import { buildDryRunCall } from "./catalogue.ts";

/** How long a tool may take to say what it would touch before the minimal resolver is used instead. */
const RESOLVE_TIMEOUT_MS = 1_000;

/**
 * The computer as a dry run may see it: its status, never a start. A tool that needs the live page
 * to resolve its target (a click names an element on the screen) fails here, and the minimal
 * resolver answers from the arguments instead. The "would this be allowed?" tester must never open
 * a browser.
 */
function idleComputers(real: ComputerManager): ComputerManager {
  const refuse = () => Promise.reject(new Error("A dry run does not start the computer."));
  return {
    get: refuse,
    status: (agentId) => real.status(agentId),
    activity: (agentId, limit) => real.activity(agentId, limit),
    subscribe: () => () => {},
    handle: refuse,
    reset: refuse,
    closeAll: async () => {},
  };
}

async function factsFrom(
  tool: StewardTool,
  args: Record<string, unknown>,
  ctx: Parameters<StewardTool["toGateCall"]>[1],
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      tool.toGateCall(args, ctx),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), RESOLVE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the gateway's view of a hypothetical call for `POST /api/rules/dry-run`, the way the agent
 * would: the tool's kind, surface and source come from the agent's own catalogue, and so does the
 * target when the tool can resolve it without acting. Anything else falls back to the minimal
 * resolver in `catalogue.ts`.
 */
export async function dryRunCall(
  input: { tool: string; args: Record<string, unknown>; tainted: boolean; initiator: Initiator["kind"] },
  ctx: { agentId: string; actorId: string; services: ToolServices; mcp: McpManager },
): Promise<GateCall> {
  const servers = ctx.mcp.list();
  const call = buildDryRunCall(input, {
    agentId: ctx.agentId,
    actorId: ctx.actorId,
    mcpKind: (server, tool) =>
      servers.find((s) => s.id === server)?.tools.find((t) => t.name === tool || t.name.endsWith(`__${tool}`))
        ?.kind,
  });

  let tool: StewardTool | undefined;
  try {
    tool = buildToolCatalogue({ agentId: ctx.agentId, granted: ["*"], mcp: ctx.mcp }).find(
      (t) => t.name === input.tool,
    );
  } catch {
    tool = undefined;
  }
  if (!tool) return call;

  const facts: GateFacts | undefined = await factsFrom(tool, input.args, {
    agentId: ctx.agentId,
    threadId: call.threadId,
    runId: call.runId,
    toolCallId: call.toolCallId,
    signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    services: { ...ctx.services, computers: idleComputers(ctx.services.computers) },
  });
  return {
    ...call,
    tool: { name: tool.name, kind: tool.kind, surface: tool.surface, source: tool.source },
    ...(facts ? { target: { ...call.target, ...facts.target } } : {}),
    ...(facts?.outbound !== undefined ? { outbound: facts.outbound } : {}),
  };
}
