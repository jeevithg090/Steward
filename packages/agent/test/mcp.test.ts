import { fileURLToPath } from "node:url";
import { memoryDb } from "@steward/db";
import { alwaysRuleFor, BUILTIN, createGateway } from "@steward/gateway";
import type { EventBus, GateCall, Initiator, McpToolDefinition, McpToolKind } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { loadTenant } from "../src/tenant.ts";
import { buildToolCatalogue } from "../src/tools/catalogue.ts";
import { mcpTool, profileAllowsMcp } from "../src/tools/mcp.ts";
import type { ToolContext } from "../src/tools/types.ts";
import { FakeMcp } from "./fakes.ts";

const STEWARD_TENANT = fileURLToPath(new URL("../../../tenants/steward", import.meta.url));
const bus: EventBus = { emit: () => {}, subscribe: () => () => {} };

function definition(tool: string, kind: McpToolKind): McpToolDefinition {
  return {
    name: `mcp__slack__${tool}`,
    server: "slack",
    tool,
    description: "Posts a message to a channel.",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    kind,
  };
}

let counter = 0;
/** The call the agent's middleware would hand the gateway for this MCP tool. */
async function gateCall(
  def: McpToolDefinition,
  over: { tainted?: boolean; initiator?: Initiator } = {},
): Promise<GateCall> {
  const tool = mcpTool(def);
  const args = { text: "Lunch is at one." };
  const facts = await tool.toGateCall(args, {} as ToolContext);
  counter++;
  return {
    toolCallId: `call_${counter}`,
    runId: "run_1",
    threadId: "thr_1",
    agentId: "steward",
    actorId: "local",
    initiator: over.initiator ?? { kind: "person", id: "local" },
    tool: { name: tool.name, kind: tool.kind, surface: tool.surface, source: tool.source },
    args,
    target: facts.target,
    tainted: over.tainted ?? false,
    ...(facts.outbound ? { outbound: facts.outbound } : {}),
  };
}

/** A gateway with Steward's own tenant rules, and an Always allow already given for `def`. */
async function alwaysAllowed(def: McpToolDefinition) {
  const gw = createGateway({ db: memoryDb(), bus, tenantRules: loadTenant(STEWARD_TENANT).rules });
  const call = await gateCall(def);
  const rule = alwaysRuleFor({ tool: call.tool, target: call.target, summary: "Post to Slack" });
  if (!rule) throw new Error("Always allow should be offered for an MCP tool.");
  gw.rules.create({ ...rule, effect: "allow", enabled: true, source: "always" });
  return gw;
}

describe("MCP tools keep their kind through the gateway", () => {
  it("passes the kind the manager gave, and treats anything unknown as a write", () => {
    for (const kind of ["read", "write", "send", "delete"] as const) {
      expect(mcpTool(definition("post", kind)).kind).toBe(kind);
    }
    expect(mcpTool(definition("post", "pay" as McpToolKind)).kind).toBe("write");
  });

  it("checks what leaves for every kind but a read", async () => {
    expect((await gateCall(definition("post", "read"))).outbound).toBeUndefined();
    for (const kind of ["write", "send", "delete"] as const) {
      expect((await gateCall(definition("post", kind))).outbound).toBe("Lunch is at one.");
    }
  });

  it("asks for a tainted MCP send or delete even after Always allow", async () => {
    for (const kind of ["send", "delete"] as const) {
      const def = definition(`post_${kind}`, kind);
      const gw = await alwaysAllowed(def);
      expect(gw.governance.dryRun(await gateCall(def)).effect).toBe("allow");
      const tainted = gw.governance.dryRun(await gateCall(def, { tainted: true }));
      expect(tainted).toMatchObject({ effect: "ask", rule: { id: BUILTIN.taint.id } });
    }
  });

  it("refuses an MCP send from a routine under Steward's own rule", async () => {
    const def = definition("post_message", "send");
    const gw = await alwaysAllowed(def);
    const decision = gw.governance.dryRun(
      await gateCall(def, { initiator: { kind: "routine", id: "rtn_1" } }),
    );
    expect(decision).toMatchObject({ effect: "deny", rule: { name: "Routines never send" } });
  });
});

describe("an agent's profile narrows the MCP tools granted on Connections", () => {
  const granted = (server: string, tool: string): McpToolDefinition => ({
    name: `mcp__${server}__${tool}`,
    server,
    tool,
    description: "",
    parameters: { type: "object", properties: {} },
    kind: "write",
  });
  const mcp = new FakeMcp();
  // What the person switched on at /connections.
  mcp.tools = [granted("notes", "find"), granted("notes", "create"), granted("slack", "post")];
  const offered = (tools: string[]) =>
    buildToolCatalogue({ agentId: "helper", granted: tools, mcp })
      .filter((t) => t.surface === "mcp")
      .map((t) => t.name);

  it('offers every granted MCP tool to a profile with "*"', () => {
    expect(offered(["*"])).toEqual(["mcp__notes__find", "mcp__notes__create", "mcp__slack__post"]);
  });

  it("offers a profile limited to built-ins no MCP tools at all", () => {
    expect(offered(["web_fetch", "memory_recall"])).toEqual([]);
    expect(offered([])).toEqual([]);
  });

  it("offers only the MCP tools a profile names, one by one or a whole server", () => {
    expect(offered(["web_fetch", "mcp__notes__find"])).toEqual(["mcp__notes__find"]);
    expect(offered(["mcp__notes__*"])).toEqual(["mcp__notes__find", "mcp__notes__create"]);
  });

  it("never offers a tool the person did not grant, whatever the profile names", () => {
    expect(offered(["mcp__notes__delete", "mcp__github__*"])).toEqual([]);
    expect(profileAllowsMcp(["mcp__notes__*"], { name: "mcp__notesx__find", server: "notesx" })).toBe(false);
  });
});
