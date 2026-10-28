import { type BaseEvent, EventType } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { summariseRun } from "../src/runtime/run-summary.ts";

const usage = [{ provider: "xai", model: "grok-4.7", inputTokens: 10, outputTokens: 4, totalTokens: 14 }];

describe("summariseRun", () => {
  it("keeps the token usage the run's last event carries, however the run ended", () => {
    const started = { type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as BaseEvent;
    const finished = { type: EventType.RUN_FINISHED, threadId: "t", runId: "r", usage } as BaseEvent;
    expect(summariseRun([started, finished])).toMatchObject({ outcome: "success", usage });
    expect(
      summariseRun([
        started,
        {
          ...finished,
          outcome: { type: "interrupt", interrupts: [{ id: "tc_1", reason: "steward_approval" }] },
        } as BaseEvent,
      ]),
    ).toMatchObject({ outcome: "interrupt", usage });
    expect(
      summariseRun([started, finished, { type: EventType.RUN_ERROR, message: "boom" } as BaseEvent]),
    ).toMatchObject({ outcome: "error", error: "boom", usage });
  });

  it("leaves usage out when nothing was counted", () => {
    const events = [
      { type: EventType.RUN_STARTED, threadId: "t", runId: "r" },
      { type: EventType.RUN_FINISHED, threadId: "t", runId: "r" },
    ] as BaseEvent[];
    expect(summariseRun(events)).not.toHaveProperty("usage");
    const empty = [
      events[0]!,
      { type: EventType.RUN_FINISHED, threadId: "t", runId: "r", usage: [{ provider: "x" }] } as BaseEvent,
    ];
    expect(summariseRun(empty)).not.toHaveProperty("usage");
  });
});
