import { memoryDb } from "@steward/db";
import type { EventBus, GateCall, LiveEvent, TenantPackage } from "@steward/shared";
import { createGateway, type GatewayOptions, toolInfo } from "../src/index.ts";

let counter = 0;

/** A call to `name` from a person in thread `thr_1`, untainted, with an empty target. */
export function gateCall(
  name: string,
  args: Record<string, unknown> = {},
  over: Partial<GateCall> = {},
): GateCall {
  counter++;
  return {
    toolCallId: `call_${counter}`,
    runId: "run_1",
    threadId: "thr_1",
    agentId: "steward",
    actorId: "local",
    initiator: { kind: "person", id: "local" },
    tool: toolInfo(name),
    args,
    target: {},
    tainted: false,
    ...over,
  };
}

export function setup(
  opts: { tenantRules?: TenantPackage["rules"]; expiryHours?: GatewayOptions["expiryHours"] } = {},
) {
  const db = memoryDb();
  const events: LiveEvent[] = [];
  const bus: EventBus = {
    emit: (e) => {
      events.push(e);
    },
    subscribe: () => () => {},
  };
  let clock = new Date("2026-10-27T09:00:00.000Z");
  const gw = createGateway({ db, bus, now: () => clock, ...opts });
  return {
    db,
    gw,
    events,
    /** Moves the gateway's clock forward. */
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    now: () => clock,
  };
}

export const HOUR = 3_600_000;

/** An action that records whether it ran. */
export function spyAction<T>(value: T) {
  const calls: number[] = [];
  const act = async () => {
    calls.push(Date.now());
    return value;
  };
  return { act, calls };
}
