import type { Approval, ApprovalStore } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { ServerRuns } from "../src/runtime/server-runs.ts";
import { ResumeSweep } from "../src/workers/resume-sweep.ts";
import { collect, EchoAgent, runInput, runnerOnMemoryDb, startRun } from "./helpers.ts";

/** The parked call a thread's last run ended on, as the agent left it in history. */
async function threadWithParkedCall(threadId: string, toolCallIds: string[]) {
  const { runner } = runnerOnMemoryDb();
  const agent = new EchoAgent({ agentId: "steward" });
  await collect(
    startRun(runner, agent, {
      threadId,
      runId: "r1",
      messages: [
        { id: "u1", role: "user", content: "Email sam@example.com about Friday" },
        {
          id: "a1",
          role: "assistant",
          toolCalls: toolCallIds.map((id) => ({
            id,
            type: "function" as const,
            function: { name: "mail_send", arguments: "{}" },
          })),
        },
      ],
      tools: [],
      context: [],
      state: {},
    }),
  );
  agent.seen.length = 0;
  return { runner, agent };
}

function approval(over: Partial<Approval>): Approval {
  return {
    id: "apr_1",
    toolCallId: "call_1",
    runId: "r1",
    threadId: "t1",
    agentId: "steward",
    status: "refused",
    summary: "Send an email to sam@example.com",
    tool: { name: "mail_send", kind: "send", surface: "mail", source: "builtin" },
    args: {},
    target: {},
    decision: { effect: "ask", reason: "Sending asks first.", findings: [] },
    canAlways: true,
    createdAt: new Date().toISOString(),
    decidedAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  };
}

function store(items: Approval[]): ApprovalStore {
  return {
    list: (filter = {}) =>
      items.filter(
        (a) =>
          (!filter.status || a.status === filter.status) &&
          (!filter.threadId || a.threadId === filter.threadId),
      ),
    get: (id) => items.find((a) => a.id === id),
    byToolCall: (id) => items.find((a) => a.toolCallId === id),
    decide: () => {
      throw new Error("not used");
    },
    expireDue: () => 0,
  };
}

describe("ResumeSweep", () => {
  it("resumes a refused approval once, as cancelled", async () => {
    const { runner, agent } = await threadWithParkedCall("t1", ["call_1"]);
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    const sweep = new ResumeSweep({ approvals: store([approval({})]), runner, runs, delayMs: 0 });

    const result = await sweep.sweep("apr_1");
    expect(result?.outcome).toBe("success");
    expect(agent.seen).toHaveLength(1);
    expect(agent.seen[0]?.resume).toEqual([{ interruptId: "call_1", status: "cancelled" }]);
    expect(agent.seen[0]?.forwardedProps).toMatchObject({
      steward: { initiator: { kind: "resume", id: "apr_1" } },
    });
    expect(await sweep.sweep("apr_1")).toBeUndefined();
    expect(agent.seen).toHaveLength(1);
  });

  it("resumes an allowed approval as resolved, with every answer from the same run", async () => {
    const { runner, agent } = await threadWithParkedCall("t1", ["call_1", "call_2"]);
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    const items = [
      approval({ status: "allowed" }),
      approval({ id: "apr_2", toolCallId: "call_2", status: "pending" }),
    ];
    const sweep = new ResumeSweep({ approvals: store(items), runner, runs, delayMs: 0 });

    // One of the two is still waiting: nothing happens yet.
    expect(await sweep.sweep("apr_1")).toBeUndefined();
    items[1] = { ...items[1]!, status: "refused" };
    await sweep.sweep("apr_2");
    expect(agent.seen[0]?.resume).toEqual([
      { interruptId: "call_1", status: "resolved" },
      { interruptId: "call_2", status: "cancelled" },
    ]);
  });

  it("leaves alone what a browser already resumed", async () => {
    const { runner, agent } = await threadWithParkedCall("t1", ["call_1"]);
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    const claimed = new ResumeSweep({
      approvals: store([approval({ claimedAt: new Date().toISOString() })]),
      runner,
      runs,
      delayMs: 0,
    });
    expect(await claimed.sweep("apr_1")).toBeUndefined();
    const missing = new ResumeSweep({
      approvals: store([approval({ threadId: "gone" })]),
      runner,
      runs,
      delayMs: 0,
    });
    expect(await missing.sweep("apr_1")).toBeUndefined();
    expect(agent.seen).toHaveLength(0);
  });

  it("catches up on answers nobody claimed, such as after a restart", async () => {
    const { runner, agent } = await threadWithParkedCall("t1", ["call_1"]);
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    const old = approval({ id: "apr_old", decidedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    const sweep = new ResumeSweep({ approvals: store([approval({}), old]), runner, runs, delayMs: 1_000 });
    await sweep.catchUp();
    expect(agent.seen).toHaveLength(1);
    expect(agent.seen[0]?.resume?.[0]?.interruptId).toBe("call_1");
  });

  it("waits while the thread is busy", async () => {
    const { runner, agent } = await threadWithParkedCall("t1", ["call_1"]);
    agent.delayMs = 100;
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    // The person writes in the conversation from the browser.
    const busy = collect(startRun(runner, agent, runInput("t1", "r2", "something else")));
    const sweep = new ResumeSweep({ approvals: store([approval({})]), runner, runs, delayMs: 0 });
    expect(await sweep.sweep("apr_1")).toBeUndefined();
    await busy;
    expect(agent.seen.some((i) => i.resume)).toBe(false);
    sweep.stop();
  });

  it("still resumes an allowed call after a browser run that never saw it", async () => {
    const { runner, agent } = await threadWithParkedCall("t1", ["call_1"]);
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    // The page did not follow the run that parked the call, so its history stops before it.
    await collect(
      startRun(runner, agent, {
        ...runInput("t1", "r2", "and another thing"),
        messages: [
          { id: "u1", role: "user", content: "Email sam@example.com about Friday" },
          { id: "u-r2", role: "user", content: "and another thing" },
        ],
      }),
    );
    const sweep = new ResumeSweep({
      approvals: store([approval({ status: "allowed" })]),
      runner,
      runs,
      delayMs: 0,
    });
    expect((await sweep.sweep("apr_1"))?.outcome).toBe("success");
    expect(agent.seen.at(-1)?.resume).toEqual([{ interruptId: "call_1", status: "resolved" }]);
  });
});
