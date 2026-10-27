import type { Approval } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { ROUTINE_FRAME, routineFiring, taskStart, unframe } from "../src/runtime/frames.ts";
import { SERVER_PROPS_KEY } from "../src/runtime/runner.ts";
import { ServerRuns, ThreadBusyError, ThreadWaitingError, waitingCalls } from "../src/runtime/server-runs.ts";
import { collect, EchoAgent, runInput, runnerOnMemoryDb, startRun } from "./helpers.ts";

function setup() {
  const { runner, db } = runnerOnMemoryDb();
  const agent = new EchoAgent({ agentId: "steward" });
  const runs = new ServerRuns({
    runner,
    agent: (id) => (id === "steward" ? agent : undefined),
    serverRunToken: "tok",
  });
  return { runner, db, agent, runs };
}

describe("ServerRuns", () => {
  it("continues a thread from the runner's history with a new framed message", async () => {
    const { runner, agent, runs } = setup();
    await collect(startRun(runner, agent, runInput("t1", "r1", "earlier")));

    const run = runs.start({
      agentId: "steward",
      threadId: "t1",
      userText: routineFiring("Check my mail"),
      initiator: { kind: "routine", id: "rtn_1" },
    });
    expect(runs.initiatorOf(run.runId)).toEqual({ kind: "routine", id: "rtn_1" });
    const result = await run.done;

    expect(result.outcome).toBe("success");
    expect(result.text).toContain("Check my mail");
    const seen = agent.seen.at(-1)!;
    expect(seen.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(seen.forwardedProps?.[SERVER_PROPS_KEY]).toEqual({
      token: "tok",
      initiator: { kind: "routine", id: "rtn_1" },
    });
    expect(runner.getThreadMessages("t1")).toHaveLength(4);
    expect(runs.initiatorOf(run.runId)).toBeUndefined();
  });

  it("passes resume entries through and reports an interrupt", async () => {
    const { agent, runs } = setup();
    agent.interrupt = {
      id: "call_9",
      reason: "steward_approval",
      metadata: { approvalId: "apr_9", summary: "Pay £20" },
    };
    const result = await runs.start({
      agentId: "steward",
      threadId: "t2",
      resume: [{ interruptId: "call_8", status: "cancelled" }],
      initiator: { kind: "resume", id: "apr_8" },
    }).done;
    expect(agent.seen.at(-1)?.resume).toEqual([{ interruptId: "call_8", status: "cancelled" }]);
    expect(result.outcome).toBe("interrupt");
    expect(result.interrupts[0]?.id).toBe("call_9");
  });

  it("refuses a busy thread and an unknown agent", async () => {
    const { agent, runs } = setup();
    agent.delayMs = 50;
    const first = runs.start({
      agentId: "steward",
      threadId: "t3",
      userText: "a",
      initiator: { kind: "task", id: "tsk" },
    });
    expect(() =>
      runs.start({
        agentId: "steward",
        threadId: "t3",
        userText: "b",
        initiator: { kind: "task", id: "tsk" },
      }),
    ).toThrow(ThreadBusyError);
    expect(() =>
      runs.start({ agentId: "nobody", threadId: "t4", initiator: { kind: "task", id: "x" } }),
    ).toThrow("Couldn't find that agent.");
    await first.done;
  });
});

describe("a new turn over an unanswered approval", () => {
  /** A thread whose last run parked `call_1`, as the agent leaves it in history. */
  async function parked() {
    const env = setup();
    await collect(
      startRun(env.runner, env.agent, {
        ...runInput("t1", "r1", "Email Sam"),
        messages: [
          { id: "u1", role: "user", content: "Email Sam" },
          {
            id: "a1",
            role: "assistant",
            toolCalls: [{ id: "call_1", type: "function", function: { name: "mail_send", arguments: "{}" } }],
          },
        ],
      }),
    );
    env.agent.seen.length = 0;
    return env;
  }

  it("is refused, so the answer never lands after it; a resume still runs", async () => {
    const { runner, runs, agent } = await parked();
    const firing = {
      agentId: "steward",
      threadId: "t1",
      initiator: { kind: "routine", id: "rtn_1" },
    } as const;
    expect(() => runs.start({ ...firing, userText: routineFiring("Check my mail") })).toThrow(
      ThreadWaitingError,
    );
    expect(agent.seen).toHaveLength(0);
    expect(runner.getThreadMessages("t1").filter((m) => m.role === "user")).toHaveLength(1);

    const resumed = await runs.start({ ...firing, resume: [{ interruptId: "call_1", status: "resolved" }] })
      .done;
    expect(resumed.outcome).toBe("success");
  });

  it("counts only calls whose approval no run has claimed", async () => {
    const messages = (await parked()).runner.getThreadMessages("t1");
    const approval = (over: Partial<Approval>) => ({
      byToolCall: (id: string) => ({ toolCallId: id, threadId: "t1", ...over }) as Approval,
    });
    expect(waitingCalls(messages, "t1")).toEqual(["call_1"]);
    expect(waitingCalls(messages, "t1", approval({ status: "pending" }))).toEqual(["call_1"]);
    expect(waitingCalls(messages, "t1", approval({ status: "allowed" }))).toEqual(["call_1"]);
    expect(waitingCalls(messages, "t1", approval({ claimedAt: "2026-10-27T09:00:00Z" }))).toEqual([]);
    expect(waitingCalls(messages, "t1", approval({ threadId: "elsewhere" }))).toEqual([]);
    // A call left behind by a stopped run has no approval and will never be answered.
    expect(waitingCalls(messages, "t1", { byToolCall: () => undefined })).toEqual([]);
    // Once the person has written past it, it is no longer the last turn's.
    expect(waitingCalls([...messages, { id: "u2", role: "user", content: "never mind" }], "t1")).toEqual([]);
  });
});

describe("frames", () => {
  it("frames routine firings and task starts, and strips them again", () => {
    const fired = routineFiring("  Check my mail ");
    expect(fired.startsWith(ROUTINE_FRAME)).toBe(true);
    expect(unframe(fired)).toEqual({ frame: ROUTINE_FRAME, body: "Check my mail" });
    const started = taskStart(
      { title: "Reply to Sam", detail: "About Friday.", nextStep: "Draft it" },
      "Keep it short",
    );
    expect(unframe(started).body).toBe(
      "Task: Reply to Sam\n\nAbout Friday.\n\nFirst step: Draft it\n\nFrom the person: Keep it short",
    );
    expect(unframe("plain words")).toEqual({ body: "plain words" });
  });
});
