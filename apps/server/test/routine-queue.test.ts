import type { Routine } from "@steward/shared";
import { describe, expect, it } from "vitest";
import type { RunResult, ServerRun } from "../src/runtime/server-runs.ts";
import { ROUTINE_QUEUE, type WorkerDeps, Workers } from "../src/workers/workers.ts";
import { waitFor } from "./helpers.ts";

function routine(id: string, agentId: string): Routine {
  return {
    id,
    title: id,
    prompt: `Do ${id}.`,
    schedule: "0 8 * * *",
    scheduleText: "Every day at 08:00",
    timezone: "UTC",
    enabled: true,
    agentId,
    threadId: `thread-${id}`,
    consecutiveFailures: 0,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
}

/**
 * Workers on stand-in services: `due` hands out the given routines once, and every run the
 * server starts stays under way until the test finishes it.
 */
function harness(due: Routine[], queue?: { concurrent: number; turnMs: number }) {
  let pending = [...due];
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const recorded: string[] = [];
  const runs = {
    start(opts: { threadId: string; initiator: { id: string } }): ServerRun {
      const id = opts.initiator.id;
      started.push(id);
      const done = new Promise<RunResult>((resolve) => {
        finish.set(id, () =>
          resolve({
            runId: `run-${id}`,
            threadId: opts.threadId,
            outcome: "success",
            interrupts: [],
            text: "Done.",
            refusals: [],
          } as unknown as RunResult),
        );
      });
      return { runId: `run-${id}`, threadId: opts.threadId, done } as ServerRun;
    },
    whenIdle: async () => {},
  };
  const deps = {
    routines: {
      due: () => {
        const out = pending;
        pending = [];
        return out;
      },
      recordRun: (id: string, status: string) => {
        recorded.push(`${id}:${status}`);
        return routine(id, "steward");
      },
    },
    notifications: { add: () => undefined },
    threads: { upsertMeta: () => undefined },
    runs,
  } as unknown as WorkerDeps;
  const workers = new Workers(deps, queue);
  return {
    workers,
    started,
    recorded,
    add: (more: Routine[]) => pending.push(...more),
    finish: (id: string) => {
      const f = finish.get(id);
      if (!f) throw new Error(`${id} has not started`);
      f();
    },
  };
}

/** Lets promise callbacks (a finished run handing on its agent's turn) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("routines that are due at the same time", () => {
  it("run one at a time for the same agent, in the order they were due", async () => {
    const h = harness([routine("a1", "steward"), routine("a2", "steward"), routine("a3", "steward")]);
    await h.workers.tickRoutines();
    await settle();
    expect(h.started).toEqual(["a1"]);

    h.finish("a1");
    await waitFor(() => h.started.length === 2);
    expect(h.started).toEqual(["a1", "a2"]);
    expect(h.recorded).toEqual(["a1:ok"]);

    h.finish("a2");
    await waitFor(() => h.started.length === 3);
    h.finish("a3");
    await waitFor(() => h.recorded.length === 3);
    expect(h.started).toEqual(["a1", "a2", "a3"]);
    expect(h.recorded).toEqual(["a1:ok", "a2:ok", "a3:ok"]);
  });

  it("run together for different agents, up to the limit", async () => {
    expect(ROUTINE_QUEUE.concurrent).toBe(3);
    const h = harness([
      routine("one", "a"),
      routine("two", "b"),
      routine("three", "c"),
      routine("four", "d"),
      routine("five", "a"),
    ]);
    await h.workers.tickRoutines();
    await settle();
    expect(h.started).toEqual(["one", "two", "three"]);

    // "five" is next in line but waits for agent a; "four" takes the free place.
    h.finish("two");
    await waitFor(() => h.started.length === 4);
    expect(h.started).toEqual(["one", "two", "three", "four"]);

    h.finish("one");
    await waitFor(() => h.started.length === 5);
    expect(h.started.at(-1)).toBe("five");
  });

  it("does not hold an agent's turn for longer than the turn limit", async () => {
    const h = harness([routine("slow", "steward"), routine("next", "steward")], {
      concurrent: 3,
      turnMs: 50,
    });
    await h.workers.tickRoutines();
    await settle();
    expect(h.started).toEqual(["slow"]);
    // "slow" never finishes; "next" starts once the turn limit has passed.
    await waitFor(() => h.started.length === 2);
    expect(h.started).toEqual(["slow", "next"]);
  });

  it("queues a routine once, even when it is claimed again while it waits", async () => {
    const h = harness([routine("busy", "steward"), routine("again", "steward")]);
    await h.workers.tickRoutines();
    h.add([routine("again", "steward")]);
    await h.workers.tickRoutines();
    h.finish("busy");
    await waitFor(() => h.started.length === 2);
    h.finish("again");
    await settle();
    expect(h.started).toEqual(["busy", "again"]);
  });

  it("starts nothing more once stopped", async () => {
    const h = harness([routine("first", "steward"), routine("second", "steward")]);
    await h.workers.tickRoutines();
    await settle();
    h.workers.stop();
    h.finish("first");
    await settle();
    expect(h.started).toEqual(["first"]);
  });
});
