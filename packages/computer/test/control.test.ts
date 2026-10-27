import { describe, expect, it } from "vitest";
import { WheelControl } from "../src/control.ts";
import { MESSAGES } from "../src/errors.ts";
import { parseClientMessage } from "../src/messages.ts";
import { keyDefinition } from "../src/screen.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WheelControl", () => {
  it("makes a take wait for the agent's action on the screen to finish", async () => {
    const control = new WheelControl();
    const release = control.admit(true);
    let taken = false;
    const take = control.take().then(() => {
      taken = true;
    });
    await delay(30);
    expect(taken).toBe(false);
    // Already closing: a new agent action is refused before the person even has the wheel.
    expect(() => control.admit(true)).toThrow(MESSAGES.personHasControl);
    release();
    await take;
    expect(control.controller).toBe("person");
  });

  it("does not hold a take for files or the shell, but still refuses them while the person drives", async () => {
    const control = new WheelControl();
    control.admit(false);
    await control.take();
    expect(control.controller).toBe("person");
    expect(() => control.admit(false)).toThrow(MESSAGES.personHasControl);
  });

  it("gives up a take that cannot drain, and reopens for the agent", async () => {
    const control = new WheelControl();
    control.admit(true);
    await expect(control.take(50)).rejects.toThrow(MESSAGES.stillFinishing);
    expect(control.controller).toBe("agent");
  });

  it("requires a fresh look after the person hands back", async () => {
    const control = new WheelControl();
    await control.take();
    control.snapshotTaken();
    expect(control.release()).toBe(true);
    expect(control.snapshotRequired).toBe(true);
    control.snapshotTaken();
    expect(control.snapshotRequired).toBe(false);
    expect(control.release()).toBe(false);
  });

  it("answers a help request when the person hands back", async () => {
    let changes = 0;
    const control = new WheelControl(() => changes++);
    const help = control.requestHelp("Please sign in.");
    expect(control.help?.reason).toBe("Please sign in.");
    expect(() => control.admit(true)).toThrow(MESSAGES.waitingForHelp);
    await control.take();
    control.release();
    await expect(help).resolves.toEqual({ released: true });
    expect(control.help).toBeUndefined();
    expect(changes).toBeGreaterThanOrEqual(3);
  });

  it("withdraws a help request on abort or timeout", async () => {
    const control = new WheelControl();
    const abort = new AbortController();
    const asked = control.requestHelp("Clear the CAPTCHA.", { signal: abort.signal });
    abort.abort();
    await expect(asked).resolves.toEqual({ released: false });
    expect(control.help).toBeUndefined();
    await expect(control.requestHelp("Again.", { timeoutMs: 20 })).resolves.toEqual({ released: false });
    expect(control.help).toBeUndefined();
    expect(() => control.admit(true)).not.toThrow();
  });

  it("tells everyone no when the computer stops", async () => {
    const control = new WheelControl();
    const help = control.requestHelp("Sign in.");
    await control.take();
    control.interrupt();
    await expect(help).resolves.toEqual({ released: false });
    expect(control.controller).toBe("agent");
    expect(control.snapshotRequired).toBe(true);
  });
});

describe("screen messages", () => {
  it("accepts well-formed input and drops everything else", () => {
    expect(parseClientMessage({ type: "take" })).toEqual({ type: "take" });
    expect(parseClientMessage({ type: "mouse", action: "click", x: 10, y: 20 })).toEqual({
      type: "mouse",
      action: "click",
      x: 10,
      y: 20,
    });
    expect(parseClientMessage({ type: "mouse", action: "click", x: Number.NaN, y: 1 })).toBeUndefined();
    expect(parseClientMessage({ type: "key", action: "press", key: "" })).toBeUndefined();
    expect(parseClientMessage({ type: "key", action: "press", key: "a".repeat(41) })).toBeUndefined();
    expect(parseClientMessage({ type: "secret", requestId: "sec_1" })).toBeUndefined();
    expect(parseClientMessage({ type: "exec", command: "rm -rf /" })).toBeUndefined();
    expect(parseClientMessage("take")).toBeUndefined();
  });

  it("maps keys for CDP, keeping Cmd as Meta only on macOS", () => {
    expect(keyDefinition("a")).toMatchObject({ code: "KeyA", keyCode: 65, text: "a" });
    expect(keyDefinition("Enter")).toMatchObject({ code: "Enter", keyCode: 13, text: "\r" });
    expect(keyDefinition("Backspace")).toEqual({ key: "Backspace", code: "Backspace", keyCode: 8 });
    expect(keyDefinition("?")).toMatchObject({ code: "Slash", keyCode: 191 });
    expect(keyDefinition("Meta", "darwin")).toMatchObject({ key: "Meta", code: "MetaLeft" });
    expect(keyDefinition("Meta", "linux")).toMatchObject({ key: "Control", code: "ControlLeft" });
  });
});
