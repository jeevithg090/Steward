/**
 * Adapted from openbot/agent-computer/src/screencast.ts (MIT, CopilotKit), which in turn adapts
 * steel-browser (Apache-2.0) and Chrome DevTools' InputModel (BSD-3-Clause). The macOS editing
 * commands are adapted from Playwright's macEditingCommands.ts (Apache-2.0).
 *
 * The live screen is Chromium's own screencast over CDP: JPEG frames at quality 70, at most
 * 1280×800, sent only when the page repaints. Every frame must be acknowledged or Chromium stops
 * after the first. The person's input goes back through CDP `Input.*`, never through Playwright's
 * locator API, so it behaves like a real mouse and keyboard.
 */
import type { CDPSession, Page } from "playwright";
import { VIEWPORT } from "./browser.ts";

export interface FrameMessage {
  type: "frame";
  data: string;
  mime: "image/jpeg";
  width: number;
  height: number;
}

const CDP_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms = CDP_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The browser did not answer in time.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** One screencast on one page. Restarted by the computer when the live page changes. */
export class Screencast {
  private session: CDPSession | undefined;
  private page: Page | undefined;

  constructor(private readonly onFrame: (frame: FrameMessage) => void) {}

  get target(): Page | undefined {
    return this.page;
  }

  async start(page: Page): Promise<void> {
    const session = await page.context().newCDPSession(page);
    this.session = session;
    this.page = page;
    session.on("Page.screencastFrame", (event) => {
      // Ack every frame, or Chromium sends one and stops.
      session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
      if (this.session !== session) return;
      this.onFrame({
        type: "frame",
        data: event.data,
        mime: "image/jpeg",
        width: Math.round(event.metadata.deviceWidth),
        height: Math.round(event.metadata.deviceHeight),
      });
    });
    await withTimeout(
      session.send("Page.startScreencast", {
        format: "jpeg",
        quality: 70,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
        everyNthFrame: 1,
      }),
    );
  }

  async stop(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    this.page = undefined;
    if (!session) return;
    await withTimeout(session.send("Page.stopScreencast"), 2_000).catch(() => {});
    await session.detach().catch(() => {});
  }
}

// ── The person's input ─────────────────────────────────────────────────────────────────────────

export type PersonInputMessage =
  | {
      type: "mouse";
      action: "move" | "down" | "up" | "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
    }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; action: "down" | "up" | "press"; key: string; text?: string }
  | { type: "text"; text: string };

