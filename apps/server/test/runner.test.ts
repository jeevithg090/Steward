import { EventType, type RunStartedEvent } from "@ag-ui/client";
import { ThreadAlreadyRunningError } from "@copilotkit/runtime/v2";
import { describe, expect, it } from "vitest";
import { previewOf, type RunFinished, SERVER_PROPS_KEY } from "../src/runtime/runner.ts";
import { collect, EchoAgent, runInput, runnerOnMemoryDb, startRun } from "./helpers.ts";

describe("NodeSqliteAgentRunner", () => {
  it("runs an agent, stores the run and the conversation", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    const events = await collect(startRun(runner, agent, runInput("t1", "r1", "hello")));

    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const messages = runner.getThreadMessages("t1");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toBe("echo: hello");
    expect(runner.threadRecord("t1")).toMatchObject({ id: "t1", agentId: "steward", preview: "echo: hello" });
    expect(runner.listThreads()).toEqual([
      expect.objectContaining({ id: "t1", agentId: "steward", archived: false }),
    ]);
  });

  it("refuses a second run on a busy thread and frees it afterwards", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    agent.delayMs = 50;
    const first = collect(startRun(runner, agent, runInput("t1", "r1", "one")));
    expect(runner.isThreadBusy("t1")).toBe(true);
    expect(await runner.isRunning({ threadId: "t1" })).toBe(true);
    expect(() => startRun(runner, agent, runInput("t1", "r2", "two"))).toThrow(ThreadAlreadyRunningError);
    await first;
    expect(runner.isThreadBusy("t1")).toBe(false);
    await collect(startRun(runner, agent, runInput("t1", "r2", "two")));
    expect(runner.getThreadMessages("t1")).toHaveLength(2);
  });

  it("replays history on connect, with only new input messages in each RUN_STARTED", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    await collect(startRun(runner, agent, runInput("t1", "r1", "one")));
    const history = runner.getThreadMessages("t1");
    // The browser sends the whole conversation each time; the runner keeps only what is new.
    await collect(
      startRun(runner, agent, {
        ...runInput("t1", "r2", "two"),
        messages: [...history, { id: "u-r2", role: "user", content: "two" }],
      }),
    );
    const replay = await collect(runner.connect({ threadId: "t1" }));
    const starts = replay.filter((e) => e.type === EventType.RUN_STARTED) as RunStartedEvent[];
    expect(starts).toHaveLength(2);
    expect(starts[1]?.input?.messages.map((m) => m.id)).toEqual(["u-r2"]);
    expect(runner.getThreadEvents("t1").length).toBeGreaterThan(0);
  });

  it("bridges a live run to a late connect", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    agent.delayMs = 30;
    const run = collect(startRun(runner, agent, runInput("t1", "r1", "live")));
    const watched = collect(runner.connect({ threadId: "t1" }));
    await run;
    const events = await watched;
    expect(events.some((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)).toBe(true);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("never stores or replays the server run token", async () => {
    const { runner, db } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    const input = runInput("t1", "r1", "routine work", {
      forwardedProps: {
        [SERVER_PROPS_KEY]: { token: "secret-token", initiator: { kind: "routine", id: "rtn_1" } },
        keep: 1,
      },
    });
    const events = await collect(startRun(runner, agent, input));
    // The agent itself saw the token: that is how it knows a routine started the run.
    expect(JSON.stringify(agent.seen[0]?.forwardedProps)).toContain("secret-token");
    expect(JSON.stringify(events)).not.toContain("secret-token");
    expect(JSON.stringify(await collect(runner.connect({ threadId: "t1" })))).not.toContain("secret-token");
    const stored = db.all<{ events: string }>("SELECT events FROM runner_runs");
    expect(stored.map((r) => r.events).join("")).not.toContain("secret-token");
    expect(stored.map((r) => r.events).join("")).toContain('"keep":1');
  });

  it("tells listeners how each run ended, before its stream completes", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    const finished: RunFinished[] = [];
    let completedBeforeListener = false;
    runner.onRunFinished((run) => {
      completedBeforeListener = runner.isThreadBusy(run.threadId);
      finished.push(run);
    });
    await collect(startRun(runner, agent, runInput("t1", "r1", "hi")));
    agent.interrupt = {
      id: "call_1",
      reason: "steward_approval",
      metadata: { approvalId: "apr_1", summary: "Send an email" },
    };
    await collect(startRun(runner, agent, runInput("t1", "r2", "send it")));

    expect(completedBeforeListener).toBe(false);
    expect(finished.map((f) => f.outcome)).toEqual(["success", "interrupt"]);
    expect(finished[0]?.text).toBe("echo: hi");
    expect(finished[1]?.interrupts[0]?.metadata).toMatchObject({ approvalId: "apr_1" });
  });

  it("stops a run on request", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    agent.delayMs = 5_000;
    const run = collect(startRun(runner, agent, runInput("t1", "r1", "slow")));
    expect(await runner.stop({ threadId: "t1", runId: "other" })).toBe(false);
    expect(await runner.stop({ threadId: "t1" })).toBe(true);
    const events = await run;
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(runner.isThreadBusy("t1")).toBe(false);
  });

  it("deletes one thread, refuses while running, and ignores clear-all", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    await collect(startRun(runner, agent, runInput("t1", "r1", "a")));
    await collect(startRun(runner, agent, runInput("t2", "r2", "b")));
    runner.clearThreads();
    expect(runner.threadRecords()).toHaveLength(2);
    runner.deleteThread("t1");
    expect(runner.threadRecords().map((t) => t.id)).toEqual(["t2"]);
    expect(runner.getThreadMessages("t1")).toEqual([]);

    agent.delayMs = 50;
    const busy = collect(startRun(runner, agent, runInput("t2", "r3", "c")));
    expect(() => runner.deleteThread("t2")).toThrow(ThreadAlreadyRunningError);
    await busy;
  });

  it("waits for every run at shutdown, detaching agents that ignore Stop", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    agent.delayMs = 5_000;
    agent.abortable = false;
    void collect(startRun(runner, agent, runInput("t1", "r1", "x")));
    void collect(startRun(runner, agent, runInput("t2", "r2", "y")));
    expect(runner.runningCount).toBe(2);
    const started = Date.now();
    await runner.stopAll(1_000);
    expect(runner.runningCount).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(
      runner
        .threadRecords()
        .map((t) => t.id)
        .sort(),
    ).toEqual(["t1", "t2"]);
  });
});

describe("previewOf", () => {
  it("takes the last words said, cut short", () => {
    expect(previewOf([{ id: "1", role: "user", content: "hi" }])).toBe("hi");
    expect(previewOf([{ id: "1", role: "user", content: "x".repeat(300) }])?.length).toBe(140);
    expect(previewOf([{ id: "1", role: "tool", content: "{}", toolCallId: "c" }])).toBeUndefined();
  });
});
