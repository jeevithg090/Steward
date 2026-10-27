import type { ComputerStatus } from "@steward/shared";
import { describe, expect, it, vi } from "vitest";
import { fakeSockets } from "./fake-socket.ts";
import { ComputerSocket, type ConnectionState, DISCONNECTED, parseServerMessage } from "./socket.ts";

const status: ComputerStatus = {
  agentId: "steward",
  running: true,
  controller: "agent",
  viewport: { width: 1280, height: 800 },
};

function harness(backoff = [100, 200]) {
  const factory = fakeSockets();
  const timers: { run: () => void; delay: number }[] = [];
  const states: [ConnectionState, string | undefined][] = [];
  const onStatus = vi.fn();
  const onFrame = vi.fn();
  const onActivity = vi.fn();
  const onServerError = vi.fn();
  const socket = new ComputerSocket({
    url: "ws://localhost/ws/computer/steward",
    open: factory.open,
    backoff,
    schedule: (run, delay) => {
      const timer = { run, delay };
      timers.push(timer);
      return () => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      };
    },
    onState: (state, problem) => states.push([state, problem]),
    onStatus,
    onFrame,
    onActivity,
    onServerError,
  });
  const fire = () => {
    const timer = timers.shift();
    if (!timer) throw new Error("No retry was scheduled.");
    timer.run();
    return timer.delay;
  };
  return { socket, factory, timers, states, fire, onStatus, onFrame, onActivity, onServerError };
}

describe("parseServerMessage", () => {
  it("reads each kind of message", () => {
    expect(parseServerMessage(JSON.stringify({ type: "status", status }))).toEqual({
      type: "status",
      status,
    });
    expect(
      parseServerMessage({ type: "frame", data: "abc", mime: "image/jpeg", width: 1280, height: 800 }),
    ).toEqual({
      type: "frame",
      frame: { data: "abc", width: 1280, height: 800 },
    });
    expect(parseServerMessage({ type: "error", message: "Take control first." })).toEqual({
      type: "error",
      message: "Take control first.",
    });
  });

  it("drops malformed messages without throwing", () => {
    expect(parseServerMessage("not json")).toBeUndefined();
    expect(parseServerMessage("null")).toBeUndefined();
    expect(parseServerMessage({ type: "frame", data: "abc", width: -1, height: 800 })).toBeUndefined();
    expect(parseServerMessage({ type: "frame", data: "abc", width: 9000, height: 800 })).toBeUndefined();
    expect(parseServerMessage({ type: "frame", data: "", width: 10, height: 10 })).toBeUndefined();
    expect(parseServerMessage({ type: "status", status: { running: true } })).toBeUndefined();
    expect(parseServerMessage({ type: "mystery" })).toBeUndefined();
  });
});

describe("ComputerSocket", () => {
  it("connects, hands each message to its handler and sends only while open", () => {
    const { socket, factory, states, onStatus, onFrame, onServerError } = harness();
    socket.start();
    expect(factory.latest.url).toBe("ws://localhost/ws/computer/steward");
    expect(socket.send({ type: "take" })).toBe(false);

    factory.latest.open();
    expect(states.at(-1)).toEqual(["open", undefined]);
    factory.latest.receive({ type: "status", status });
    factory.latest.receive({ type: "frame", data: "abc", mime: "image/jpeg", width: 1280, height: 800 });
    factory.latest.receive({ type: "error", message: "Take control first." });
    expect(onStatus).toHaveBeenCalledWith(status);
    expect(onFrame).toHaveBeenCalledWith({ data: "abc", width: 1280, height: 800 });
    expect(onServerError).toHaveBeenCalledWith("Take control first.");

    expect(socket.send({ type: "take" })).toBe(true);
    expect(factory.latest.sent).toEqual([{ type: "take" }]);
  });

  it("reconnects with backoff, and gives up with a plain message when retries run out", () => {
    const { socket, factory, states, fire } = harness([100, 200]);
    socket.start();
    factory.latest.drop();
    expect(states.at(-1)?.[0]).toBe("reconnecting");
    expect(fire()).toBe(100);
    expect(factory.sockets).toHaveLength(2);

    factory.latest.drop();
    expect(fire()).toBe(200);
    factory.latest.drop();
    expect(states.at(-1)).toEqual(["closed", DISCONNECTED]);
    expect(factory.sockets).toHaveLength(3);
  });

  it("starts the backoff over once a message proves the line works", () => {
    const { socket, factory, fire } = harness([100, 200]);
    socket.start();
    factory.latest.drop();
    expect(fire()).toBe(100);
    factory.latest.open();
    factory.latest.receive({ type: "status", status });
    factory.latest.drop();
    expect(fire()).toBe(100);
  });

  it("retry starts again after giving up", () => {
    const { socket, factory, states, fire } = harness([100]);
    socket.start();
    factory.latest.drop();
    fire();
    factory.latest.drop();
    expect(states.at(-1)?.[0]).toBe("closed");
    socket.retry();
    expect(factory.sockets).toHaveLength(3);
    expect(states.at(-1)?.[0]).toBe("connecting");
  });

  it("stops cleanly: no retry, no handlers left on the old socket", () => {
    const { socket, factory, timers, onStatus } = harness();
    socket.start();
    const first = factory.latest;
    first.open();
    socket.stop();
    expect(first.closed).toBe(true);
    first.receive({ type: "status", status });
    expect(onStatus).not.toHaveBeenCalled();
    expect(timers).toHaveLength(0);
  });
});