/** CDP modifier bits. */
const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED_KEYS: Record<string, Omit<KeyDefinition, "key">> = {
  Backspace: { code: "Backspace", keyCode: 8 },
  Tab: { code: "Tab", keyCode: 9 },
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Shift: { code: "ShiftLeft", keyCode: 16 },
  Control: { code: "ControlLeft", keyCode: 17 },
  Alt: { code: "AltLeft", keyCode: 18 },
  Meta: { code: "MetaLeft", keyCode: 91 },
  CapsLock: { code: "CapsLock", keyCode: 20 },
  Escape: { code: "Escape", keyCode: 27 },
  " ": { code: "Space", keyCode: 32, text: " " },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  End: { code: "End", keyCode: 35 },
  Home: { code: "Home", keyCode: 36 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  Insert: { code: "Insert", keyCode: 45 },
  Delete: { code: "Delete", keyCode: 46 },
};
for (let i = 1; i <= 12; i++) NAMED_KEYS[`F${i}`] = { code: `F${i}`, keyCode: 111 + i };

/** Punctuation by the character it types, with the physical key that types it on a US layout. */
const PUNCTUATION: Record<string, [code: string, keyCode: number]> = {
  ";": ["Semicolon", 186],
  ":": ["Semicolon", 186],
  "=": ["Equal", 187],
  "+": ["Equal", 187],
  ",": ["Comma", 188],
  "<": ["Comma", 188],
  "-": ["Minus", 189],
  _: ["Minus", 189],
  ".": ["Period", 190],
  ">": ["Period", 190],
  "/": ["Slash", 191],
  "?": ["Slash", 191],
  "`": ["Backquote", 192],
  "~": ["Backquote", 192],
  "[": ["BracketLeft", 219],
  "{": ["BracketLeft", 219],
  "\\": ["Backslash", 220],
  "|": ["Backslash", 220],
  "]": ["BracketRight", 221],
  "}": ["BracketRight", 221],
  "'": ["Quote", 222],
  '"': ["Quote", 222],
  "!": ["Digit1", 49],
  "@": ["Digit2", 50],
  "#": ["Digit3", 51],
  $: ["Digit4", 52],
  "%": ["Digit5", 53],
  "^": ["Digit6", 54],
  "&": ["Digit7", 55],
  "*": ["Digit8", 56],
  "(": ["Digit9", 57],
  ")": ["Digit0", 48],
};

/**
 * Chromium on macOS turns shortcuts into editing commands only for real key presses; synthetic
 * ones must name the command. A subset of Playwright's table: the shortcuts people actually use.
 */
const MAC_COMMANDS: Record<string, string> = {
  "Meta+KeyA": "selectAll",
  "Meta+KeyC": "copy",
  "Meta+KeyX": "cut",
  "Meta+KeyV": "paste",
  "Meta+KeyZ": "undo",
  "Shift+Meta+KeyZ": "redo",
  "Meta+Backspace": "deleteToBeginningOfLine",
  "Meta+ArrowLeft": "moveToLeftEndOfLine",
  "Meta+ArrowRight": "moveToRightEndOfLine",
  "Meta+ArrowUp": "moveToBeginningOfDocument",
  "Meta+ArrowDown": "moveToEndOfDocument",
  "Shift+Meta+ArrowLeft": "moveToLeftEndOfLineAndModifySelection",
  "Shift+Meta+ArrowRight": "moveToRightEndOfLineAndModifySelection",
  "Shift+ArrowLeft": "moveLeftAndModifySelection",
  "Shift+ArrowRight": "moveRightAndModifySelection",
  "Shift+ArrowUp": "moveUpAndModifySelection",
  "Shift+ArrowDown": "moveDownAndModifySelection",
  "Alt+ArrowLeft": "moveWordLeft",
  "Alt+ArrowRight": "moveWordRight",
  "Shift+Alt+ArrowLeft": "moveWordLeftAndModifySelection",
  "Shift+Alt+ArrowRight": "moveWordRightAndModifySelection",
  "Alt+Backspace": "deleteWordBackward",
};

/**
 * Maps a key name from the web app to what CDP needs. Cmd stays Meta on macOS (so Cmd+A and Cmd+C
 * work natively) and becomes Control elsewhere, where the same shortcuts use Control.
 */
export function keyDefinition(key: string, platform: NodeJS.Platform = process.platform): KeyDefinition {
  const name = key === "Meta" && platform !== "darwin" ? "Control" : key;
  const named = NAMED_KEYS[name];
  if (named) return { key: name, ...named };
  if ([...name].length === 1) {
    if (/^[a-z]$/i.test(name))
      return {
        key: name,
        code: `Key${name.toUpperCase()}`,
        keyCode: name.toUpperCase().charCodeAt(0),
        text: name,
      };
    if (/^\d$/.test(name))
      return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
    const punct = PUNCTUATION[name];
    if (punct) return { key: name, code: punct[0], keyCode: punct[1], text: name };
    return { key: name, code: "", keyCode: 0, text: name };
  }
  return { key: name, code: name, keyCode: 0 };
}

/** Dispatches the person's mouse and keyboard to the live page. One per computer. */
export class PersonInput {
  private session: CDPSession | undefined;
  private page: Page | undefined;
  private modifiers = 0;
  private buttons = 0;

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  /** Forget the page: the next input opens a session on the new live page. */
  async reset(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    this.page = undefined;
    this.modifiers = 0;
    this.buttons = 0;
    await session?.detach().catch(() => {});
  }

  async dispatch(page: Page, msg: PersonInputMessage): Promise<void> {
    const session = await this.sessionFor(page);
    const send = (method: string, params: Record<string, unknown>) =>
      withTimeout(
        (session.send as (m: string, p: Record<string, unknown>) => Promise<unknown>)(method, params),
      );

    if (msg.type === "mouse") {
      const x = clamp(msg.x, 0, VIEWPORT.width);
      const y = clamp(msg.y, 0, VIEWPORT.height);
      const button = msg.button ?? "left";
      const base = { x, y, modifiers: this.modifiers };
      if (msg.action === "move") {
        const held = (Object.keys(BUTTON_BITS) as (keyof typeof BUTTON_BITS)[]).find(
          (b) => this.buttons & BUTTON_BITS[b],
        );
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...base,
          button: held ?? "none",
          buttons: this.buttons,
        });
        return;
      }
      if (msg.action === "down" || msg.action === "click") {
        this.buttons |= BUTTON_BITS[button];
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...base,
          button,
          buttons: this.buttons,
          clickCount: 1,
        });
      }
      if (msg.action === "up" || msg.action === "click") {
        this.buttons &= ~BUTTON_BITS[button];
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...base,
          button,
          buttons: this.buttons,
          clickCount: 1,
        });
      }
      return;
    }

    if (msg.type === "wheel") {
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: clamp(msg.x, 0, VIEWPORT.width),
        y: clamp(msg.y, 0, VIEWPORT.height),
        deltaX: clamp(msg.deltaX, -10_000, 10_000),
        deltaY: clamp(msg.deltaY, -10_000, 10_000),
        modifiers: this.modifiers,
      });
      return;
    }

    if (msg.type === "text") {
      await send("Input.insertText", { text: msg.text });
      return;
    }

    const def = keyDefinition(msg.key, this.platform);
    const bit = MODIFIER_BITS[def.key] ?? 0;
    if (msg.action === "down" || msg.action === "press") {
      if (bit) this.modifiers |= bit;
      // Shortcuts (Ctrl/Cmd/Alt held) must not type their letter.
      const shortcut =
        (this.modifiers & (MODIFIER_BITS.Control! | MODIFIER_BITS.Meta! | MODIFIER_BITS.Alt!)) !== 0;
      const text = def.key === "Enter" ? "\r" : shortcut ? undefined : (msg.text ?? def.text);
      const commands = this.commandsFor(def.code);
      await send("Input.dispatchKeyEvent", {
        type: text ? "keyDown" : "rawKeyDown",
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.keyCode,
        nativeVirtualKeyCode: def.keyCode,
        modifiers: this.modifiers,
        ...(text ? { text, unmodifiedText: text } : {}),
        ...(commands.length > 0 ? { commands } : {}),
      });
    }
    if (msg.action === "up" || msg.action === "press") {
      if (bit) this.modifiers &= ~bit;
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.keyCode,
        nativeVirtualKeyCode: def.keyCode,
        modifiers: this.modifiers,
      });
    }
  }

  private commandsFor(code: string): string[] {
    if (this.platform !== "darwin") return [];
    const parts: string[] = [];
    for (const name of ["Shift", "Control", "Alt", "Meta"]) {
      if (this.modifiers & (MODIFIER_BITS[name] ?? 0)) parts.push(name);
    }
    parts.push(code);
    const command = MAC_COMMANDS[parts.join("+")];
    return command ? [command] : [];
  }

  private async sessionFor(page: Page): Promise<CDPSession> {
    if (this.session && this.page === page) return this.session;
    await this.reset();
    const session = await page.context().newCDPSession(page);
    this.session = session;
    this.page = page;
    return session;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}
