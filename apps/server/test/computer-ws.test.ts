import type {
  ComputerClientMessage,
  ComputerManager,
  ComputerServerMessage,
  ComputerStatus,
} from "@steward/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computerSocket,
  FRAME_DRAIN_CHECK_MS,
  MAX_BUFFERED_FRAME_BYTES,
  MAX_CLIENT_FRAME,
  parseClientMessage,
} from "../src/live/computer-ws.ts";

describe("parseClientMessage", () => {
  it("accepts each message the contract defines", () => {
    const valid: ComputerClientMessage[] = [
      { type: "take" },
      { type: "release" },
      { type: "mouse", action: "click", x: 10, y: 20, button: "left" },
      { type: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 120 },
      { type: "key", action: "press", key: "Enter" },
      { type: "text", text: "hello" },
      { type: "navigate", url: "https://example.com" },
      { type: "secret", requestId: "sec_1", value: "hunter2" },
      { type: "secret.cancel", requestId: "sec_1" },
    ];
    for (const msg of valid)
      expect(parseClientMessage(JSON.stringify(msg))).toEqual({ ok: true, message: msg });
  });

  it("refuses anything else", () => {
    for (const raw of [
      "not json",
      "{}",
      '{"type":"mouse","action":"fly","x":1,"y":1}',
      '{"type":"mouse","action":"move","x":"1","y":1}',
    ]) {
      expect(parseClientMessage(raw).ok).toBe(false);
    }
    expect(parseClientMessage(" ".repeat(MAX_CLIENT_FRAME + 1))).toEqual({
      ok: false,
      error: "That message is too large.",
    });
  });
});

describe("computerSocket", () => {
  const status: ComputerStatus = {
    agentId: "steward",
    running: false,
    controller: "agent",
    viewport: { width: 1280, height: 800 },
  };

  function manager(handle: (msg: ComputerClientMessage) => Promise<void>) {
    const listeners = new Set<(m: ComputerServerMessage) => void>();
    const computers = {
      status: () => status,
      subscribe: (_id: string, l: (m: ComputerServerMessage) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      handle: (_id: string, msg: ComputerClientMessage) => handle(msg),
    } as unknown as ComputerManager;
    return { computers, listeners };
  }

  function socket() {
    const sent: ComputerServerMessage[] = [];
    return { sent, ws: { readyState: 1, send: (d: string) => sent.push(JSON.parse(d)), close: () => {} } };
  }

  it("sends the status first, then whatever the computer streams, and unsubscribes on close", () => {
    const { computers, listeners } = manager(async () => {});
    const open = new Set<never>();
    const { sent, ws } = socket();
    const handlers = computerSocket(computers, "steward", open as Set<typeof ws> as never);
    handlers.onOpen(ws);
    for (const l of listeners) l({ type: "frame", data: "AAAA", mime: "image/jpeg", width: 1, height: 1 });
    expect(sent.map((m) => m.type)).toEqual(["status", "frame"]);
    handlers.onClose();
    expect(listeners.size).toBe(0);
  });

  it("passes valid input on and never echoes a secret in an error", async () => {
    const handled: ComputerClientMessage[] = [];
    const { computers } = manager(async (msg) => {
      handled.push(msg);
      if (msg.type === "secret") throw new Error(`fill failed for value ${msg.value}`);
    });
    const { sent, ws } = socket();
    const handlers = computerSocket(computers, "steward", new Set());
    handlers.onOpen(ws);
    handlers.onMessage(JSON.stringify({ type: "take" }));
    handlers.onMessage(JSON.stringify({ type: "secret", requestId: "s1", value: "hunter2" }));
    handlers.onMessage("garbage");
    await new Promise((r) => setTimeout(r, 10));
    expect(handled.map((m) => m.type)).toEqual(["take", "secret"]);
    expect(JSON.stringify(sent)).not.toContain("hunter2");
    expect(sent.filter((m) => m.type === "error").map((m) => (m as { message: string }).message)).toEqual([
      "That message could not be read.",
      "Couldn't fill that field. Try again.",
    ]);
  });

  describe("a viewer that falls behind", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const frame = (data: string): ComputerServerMessage => ({
      type: "frame",
      data,
      mime: "image/jpeg",
      width: 1,
      height: 1,
    });

    /** Hono's context, with the `ws` socket and its backlog underneath. */
    function slowSocket() {
      const sent: ComputerServerMessage[] = [];
      const raw = { bufferedAmount: 0 };
      const ws = {
        readyState: 1,
        raw,
        send: (d: string) => sent.push(JSON.parse(d)),
        close: () => {},
      };
      return { sent, raw, ws };
    }

    it("skips frames while the backlog is large, then sends only the newest once it drains", () => {
      vi.useFakeTimers();
      const { computers, listeners } = manager(async () => {});
      const { sent, raw, ws } = slowSocket();
      const handlers = computerSocket(computers, "steward", new Set());
      handlers.onOpen(ws);
      const stream = (msg: ComputerServerMessage) => {
        for (const l of listeners) l(msg);
      };

      stream(frame("one"));
      raw.bufferedAmount = MAX_BUFFERED_FRAME_BYTES + 1;
      stream(frame("two"));
      stream(frame("three"));
      // Status, activity and errors never wait.
      stream({ type: "status", status });
      vi.advanceTimersByTime(FRAME_DRAIN_CHECK_MS * 5);
      expect(sent.map((m) => (m.type === "frame" ? m.data : m.type))).toEqual(["status", "one", "status"]);

      raw.bufferedAmount = 0;
      vi.advanceTimersByTime(FRAME_DRAIN_CHECK_MS);
      expect(sent.map((m) => (m.type === "frame" ? m.data : m.type))).toEqual([
        "status",
        "one",
        "status",
        "three",
      ]);
      // Nothing is sent twice, and the check stops once the frame is out.
      vi.advanceTimersByTime(FRAME_DRAIN_CHECK_MS * 5);
      expect(sent).toHaveLength(4);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("sends a new frame at once when the backlog has gone, dropping the one held", () => {
      vi.useFakeTimers();
      const { computers, listeners } = manager(async () => {});
      const { sent, raw, ws } = slowSocket();
      const handlers = computerSocket(computers, "steward", new Set());
      handlers.onOpen(ws);
      raw.bufferedAmount = MAX_BUFFERED_FRAME_BYTES * 2;
      for (const l of listeners) l(frame("old"));
      raw.bufferedAmount = 0;
      for (const l of listeners) l(frame("new"));
      vi.advanceTimersByTime(FRAME_DRAIN_CHECK_MS * 5);
      expect(sent.filter((m) => m.type === "frame").map((m) => (m as { data: string }).data)).toEqual([
        "new",
      ]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("forgets a held frame when the screen closes", () => {
      vi.useFakeTimers();
      const { computers, listeners } = manager(async () => {});
      const { sent, raw, ws } = slowSocket();
      const handlers = computerSocket(computers, "steward", new Set());
      handlers.onOpen(ws);
      raw.bufferedAmount = MAX_BUFFERED_FRAME_BYTES * 2;
      for (const l of listeners) l(frame("held"));
      handlers.onClose();
      raw.bufferedAmount = 0;
      vi.advanceTimersByTime(FRAME_DRAIN_CHECK_MS * 5);
      expect(sent.map((m) => m.type)).toEqual(["status"]);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
