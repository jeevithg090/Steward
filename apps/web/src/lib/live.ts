import { type LiveEvent, ROUTES } from "@steward/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { queryKeys } from "./api.ts";

/**
 * One EventSource to `/api/events`, shared by the whole app. It opens with the first subscriber,
 * closes with the last, and reconnects with backoff (1 s doubling to 30 s, with jitter) when the
 * server goes away. After a reconnect every query is refreshed, since events may have been missed.
 *
 * The server may send plain `data:` messages carrying `{ type, ... }`, or named events
 * (`event: approval.created`); both are read.
 */

export type LiveStatus = "idle" | "connecting" | "open" | "reconnecting" | "unsupported";
export type LiveListener = (event: LiveEvent) => void;

const EVENT_TYPES: LiveEvent["type"][] = [
  "approval.created",
  "approval.decided",
  "audit.appended",
  "task.updated",
  "brief.ready",
  "routine.updated",
  "run.started",
  "run.finished",
  "notification",
];

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

class LiveConnection {
  private source: EventSource | undefined;
  private listeners = new Set<LiveListener>();
  private statusListeners = new Set<() => void>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private everOpened = false;
  private onReconnect: (() => void) | undefined;
  status: LiveStatus = "idle";

  constructor(private readonly url: string) {}

  subscribe(listener: LiveListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.open();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  }

  /** Called after the stream comes back, so caches can catch up. */
  setReconnectHandler(handler: (() => void) | undefined): void {
    this.onReconnect = handler;
  }

  watchStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Delivers an event as if it came from the server. Used by tests and by features that echo locally. */
  dispatch(event: LiveEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error("A live event listener failed", err);
      }
    }
  }

  private setStatus(status: LiveStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of [...this.statusListeners]) l();
  }

  private open(): void {
    if (typeof EventSource === "undefined") {
      this.setStatus("unsupported");
      return;
    }
    this.setStatus(this.everOpened ? "reconnecting" : "connecting");
    const source = new EventSource(this.url, { withCredentials: true });
    this.source = source;

    source.onopen = () => {
      const wasReconnect = this.everOpened;
      this.attempts = 0;
      this.everOpened = true;
      this.setStatus("open");
      if (wasReconnect) this.onReconnect?.();
    };
    source.onmessage = (msg) => this.receive(msg.data, undefined);
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (msg) => this.receive((msg as MessageEvent<string>).data, type));
    }
    source.onerror = () => {
      // Our own backoff replaces the browser's fixed retry, so a down server is not hammered.
      source.close();
      if (this.source !== source) return;
      this.source = undefined;
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.listeners.size === 0) return;
    this.setStatus("reconnecting");
    const base = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** this.attempts);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempts++;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.listeners.size > 0 && !this.source) this.open();
    }, delay);
  }

  private close(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.source?.close();
    this.source = undefined;
    this.attempts = 0;
    // A later subscriber starts afresh; its queries load on mount, so this is not a reconnect.
    this.everOpened = false;
    this.setStatus("idle");
  }

  private receive(data: string, named: LiveEvent["type"] | undefined): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const event = ("type" in parsed ? parsed : named ? { type: named, ...(parsed as object) } : undefined) as
      | LiveEvent
      | undefined;
    if (!event || !EVENT_TYPES.includes(event.type)) return;
    this.dispatch(event);
  }
}

/** The app-wide connection. Exported for tests and for code outside React. */
export const live = new LiveConnection(ROUTES.events);

/** Subscribes outside React. Returns the unsubscribe function. */
export function subscribeLive(listener: LiveListener): () => void {
  return live.subscribe(listener);
}

/**
 * Keeps the shared stream open while mounted and returns its status. Pass a listener to hear every
 * event; it may change between renders without resubscribing.
 */
export function useLiveEvents(listener?: LiveListener): {
  status: LiveStatus;
  subscribe: (listener: LiveListener) => () => void;
} {
  const ref = useRef(listener);
  ref.current = listener;

  useEffect(() => live.subscribe((event) => ref.current?.(event)), []);

  const status = useSyncExternalStore(
    (cb) => live.watchStatus(cb),
    () => live.status,
    () => "idle" as LiveStatus,
  );
  return { status, subscribe: subscribeLive };
}

/** Which cached queries each event makes stale. */
export function applyLiveEvent(qc: QueryClient, event: LiveEvent): void {
  switch (event.type) {
    case "approval.created":
    case "approval.decided":
      qc.setQueryData(queryKeys.approval(event.approval.id), event.approval);
      void qc.invalidateQueries({ queryKey: queryKeys.approvalLists });
      void qc.invalidateQueries({ queryKey: queryKeys.tasks });
      if (event.type === "approval.decided" && event.approval.answer === "always") {
        void qc.invalidateQueries({ queryKey: queryKeys.rules });
      }
      return;
    case "audit.appended":
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
      return;
    case "task.updated":
      void qc.invalidateQueries({ queryKey: queryKeys.tasks });
      void qc.invalidateQueries({ queryKey: queryKeys.threads });
      return;
    case "brief.ready":
      void qc.invalidateQueries({ queryKey: queryKeys.brief });
      return;
    case "routine.updated":
      void qc.invalidateQueries({ queryKey: queryKeys.routines });
      return;
    // The thread list shows which conversations are running. An open one follows the run itself.
    case "run.started":
    case "run.finished":
      void qc.invalidateQueries({ queryKey: queryKeys.threads });
      return;
    case "notification":
      void qc.invalidateQueries({ queryKey: queryKeys.notifications });
      return;
  }
}

/**
 * Mounted once at the app root: keeps every cached list in step with the server. `onEvent` hears
 * each event after the caches are updated (the shell uses it for toasts).
 */
export function useLiveSync(onEvent?: LiveListener): LiveStatus {
  const qc = useQueryClient();
  useEffect(() => {
    live.setReconnectHandler(() => void qc.invalidateQueries());
    return () => live.setReconnectHandler(undefined);
  }, [qc]);
  const { status } = useLiveEvents((event) => {
    applyLiveEvent(qc, event);
    onEvent?.(event);
  });
  return status;
}
