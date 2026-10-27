import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWPORT, keyMessage, mouseButton, toViewport } from "./input.ts";

const box = { left: 100, top: 50, width: 640, height: 400 };
const plain = { ctrlKey: false, metaKey: false, altKey: false };

describe("toViewport", () => {
  it("maps the drawn canvas onto the 1280x800 page", () => {
    expect(toViewport({ clientX: 100, clientY: 50 }, box, DEFAULT_VIEWPORT)).toEqual({ x: 0, y: 0 });
    expect(toViewport({ clientX: 420, clientY: 250 }, box, DEFAULT_VIEWPORT)).toEqual({ x: 640, y: 400 });
    expect(toViewport({ clientX: 740, clientY: 450 }, box, DEFAULT_VIEWPORT)).toEqual({ x: 1279, y: 799 });
  });

  it("allows for letterboxing when the box is a different shape from the frame", () => {
    // A 1000x400 box shows the 1280x800 frame 640 wide, centred: 180px of letterbox each side.
    const wide = { left: 0, top: 0, width: 1000, height: 400 };
    expect(toViewport({ clientX: 180, clientY: 0 }, wide, DEFAULT_VIEWPORT)).toEqual({ x: 0, y: 0 });
    expect(toViewport({ clientX: 500, clientY: 200 }, wide, DEFAULT_VIEWPORT)).toEqual({ x: 640, y: 400 });
    expect(toViewport({ clientX: 100, clientY: 200 }, wide, DEFAULT_VIEWPORT)).toBeUndefined();
  });

  it("uses the frame's own size when it differs from the viewport", () => {
    expect(toViewport({ clientX: 420, clientY: 250 }, box, { width: 1280, height: 713 })).toEqual({
      x: 640,
      y: 357,
    });
  });

  it("gives up until there is something to map onto", () => {
    expect(
      toViewport({ clientX: 1, clientY: 1 }, { left: 0, top: 0, width: 0, height: 0 }, DEFAULT_VIEWPORT),
    ).toBeUndefined();
  });
});

describe("keyMessage", () => {
  it("sends printable keys with their text, and editing keys without", () => {
    expect(keyMessage("down", { key: "a", ...plain })).toEqual({
      type: "key",
      action: "down",
      key: "a",
      text: "a",
    });
    expect(keyMessage("up", { key: "a", ...plain })).toEqual({ type: "key", action: "up", key: "a" });
    expect(keyMessage("down", { key: "Backspace", ...plain })).toEqual({
      type: "key",
      action: "down",
      key: "Backspace",
    });
    expect(keyMessage("down", { key: "Shift", ...plain })).toEqual({
      type: "key",
      action: "down",
      key: "Shift",
    });
  });

  it("sends shortcuts as keys, not as typed text", () => {
    expect(keyMessage("down", { key: "a", ...plain, ctrlKey: true })).toEqual({
      type: "key",
      action: "down",
      key: "a",
    });
  });

  it("keeps Escape and the paste shortcut on this page", () => {
    expect(keyMessage("down", { key: "Escape", ...plain })).toBeUndefined();
    expect(keyMessage("down", { key: "v", ...plain, metaKey: true })).toBeUndefined();
  });

  it("names mouse buttons", () => {
    expect([0, 1, 2].map(mouseButton)).toEqual(["left", "middle", "right"]);
  });
});
