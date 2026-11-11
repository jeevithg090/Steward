import type { BaseEvent, Interrupt } from "@ag-ui/client";
import type { AgentInfo, AuditLog, Initiator } from "@steward/shared";
import { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import { Delegations, delegationLimit } from "../src/runtime/delegations.ts";
import type { NodeSqliteAgentRunner } from "../src/runtime/runner.ts";
import type { RunOnThreadOptions, RunResult, ServerRun, ServerRuns } from "../src/runtime/server-runs.ts";
import { DelegationStore } from "../src/store/delegations.ts";
import { runnerOnMemoryDb } from "./helpers.ts";

const PERSON: Initiator = { kind: "person", id: "local" };

function store(): DelegationStore {
  return new DelegationStore(runnerOnMemoryDb().db);
}

let n = 0;
function task(s: DelegationStore, over: Partial<Parameters<DelegationStore["insert"]>[0]> = {}) {
  n++;
  return s.insert({
    subagentRunId: `sub-${n}`,
    parentThreadId: "parent",
    parentAgentId: "steward",
    parentRunId: "run-1",
    parentToolCallId: `call-${n}`,
    childThreadId: `sub_child-${n}`,
    childAgentId: "codex",
    task: "run the tests",
    depth: 1,
    ...over,
  });
}

describe("DelegationStore", () => {
  it("keeps each task and the questions its child waits on", () => {
    const s = store();
    const a = task(s);
    expect(a).toMatchObject({ status: "running", childAgentId: "codex", depth: 1 });
    expect(s.byChildThread(a.childThreadId)?.subagentRunId).toBe(a.subagentRunId);

    s.setStatus(a.subagentRunId, "waiting", ["q1", "q2"]);
    expect(s.get(a.subagentRunId)?.status).toBe("waiting");
    expect(s.ownerOf("q1")).toBe(a.subagentRunId);
    expect(s.ownerOf("q2")).toBe(a.subagentRunId);
    // A new status replaces the questions: an answered one belongs to nobody now.
    s.setStatus(a.subagentRunId, "waiting", ["q3"]);
    expect(s.ownerOf("q1")).toBeUndefined();
    expect(s.ownerOf("q3")).toBe(a.subagentRunId);
    s.setStatus(a.subagentRunId, "done");
    expect(s.ownerOf("q3")).toBeUndefined();
  });

  it("counts what runs now, per parent run and per agent", () => {
    const s = store();
    const a = task(s);
    task(s, { childAgentId: "helper" });
    task(s, { parentRunId: "run-2", parentThreadId: "other" });
    expect(s.runningFor("run-1")).toBe(2);
    expect(s.runningFor("run-2")).toBe(1);
    expect(s.runningForAgent("codex")).toBe(2);
    expect(s.runningForAgent("helper")).toBe(1);
    s.setStatus(a.subagentRunId, "waiting", ["q"]);
    expect(s.runningFor("run-1")).toBe(1);
    expect(s.runningForAgent("codex")).toBe(1);
  });

  it("lists and deletes a conversation's children with their questions", () => {
    const s = store();
    const a = task(s);
    const b = task(s);
    const other = task(s, { parentThreadId: "other" });
    s.setStatus(a.subagentRunId, "waiting", ["q"]);
    expect(s.childrenOf("parent").map((r) => r.subagentRunId)).toEqual([a.subagentRunId, b.subagentRunId]);
    expect(s.childThreadIds()).toEqual(new Set([a.childThreadId, b.childThreadId, other.childThreadId]));
    s.deleteForParent("parent");
    expect(s.childrenOf("parent")).toEqual([]);
    expect(s.ownerOf("q")).toBeUndefined();
    expect(s.get(other.subagentRunId)).toBeDefined();
  });

  it("at boot, marks a task still running as stopped and leaves a waiting one waiting", () => {
    const s = store();
    const cut = task(s);
    const waiting = task(s);
    const done = task(s);
    s.setStatus(waiting.subagentRunId, "waiting", ["q"]);
    s.setStatus(done.subagentRunId, "done");
    const found = s.reconcile();
    expect(found.map((r) => [r.subagentRunId, r.status])).toEqual([[cut.subagentRunId, "stopped"]]);
    expect(s.get(waiting.subagentRunId)?.status).toBe("waiting");
    expect(s.ownerOf("q")).toBe(waiting.subagentRunId);
    expect(s.get(done.subagentRunId)?.status).toBe("done");
    expect(s.reconcile()).toEqual([]);
  });
});

describe("delegationLimit", () => {
  it("reads 0 to 10 for depth and 1 to 10 for concurrency, else the default", () => {
    expect(delegationLimit(undefined, 1, 0)).toBe(1);
    expect(delegationLimit("", 1, 0)).toBe(1);
    expect(delegationLimit("0", 1, 0)).toBe(0);
    expect(delegationLimit("3", 1, 0)).toBe(3);
    expect(delegationLimit("0", 2, 1)).toBe(2);
    expect(delegationLimit("11", 2, 1)).toBe(2);
    expect(delegationLimit("1.5", 2, 1)).toBe(2);
    expect(delegationLimit("lots", 2, 1)).toBe(2);
  });
});

/** A child's run the test ends by hand: `finish` settles it, as the runner would. */
interface FakeRun {
  opts: RunOnThreadOptions;
  finish(result: Partial<RunResult>): void;
}

function harness(over: { maxDepth?: number; stopGraceMs?: number; failStart?: Error } = {}) {
  const s = store();
  const runs: FakeRun[] = [];
  const stopped: string[] = [];
  const closed: string[] = [];
  const recorded: { type: string; detail: Record<string, unknown> }[] = [];
  const agents: AgentInfo[] = [
    {
      id: "codex",
      name: "Codex",
      title: "OpenAI's coding agent",
      harness: "codex",
      available: true,
      model: "codex",
      provider: "codex",
      signIn: "vendor-tool",
    } as AgentInfo,
    {
      id: "helper",
      name: "Helper",
      title: "Summarises things",
      available: true,
      model: "test",
      provider: "scripted",
      signIn: "scripted",
    } as AgentInfo,
  ];
  const fakeRuns = {
    start(opts: RunOnThreadOptions): ServerRun {
      if (over.failStart) throw over.failStart;
      let finish: (r: RunResult) => void = () => {};
      const done = new Promise<RunResult>((resolve) => {
        finish = resolve;
      });
      runs.push({
        opts,
        finish: (r) =>
          finish({
            runId: "child-run",
            threadId: opts.threadId,
            outcome: "success",
            interrupts: [],
            text: "",
            refusals: [],
            ...r,
          }),
      });
      return { runId: "child-run", threadId: opts.threadId, done, events: new Observable<BaseEvent>() };
    },
  } as unknown as ServerRuns;
  const delegations = new Delegations({
    store: s,
    runs: () => fakeRuns,
    runner: {
      stop: async ({ threadId }: { threadId: string }) => {
        stopped.push(threadId);
      },
    } as unknown as NodeSqliteAgentRunner,
    agents: () => agents,
    audit: {
      append: (event: { type: string; detail?: Record<string, unknown> }) => {
        recorded.push({ type: event.type, detail: event.detail ?? {} });
        return {} as never;
      },
    } as unknown as AuditLog,
    actorId: "local",
    closeChild: async (threadId) => {
      closed.push(threadId);
    },
    ...(over.maxDepth !== undefined ? { maxDepth: over.maxDepth } : {}),
    stopGraceMs: over.stopGraceMs ?? 50,
  });
  let call = 0;
  const start = (agentId = "codex", runId = "run-1") =>
    delegations.start({
      parent: { threadId: "parent", runId, agentId: "steward", toolCallId: `call-${++call}` },
      agentId,
      task: "run the tests",
      depth: 1,
      initiator: PERSON,
      tainted: false,
    });
  return { s, runs, stopped, closed, recorded, delegations, start };
}

describe("Delegations", () => {
  it("stops a coding agent once its task has ended, and not while it waits on a question", async () => {
    const h = harness();
    const child = await h.start();
    const childThread = h.runs[0]!.opts.threadId;
    h.runs[0]!.finish({
      outcome: "interrupt",
      interrupts: [{ id: "q1", reason: "steward_approval" } as Interrupt],
    });
    expect((await child.done()).outcome).toBe("interrupt");
    expect(h.closed).toEqual([]);
    expect(h.s.get(child.subagentRunId)?.status).toBe("waiting");

    const resumed = await h.delegations.resume(child.subagentRunId, [], PERSON);
    h.runs[1]!.finish({ outcome: "success", text: "All tests pass." });
    expect((await resumed.done()).text).toBe("All tests pass.");
    expect(h.s.get(child.subagentRunId)?.status).toBe("done");
    await Promise.resolve();
    expect(h.closed).toEqual([childThread]);
  });

  it("refuses to go on with a task that already ended", async () => {
    const h = harness();
    const child = await h.start();
    h.runs[0]!.finish({ outcome: "success" });
    await child.done();
    await expect(h.delegations.resume(child.subagentRunId, [], PERSON)).rejects.toThrow(
      "That handed-on task already ended.",
    );
    expect(h.runs).toHaveLength(1);
    expect(h.s.get(child.subagentRunId)?.status).toBe("done");
  });

  it("gives a coding agent one task at a time, since it works in one folder", async () => {
    const h = harness();
    await h.start("codex", "run-1");
    await expect(h.start("codex", "run-2")).rejects.toThrow(
      "Codex is already working on another task in its folder. Wait for it to finish.",
    );
    // A Steward agent has no shared folder, so it can take two.
    await h.start("helper", "run-2");
    await h.start("helper", "run-3");
    expect(h.runs.map((r) => r.opts.agentId)).toEqual(["codex", "helper", "helper"]);
  });

  it("records the end of a task that could not start", async () => {
    const h = harness({ failStart: new Error("That conversation is busy.") });
    await expect(h.start()).rejects.toThrow("That conversation is busy.");
    const [record] = h.s.childrenOf("parent");
    expect(record?.status).toBe("failed");
    expect(h.recorded.map((e) => [e.type, e.detail.outcome])).toEqual([
      ["delegation.started", undefined],
      ["delegation.finished", "error"],
    ]);
    expect(h.recorded[1]?.detail.error).toBe("That conversation is busy.");
  });

  it("stops waiting for a child that ignores Stop, so the parent can end", async () => {
    const h = harness({ stopGraceMs: 50 });
    const child = await h.start();
    const childThread = h.runs[0]!.opts.threadId;
    await child.stop();
    expect(h.stopped).toEqual([childThread]);
    const result = await child.done();
    expect(result).toMatchObject({
      outcome: "cancelled",
      error: "Codex did not stop in time, so Steward stopped waiting for it.",
    });
    expect(h.s.get(child.subagentRunId)?.status).toBe("stopped");
    expect(h.closed).toEqual([childThread]);
    // When it does end later, nothing changes and the record says it ended once.
    h.runs[0]!.finish({ outcome: "success", text: "late" });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.s.get(child.subagentRunId)?.status).toBe("stopped");
    expect(h.recorded.filter((e) => e.type === "delegation.finished")).toHaveLength(1);
  });

  it("does not give up on a child that stops within the grace", async () => {
    const h = harness({ stopGraceMs: 200 });
    const child = await h.start();
    await child.stop();
    h.runs[0]!.finish({ outcome: "cancelled" });
    expect((await child.done()).outcome).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 250));
    expect(h.s.get(child.subagentRunId)?.status).toBe("stopped");
    expect(h.recorded.filter((e) => e.type === "delegation.finished")).toHaveLength(1);
    expect(h.recorded.at(-1)?.detail.error).toBeUndefined();
  });

  it("at boot, records each task the last shutdown cut off", () => {
    const h = harness();
    const cut = task(h.s, { parentThreadId: "parent" });
    expect(h.delegations.reconcile()).toBe(1);
    expect(h.s.get(cut.subagentRunId)?.status).toBe("stopped");
    expect(h.recorded).toEqual([
      {
        type: "delegation.finished",
        detail: expect.objectContaining({
          outcome: "cancelled",
          error: "Steward stopped before it finished.",
          subagentRunId: cut.subagentRunId,
        }),
      },
    ]);
  });

  it("with a depth of 0, hands nothing on", async () => {
    const h = harness({ maxDepth: 0 });
    expect(h.delegations.maxDepth).toBe(0);
    await expect(h.start()).rejects.toThrow("Handing tasks to other agents is turned off here.");
    expect(h.runs).toEqual([]);
  });
});
