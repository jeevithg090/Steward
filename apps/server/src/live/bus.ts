import type { EventBus, LiveEvent } from "@steward/shared";

/**
 * The in-process bus every package emits live events on. The server fans them out to browsers over
 * `GET /api/events`. A listener that throws is logged and skipped; it never breaks the emitter.
 */
export function createEventBus(): EventBus & { readonly size: number } {
  const listeners = new Set<(event: LiveEvent) => void>();
  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (err) {
          console.error("[steward] live event listener failed:", err instanceof Error ? err.message : err);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get size() {
      return listeners.size;
    },
  };
}
