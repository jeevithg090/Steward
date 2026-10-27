import type { Approval, LiveEvent } from "@steward/shared";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./api.ts";
import { applyLiveEvent, live, subscribeLive } from "./live.ts";

/** A stand-in for the browser's EventSource that the test drives by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private named = new Map<string, (msg: { data: string }) => void>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (msg: { data: string }) => void) {
    this.named.set(type, fn);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown, type?: string) {
    const msg = { data: JSON.stringify(data) };
    if (type) this.named.get(type)?.(msg);
    else this.onmessage?.(msg);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the live stream", () => {
  it("opens one connection for many subscribers and closes with the last", () => {
    const a = subscribeLive(() => {});
    const b = subscribeLive(() => {});
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events");
    a();
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    b();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(live.status).toBe("idle");
  });

  it("delivers plain and named events, and ignores junk", () => {
    const seen: LiveEvent[] = [];
    const stop = subscribeLive((e) => seen.push(e));
    const source = FakeEventSource.instances[0]!;
    source.onopen?.();
    expect(live.status).toBe("open");
    source.emit({ type: "task.updated", taskId: "tsk_1" });
    source.emit({ routineId: "rtn_1" }, "routine.updated");
    source.emit({ type: "something.else" });
    source.onmessage?.({ data: "not json" });
    expect(seen).toEqual([
      { type: "task.updated", taskId: "tsk_1" },
      { type: "routine.updated", routineId: "rtn_1" },
    ]);
    stop();
  });

  it("delivers the runs the server starts and finishes", () => {
    const seen: LiveEvent[] = [];
    const stop = subscribeLive((e) => seen.push(e));
    const source = FakeEventSource.instances[0]!;
    source.emit({ type: "run.started", threadId: "thr_1", runId: "run_1", agentId: "steward" });
    source.emit({ threadId: "thr_1", runId: "run_1", agentId: "steward" }, "run.finished");
    expect(seen.map((e) => e.type)).toEqual(["run.started", "run.finished"]);
    stop();
  });

  it("reconnects with backoff and refreshes caches once back", () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    live.setReconnectHandler(onReconnect);
    const stop = subscribeLive(() => {});
    const first = FakeEventSource.instances[0]!;
    first.onopen?.();
    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(live.status).toBe("reconnecting");
    vi.advanceTimersByTime(1_100);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1]!.onopen?.();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(live.status).toBe("open");
    stop();
    live.setReconnectHandler(undefined);
  });
});

describe("applyLiveEvent", () => {
  it("updates the approval and refreshes the lists that show it", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const approval = { id: "apr_1", status: "allowed", answer: "always" } as Approval;
    applyLiveEvent(qc, { type: "approval.decided", approval });
    expect(qc.getQueryData(queryKeys.approval("apr_1"))).toBe(approval);
    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(queryKeys.approvalLists);
    expect(keys).toContainEqual(queryKeys.tasks);
    expect(keys).toContainEqual(queryKeys.rules);
  });

  it.each([
    [{ type: "audit.appended", event: {} } as LiveEvent, queryKeys.audit],
    [{ type: "brief.ready", briefId: "b" } as LiveEvent, queryKeys.brief],
    [{ type: "routine.updated", routineId: "r" } as LiveEvent, queryKeys.routines],
    [{ type: "notification", notification: {} } as LiveEvent, queryKeys.notifications],
    [{ type: "task.updated", taskId: "t" } as LiveEvent, queryKeys.tasks],
    [{ type: "run.started", threadId: "t", runId: "r", agentId: "a" } as LiveEvent, queryKeys.threads],
    [{ type: "run.finished", threadId: "t", runId: "r", agentId: "a" } as LiveEvent, queryKeys.threads],
  ])("%o refreshes %o", (event, key) => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    applyLiveEvent(qc, event);
    expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(key);
  });
});
