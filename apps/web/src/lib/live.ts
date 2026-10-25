"use client";

import { useEffect, useRef, useState } from "react";

export interface LiveEvent {
  type: string;
  mission_id?: string;
  [key: string]: unknown;
}

/** Live Gateway events over WebSocket, newest first, reconnecting with backoff. */
export function useLiveEvents(url: string | null, limit = 50): { events: LiveEvent[]; connected: boolean } {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    if (!url) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const open = () => {
      socket = new WebSocket(url);
      socket.onopen = () => {
        retry.current = 0;
        setConnected(true);
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as LiveEvent;
        setEvents((previous) => [event, ...previous].slice(0, limit));
      };
      socket.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry.current += 1;
        timer = setTimeout(open, Math.min(1000 * 2 ** retry.current, 15000));
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [url, limit]);

  return { events, connected };
}
