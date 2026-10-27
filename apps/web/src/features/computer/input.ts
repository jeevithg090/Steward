/**
 * Turning the person's mouse and keyboard on the live screen into input for the agent's browser.
 *
 * Coordinates are mapped from the canvas as it is drawn on this page to the page's own viewport
 * (1280×800 by default), allowing for letterboxing when the canvas box and the frame differ in
 * shape. The frame's reported size is used when there is one, since a fresh headless page can report
 * a viewport that differs from what it paints (OpenBot found 1280×713 frames on a 1280×800 page).
 */
import type { ComputerClientMessage } from "@steward/shared";

export interface Size {
  width: number;
  height: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORT: Size = { width: 1280, height: 800 };

/**
 * Maps a point on the drawn canvas to viewport coordinates. Returns undefined for a point in the
 * letterbox around the picture, or when nothing has a size yet.
 */
export function toViewport(
  point: { clientX: number; clientY: number },
  box: Box,
  size: Size,
): { x: number; y: number } | undefined {
  if (box.width <= 0 || box.height <= 0 || size.width <= 0 || size.height <= 0) return undefined;
  const scale = Math.min(box.width / size.width, box.height / size.height);
  const drawnWidth = size.width * scale;
  const drawnHeight = size.height * scale;
  const offsetX = (box.width - drawnWidth) / 2;
  const offsetY = (box.height - drawnHeight) / 2;
  const localX = point.clientX - box.left - offsetX;
  const localY = point.clientY - box.top - offsetY;
  if (localX < 0 || localY < 0 || localX > drawnWidth || localY > drawnHeight) return undefined;
  return {
    x: Math.min(size.width - 1, Math.max(0, Math.round(localX / scale))),
    y: Math.min(size.height - 1, Math.max(0, Math.round(localY / scale))),
  };
}

export function mouseButton(button: number): "left" | "middle" | "right" {
  return button === 2 ? "right" : button === 1 ? "middle" : "left";
}

/** Whether a key event is the paste shortcut, which is left to the browser so a `paste` event follows. */
export function isPasteShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
}

/**
 * A key event as a message for the agent's browser, or undefined when the key stays on this page.
 * Escape stays here: it is how a keyboard user leaves the screen. Modifier keys travel as their own
 * down and up events, so Shift+A and Ctrl+A arrive as they were pressed.
 */
export function keyMessage(
  action: "down" | "up",
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
): Extract<ComputerClientMessage, { type: "key" }> | undefined {
  if (event.key === "Escape" || event.key === "Unidentified" || event.key === "Dead") return undefined;
  if (isPasteShortcut(event)) return undefined;
  // Only a printable character carries text, and only without a shortcut modifier. Text on
  // Backspace or Ctrl+A would type a character instead of editing.
  const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  return action === "down" && printable
    ? { type: "key", action, key: event.key, text: event.key }
    : { type: "key", action, key: event.key };
}
