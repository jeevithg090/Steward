import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface Options {
  initial: number;
  min: number;
  max: number;
  /** Pixels moved per arrow-key press. */
  step?: number;
}

/** Width state plus pointer and keyboard handlers for a drag handle on the right edge of a panel. */
export function useResizable({ initial, min, max, step = 16 }: Options) {
  const [width, setWidth] = useState(initial);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  const handleProps = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startWidth: width };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (drag.current) setWidth(clamp(drag.current.startWidth + e.clientX - drag.current.startX));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      drag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "ArrowLeft") setWidth((w) => clamp(w - step));
      if (e.key === "ArrowRight") setWidth((w) => clamp(w + step));
    },
    onDoubleClick: () => setWidth(initial),
  };

  return { width, min, max, handleProps };
}

export type ResizableHandleProps = ReturnType<typeof useResizable>["handleProps"];