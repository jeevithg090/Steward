import { memoryDb } from "@steward/db";
import { createGateway } from "@steward/gateway";
import type { LiveEvent, NotificationStore, TaskStore } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/live/bus.ts";
import { recordedUsage, wireRunLifecycle } from "../src/runtime/lifecycle.ts";
import { ServerRuns } from "../src/runtime/server-runs.ts";
import { ThreadStore } from "../src/store/threads.ts";
import { collect, EchoAgent, runInput, runnerOnMemoryDb, startRun } from "./helpers.ts";

describe("run lifecycle", () => {
  it("says live when any run starts and finishes, so an open conversation can follow it", async () => {
    const { runner, db } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    const bus = createEventBus();
    const heard: LiveEvent[] = [];
    bus.subscribe((event) => heard.push(event));
    const unwire = wireRunLifecycle({
      runner,
      threads: new ThreadStore(db, runner),
      tasks: { byThread: () => undefined } as unknown as TaskStore,
      notifications: {} as NotificationStore,
      runs,
      bus,
    });

    await collect(startRun(runner, agent, runInput("t1", "r1", "from the browser")));
    const routine = runs.start({
      agentId: "steward",
      threadId: "t1",
      userText: "from a routine",
      initiator: { kind: "routine", id: "rtn_1" },
    });
    await routine.done;

    const runEvents = heard.filter((e) => e.type === "run.started" || e.type === "run.finished");
    expect(runEvents).toEqual([
      { type: "run.started", threadId: "t1", runId: "r1", agentId: "steward" },
      { type: "run.finished", threadId: "t1", runId: "r1", agentId: "steward" },
      { type: "run.started", threadId: "t1", runId: routine.runId, agentId: "steward" },
      { type: "run.finished", threadId: "t1", runId: routine.runId, agentId: "steward" },
    ]);
    unwire();
  });

  it("records one run.finished row per run, with who started it and what it cost, counts intact", async () => {
    const { runner, db } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    agent.usage = [
      {
        provider: "xai",
        model: "grok-4.7",
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    ];
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    // The real record, so its redaction applies: a key named like a token would lose its value.
    const { audit } = createGateway({ db: memoryDb() });
    const unwire = wireRunLifecycle({
      runner,
      threads: new ThreadStore(db, runner),
      tasks: { byThread: () => undefined } as unknown as TaskStore,
      notifications: {} as NotificationStore,
      runs,
      bus: createEventBus(),
      audit,
      actorId: "local",
    });

    await collect(startRun(runner, agent, runInput("t2", "r1", "from the browser")));
    const routine = runs.start({
      agentId: "steward",
      threadId: "t2",
      userText: "from a routine",
      initiator: { kind: "routine", id: "rtn_1" },
    });
    await routine.done;

    const rows = audit
      .page({ type: "run.finished" })
      .events.reverse()
      .map(({ type, actorId, agentId, threadId, runId, detail }) => ({
        type,
        actorId,
        agentId,
        threadId,
        runId,
        detail,
      }));
    const usage = [{ provider: "xai", model: "grok-4.7", input: 10, output: 4, total: 14 }];
    expect(rows).toEqual([
      {
        type: "run.finished",
        actorId: "local",
        agentId: "steward",
        threadId: "t2",
        runId: "r1",
        detail: { outcome: "success", usage },
      },
      {
        type: "run.finished",
        actorId: "local",
        agentId: "steward",
        threadId: "t2",
        runId: routine.runId,
        detail: { outcome: "success", initiator: "routine", usage },
      },
    ]);
    expect(audit.verify().ok).toBe(true);
    unwire();
  });
});

describe("recordedUsage", () => {
  it("keeps the counts under names the record does not hide, and adds a missing total", () => {
    expect(
      recordedUsage([
        {
          provider: "openrouter",
          model: "x",
          inputTokens: 7,
          outputTokens: 2,
          cachedInputTokens: 5,
          reasoningTokens: 1,
        },
        { provider: "nvidia", model: "y", totalTokens: 9 },
        { provider: "harness:gemini" },
      ]),
    ).toEqual([
      { provider: "openrouter", model: "x", input: 7, output: 2, total: 9, cachedInput: 5, reasoning: 1 },
      { provider: "nvidia", model: "y", total: 9 },
      { provider: "harness:gemini" },
    ]);
  });
});
