/**
 * The agent's screen, live. JPEG frames from the screencast are decoded off the main thread and
 * drawn on a canvas that keeps the page's aspect ratio at any size.
 *
 * While the person holds the wheel, the canvas takes the keyboard and pointer: clicks, drags, the
 * wheel, typing and pasting go to the agent's browser at the right coordinates. Escape always leaves
 * the screen, so the keyboard is never trapped. While Steward drives, the canvas is a picture.
 *
 * The agent's browser keeps a modifier or a mouse button down until it hears it come up, and a
 * key let go in another window never reaches this page. So whatever is held is let go here when the
 * screen loses focus, the tab is hidden, the pointer is lost, or driving ends.
 *
 * Frame handling follows OpenBot's app/src/components/computer/live-screen.tsx (MIT, CopilotKit).
 */
import { MonitorPause } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { cn } from "@/lib/utils.ts";
import { keyMessage, mouseButton, toViewport } from "./input.ts";
import { useComputer } from "./session.tsx";
import type { Frame } from "./socket.ts";

/** Keys the agent's browser holds as modifiers. A held Meta would turn typing into shortcuts. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

type MouseButton = ReturnType<typeof mouseButton>;

/** Decodes a frame to something drawable. `createImageBitmap` keeps decoding off the main thread. */
async function decode(frame: Frame): Promise<CanvasImageSource & { close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bytes = Uint8Array.from(atob(frame.data), (char) => char.charCodeAt(0));
    return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  }
  const image = new Image();
  image.src = `data:image/jpeg;base64,${frame.data}`;
  await image.decode();
  return image;
}

