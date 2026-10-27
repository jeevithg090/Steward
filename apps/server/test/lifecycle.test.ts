import type { LiveEvent, NotificationStore, TaskStore } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/live/bus.ts";
import { wireRunLifecycle } from "../src/runtime/lifecycle.ts";
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
});
