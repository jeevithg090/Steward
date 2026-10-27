import type { EventBus } from "@steward/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

export const HEARTBEAT_MS = 15_000;

/**
 * `GET /api/events`: every `LiveEvent` on the bus as an SSE `data:` line, with a comment heartbeat so
 * proxies keep the stream open. Each open stream registers a closer so shutdown can end it.
 */
export function liveEventsHandler(bus: EventBus, closers: Set<() => void>, heartbeatMs = HEARTBEAT_MS) {
  return (c: Context) => {
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let seq = 0;
      let closed = false;
      await stream.write("retry: 3000\n: connected\n\n");

      const unsubscribe = bus.subscribe((event) => {
        if (closed) return;
        stream.writeSSE({ data: JSON.stringify(event), id: String(++seq) }).catch(() => {});
      });
      const heartbeat = setInterval(() => {
        if (!closed) stream.write(": keep-alive\n\n").catch(() => {});
      }, heartbeatMs);
      heartbeat.unref();

      let closer: (() => void) | undefined;
      await new Promise<void>((resolve) => {
        closer = resolve;
        closers.add(resolve);
        stream.onAbort(resolve);
      });
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (closer) closers.delete(closer);
    });
  };
}