export function ComputerScreen({
  className,
  label = "Steward's screen",
  onLeave,
}: {
  className?: string;
  label?: string;
  /** Called when a keyboard user presses Escape on the screen, to move focus somewhere useful. */
  onLeave?: () => void;
}) {
  const computer = useComputer();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const helpId = useId();
  const driving = computer.driving && computer.connection === "open";
  const sizeRef = useRef(computer.frameSize);
  sizeRef.current = computer.frameSize;
  const { subscribeFrames, lastFrame, send } = computer;

  // Draw frames as they arrive. A monotonic id stops a slow decode from painting over a newer frame;
  // a hidden tab keeps only the latest frame and draws it when it is shown again.
  useEffect(() => {
    let closed = false;
    let latest = 0;
    let pending: Frame | undefined;
    const draw = async (frame: Frame, id: number) => {
      try {
        const image = await decode(frame);
        const canvas = canvasRef.current;
        if (closed || id !== latest || !canvas) {
          image.close?.();
          return;
        }
        if (canvas.width !== frame.width) canvas.width = frame.width;
        if (canvas.height !== frame.height) canvas.height = frame.height;
        canvas.getContext("2d")?.drawImage(image, 0, 0, frame.width, frame.height);
        image.close?.();
      } catch {
        // One corrupt frame is skipped; the next replaces it.
      }
    };
    const receive = (frame: Frame) => {
      if (typeof document !== "undefined" && document.hidden) {
        pending = frame;
        return;
      }
      pending = undefined;
      void draw(frame, ++latest);
    };
    const onVisible = () => {
      if (!document.hidden && pending) receive(pending);
    };
    const first = lastFrame();
    if (first) receive(first);
    const unsubscribe = subscribeFrames(receive);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [subscribeFrames, lastFrame]);

  const pointAt = useCallback((event: { clientX: number; clientY: number }, clamp = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return toViewport(event, canvas.getBoundingClientRect(), sizeRef.current, { clamp });
  }, []);

  // What is down on the agent's browser because of this screen, and where the pointer last was.
  const heldButtons = useRef(new Set<MouseButton>());
  const heldKeys = useRef(new Set<string>());
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  /** Lets go of the held buttons, and of the held keys too unless only the pointer was lost. */
  const releaseHeld = useCallback((keys = true) => {
    const point = lastPoint.current;
    for (const button of heldButtons.current) {
      if (point) sendRef.current({ type: "mouse", action: "up", ...point, button });
    }
    heldButtons.current.clear();
    if (!keys) return;
    for (const key of heldKeys.current) sendRef.current({ type: "key", action: "up", key });
    heldKeys.current.clear();
  }, []);

  // Pointer moves are many; at most one goes per animation frame.
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!driving) return;
    event.currentTarget.focus();
    const point = pointAt(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const button = mouseButton(event.button);
    heldButtons.current.add(button);
    lastPoint.current = point;
    send({ type: "mouse", action: "down", ...point, button });
  };
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!driving) return;
    const button = mouseButton(event.button);
    // A button that went down comes up, even when let go in the letterbox or off the canvas.
    const point = pointAt(event, heldButtons.current.has(button));
    if (!point) return;
    heldButtons.current.delete(button);
    lastPoint.current = point;
    send({ type: "mouse", action: "up", ...point, button });
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!driving) return;
    const point = pointAt(event);
    if (!point) return;
    lastPoint.current = point;
    pendingMove.current = point;
    if (moveFrame.current !== null) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) send({ type: "mouse", action: "move", ...next });
    });
  };
  useEffect(
    () => () => {
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    },
    [],
  );

  const onKey = (action: "down" | "up") => (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!driving) return;
    if (event.key === "Escape") {
      if (action === "down") onLeave?.();
      return;
    }
    const message = keyMessage(action, event);
    if (!message) return;
    event.preventDefault();
    event.stopPropagation();
    if (MODIFIERS.has(event.key)) {
      if (action === "down") heldKeys.current.add(event.key);
      else heldKeys.current.delete(event.key);
    }
    send(message);
  };

  const onPaste = (event: ClipboardEvent<HTMLCanvasElement>) => {
    if (!driving) return;
    const text = event.clipboardData.getData("text");
    if (!text) return;
    event.preventDefault();
    send({ type: "text", text });
  };

  // React's onWheel is passive and cannot stop the page scrolling, so a native listener does it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !driving) return;
    const onWheel = (event: WheelEvent) => {
      const point = pointAt(event);
      if (!point) return;
      event.preventDefault();
      send({ type: "wheel", ...point, deltaX: event.deltaX, deltaY: event.deltaY });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [driving, pointAt, send]);

  // Taking the wheel puts the keyboard on the screen straight away.
  useEffect(() => {
    if (driving) canvasRef.current?.focus({ preventScroll: true });
  }, [driving]);

  // Cmd+Tab and the like take the keyup elsewhere. Handing back, losing the wheel or leaving the
  // screen lets go of everything too.
  useEffect(() => {
    if (!driving) return;
    const onWindowBlur = () => releaseHeld();
    const onVisibility = () => {
      if (document.hidden) releaseHeld();
    };
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      releaseHeld();
    };
  }, [driving, releaseHeld]);

  const resting = !computer.hasFrame;
  const { width, height } = computer.frameSize;

  return (
    <div className={cn("relative flex min-h-0 w-full items-center justify-center", className)}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ aspectRatio: `${width} / ${height}` }}
        role={driving ? "application" : "img"}
        aria-roledescription={driving ? "remote screen" : undefined}
        aria-label={driving ? `${label}. You have control.` : `${label}, live. Steward is driving.`}
        aria-describedby={driving ? helpId : undefined}
        tabIndex={driving ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerCancel={() => releaseHeld(false)}
        onLostPointerCapture={() => releaseHeld(false)}
        onBlur={() => releaseHeld()}
        onKeyDown={onKey("down")}
        onKeyUp={onKey("up")}
        onPaste={onPaste}
        onContextMenu={(event) => {
          if (driving) event.preventDefault();
        }}
        className={cn(
          "block h-auto max-h-full w-full max-w-full rounded-tile bg-tile object-contain",
          driving
            ? "cursor-crosshair outline-2 outline-accent outline-offset-2 focus-visible:outline-4 focus-visible:outline-focus"
            : "outline-none",
          resting && "invisible",
        )}
      />
      {driving ? (
        <p id={helpId} className="sr-only">
          Keys you press here go to Steward's computer, and so do clicks. Press Escape to leave the screen;
          you keep control until you hand it back.
        </p>
      ) : null}
      {resting ? (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-tile bg-tile px-6 text-center"
        >
          <MonitorPause aria-hidden className="size-8 text-ink-3" />
          <p className="m-0 max-w-xs text-ink-2 text-sub">
            {computer.status?.running
              ? "Waiting for the first picture from Steward's screen…"
              : "Steward's computer is resting. It wakes when Steward needs it."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
