import { describe, expect, it } from "vitest";
import { ROUTINE_FRAME, routineFiring, taskStart, unframe } from "../src/runtime/frames.ts";
import { SERVER_PROPS_KEY } from "../src/runtime/runner.ts";
import { ServerRuns, ThreadBusyError } from "../src/runtime/server-runs.ts";
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
