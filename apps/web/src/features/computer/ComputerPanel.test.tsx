import type { ActivityItem, ComputerStatus } from "@steward/shared";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputerPanel } from "./ComputerPanel.tsx";
import { fakeSockets } from "./fake-socket.ts";

// The panel's REST reads (status and activity before the socket opens, the file list) are not what
// is under test here; they answer with nothing.
vi.mock("@/lib/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api.ts")>();
  return {
    ...actual,
    useComputerStatus: () => ({ data: undefined }),
    useComputerActivity: () => ({ data: [] }),
    useComputerFiles: () => ({
      data: [{ path: "report.md", size: 2100, modifiedAt: new Date().toISOString(), isDirectory: false }],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }),
  };
});

const base: ComputerStatus = {
  agentId: "steward",
  running: true,
  url: "https://news.ycombinator.com/news",
  title: "Hacker News",
  controller: "agent",
  viewport: { width: 1280, height: 800 },
};

let sockets: ReturnType<typeof fakeSockets>;

function setup() {
  sockets = fakeSockets();
  render(<ComputerPanel agentId="steward" openSocket={sockets.open} />);
  const socket = sockets.latest;
  act(() => socket.open());
  const status = (patch: Partial<ComputerStatus>) =>
    act(() => socket.receive({ type: "status", status: { ...base, ...patch } }));
  return { socket, status };
}

beforeEach(() => {
  // The secret box's dialog; happy-dom may not implement the modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

describe("ComputerPanel", () => {
  it("connects to the agent's screen and rests until a picture arrives", () => {
    sockets = fakeSockets();
    render(<ComputerPanel agentId="steward" openSocket={sockets.open} />);
    expect(sockets.latest.url).toMatch(/\/ws\/computer\/steward$/);
    expect(screen.getByText("Steward's computer is resting. It wakes when Steward needs it.")).toBeTruthy();
    expect(screen.getByText("Connecting…")).toBeTruthy();
  });

  it("names whose computer it is everywhere, not always Steward", () => {
    sockets = fakeSockets();
    render(<ComputerPanel agentId="bot1" name="Focus time guard" openSocket={sockets.open} />);
    expect(sockets.latest.url).toMatch(/\/ws\/computer\/bot1$/);
    expect(screen.getByRole("heading", { name: "Focus time guard's computer" })).toBeTruthy();
    expect(
      screen.getByText("Focus time guard's computer is resting. It wakes when Focus time guard needs it."),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /^Focus time guard's screen, live\. Focus time guard is driving/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(
      screen.getByText("Nothing yet. What Focus time guard does on its computer shows up here."),
    ).toBeTruthy();
  });

  it("opens on the tab and file it is asked to", () => {
    sockets = fakeSockets();
    render(
      <ComputerPanel
        agentId="steward"
        initialTab="files"
        highlightFile="report.md"
        openSocket={sockets.open}
      />,
    );
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("report.md").closest("li")?.getAttribute("aria-current")).toBe("true");
  });

  it("shows where the screen is and that it is live", () => {
    const { status } = setup();
    status({});
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("news.ycombinator.com/news")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Steward is driving/ })).toBeTruthy();
  });

  it("hides the resting note once a frame arrives", () => {
    const { socket, status } = setup();
    status({});
    expect(screen.queryByText(/Waiting for the first picture/)).toBeTruthy();
    act(() => socket.receive({ type: "frame", data: "AAAA", mime: "image/jpeg", width: 1280, height: 800 }));
    expect(screen.queryByText(/Waiting for the first picture/)).toBeNull();
  });

  it("asks for help with a banner, and Take the wheel sends take", () => {
    const { socket, status } = setup();
    status({ help: { reason: "A sign-in page needs you.", requestedAt: new Date().toISOString() } });
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Steward needs you:");
    expect(banner.textContent).toContain("A sign-in page needs you.");
    fireEvent.click(within(banner).getByRole("button", { name: "Take the wheel" }));
    expect(socket.sent).toContainEqual({ type: "take" });
  });

  it("while the person drives, forwards clicks and keys at page coordinates, and Hand back releases", () => {
    const { socket, status } = setup();
    status({ controller: "person" });
    const canvas = screen.getByRole("application", { name: /You have control/ }) as HTMLCanvasElement;
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 640,
        height: 400,
        right: 640,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(canvas, { clientX: 320, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 200, button: 0, pointerId: 1 });
    expect(socket.sent).toContainEqual({ type: "mouse", action: "down", x: 640, y: 400, button: "left" });
    expect(socket.sent).toContainEqual({ type: "mouse", action: "up", x: 640, y: 400, button: "left" });

    fireEvent.keyDown(canvas, { key: "h" });
    expect(socket.sent).toContainEqual({ type: "key", action: "down", key: "h", text: "h" });

    // Escape leaves the screen for the Hand back button, and is not sent.
    const before = socket.sent.length;
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(socket.sent).toHaveLength(before);
    const handBack = screen.getByRole("button", { name: "Hand back" });
    expect(document.activeElement).toBe(handBack);

    fireEvent.click(handBack);
    expect(socket.sent).toContainEqual({ type: "release" });
  });

  describe("pasting, scrolling and leaving the screen", () => {
    function driving() {
      const { socket, status } = setup();
      status({ controller: "person" });
      const canvas = screen.getByRole("application", { name: /You have control/ }) as HTMLCanvasElement;
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400, x: 0, y: 0 }) as DOMRect;
      const texts = () => socket.sent.filter((message) => message.type === "text");
      return { socket, canvas, texts };
    }
    const paste = (canvas: HTMLElement, text: string) =>
      fireEvent.paste(canvas, { clipboardData: { getData: () => text } });

    it("types a long paste as several messages the server accepts", () => {
      const { canvas, texts } = driving();
      const text = "x".repeat(20_000);
      paste(canvas, text);
      const sent = texts().map((message) => (message.type === "text" ? message.text : ""));
      expect(sent.map((part) => part.length)).toEqual([8000, 8000, 4000]);
      expect(sent.join("")).toBe(text);
    });

    it("says so, and types nothing, when a paste is far too long", () => {
      const { canvas, texts } = driving();
      paste(canvas, "x".repeat(70_000));
      expect(texts()).toEqual([]);
      expect(screen.getByText(/That's too much to paste at once/)).toBeTruthy();
    });

    it("sends one wheel message a frame, with the movement added up", () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
      try {
        const { socket, canvas } = driving();
        for (const deltaY of [10, 20, 30]) {
          // happy-dom's WheelEvent drops the pointer position, so the fields are set by hand.
          const wheel = Object.assign(new Event("wheel", { bubbles: true, cancelable: true }), {
            clientX: 320,
            clientY: 200,
            deltaX: 0,
            deltaY,
          });
          canvas.dispatchEvent(wheel);
        }
        const wheels = () => socket.sent.filter((message) => message.type === "wheel");
        expect(wheels()).toEqual([]);
        act(() => {
          for (const frame of frames.splice(0)) frame(0);
        });
        expect(wheels()).toEqual([{ type: "wheel", x: 640, y: 400, deltaX: 0, deltaY: 60 }]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("leaves the screen on Escape without the key reaching what holds it, such as a sheet", () => {
      const { canvas } = driving();
      const outer = vi.fn();
      document.body.addEventListener("keydown", outer);
      try {
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        canvas.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(outer).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Hand back" }));
      } finally {
        document.body.removeEventListener("keydown", outer);
      }
    });
  });

  describe("what is held down on Steward's browser", () => {
    function driving() {
      const { socket, status } = setup();
      status({ controller: "person" });
      const canvas = screen.getByRole("application", { name: /You have control/ }) as HTMLCanvasElement;
      // The canvas is 640x400 and shows the 1280x800 page at half size, filling it.
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400, x: 0, y: 0 }) as DOMRect;
      canvas.focus();
      const ups = () =>
        socket.sent.filter(
          (message) => (message.type === "mouse" || message.type === "key") && message.action === "up",
        );
      return { socket, status, canvas, ups };
    }

    it("lets a button go even when it is released outside the picture", () => {
      const { canvas, ups } = driving();
      fireEvent.pointerDown(canvas, { clientX: 320, clientY: 200, button: 0, pointerId: 1 });
      fireEvent.pointerUp(canvas, { clientX: 900, clientY: 650, button: 0, pointerId: 1 });
      expect(ups()).toEqual([{ type: "mouse", action: "up", x: 1279, y: 799, button: "left" }]);
    });

    it("lets go of held modifiers and buttons when the window loses focus", () => {
      const { canvas, ups } = driving();
      fireEvent.keyDown(canvas, { key: "Meta", metaKey: true });
      fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, button: 0, pointerId: 1 });
      // Cmd+Tab: the keyup goes to another app.
      fireEvent.blur(window);
      expect(ups()).toEqual([
        { type: "mouse", action: "up", x: 200, y: 100, button: "left" },
        { type: "key", action: "up", key: "Meta" },
      ]);
      // Nothing is let go twice.
      fireEvent.blur(canvas);
      expect(ups()).toHaveLength(2);
    });

    it("lets go when the screen loses focus or the tab is hidden", () => {
      const { canvas, ups } = driving();
      fireEvent.keyDown(canvas, { key: "Shift", shiftKey: true });
      fireEvent.blur(canvas);
      expect(ups()).toEqual([{ type: "key", action: "up", key: "Shift" }]);

      fireEvent.keyDown(canvas, { key: "Alt", altKey: true });
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      fireEvent(document, new Event("visibilitychange"));
      hidden.mockRestore();
      expect(ups()).toContainEqual({ type: "key", action: "up", key: "Alt" });
    });

    it("lets go of the button, not the keys, when the pointer is cancelled", () => {
      const { canvas, ups } = driving();
      fireEvent.keyDown(canvas, { key: "Shift", shiftKey: true });
      fireEvent.pointerDown(canvas, { clientX: 320, clientY: 200, button: 0, pointerId: 1 });
      fireEvent.pointerCancel(canvas, { pointerId: 1 });
      expect(ups()).toEqual([{ type: "mouse", action: "up", x: 640, y: 400, button: "left" }]);
    });

    it("lets go of everything when driving ends", () => {
      const { canvas, status, ups } = driving();
      fireEvent.keyDown(canvas, { key: "Control", ctrlKey: true });
      status({ controller: "agent" });
      expect(ups()).toContainEqual({ type: "key", action: "up", key: "Control" });
    });
  });

  it("ignores input while Steward drives", () => {
    const { socket, status } = setup();
    status({});
    const canvas = screen.getByRole("img", { name: /Steward is driving/ });
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.keyDown(canvas, { key: "a" });
    expect(socket.sent).toEqual([]);
  });

  it("lists activity as it happens", () => {
    const { socket } = setup();
    const item: ActivityItem = {
      id: "act_1",
      at: new Date().toISOString(),
      agentId: "steward",
      kind: "navigate",
      text: "Opened news.ycombinator.com",
      ok: true,
    };
    act(() => socket.receive({ type: "activity", item }));
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByText("Opened news.ycombinator.com")).toBeTruthy();
  });

  it("lists the workspace files", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByText("report.md")).toBeTruthy();
  });

  describe("the secret box", () => {
    const secret = {
      id: "sec_1",
      ref: "e7",
      label: "Password for example.com",
      host: "example.com",
      requestedAt: new Date().toISOString(),
    };

    it("sends the value once, then empties the field and keeps it nowhere", () => {
      const { socket, status } = setup();
      status({ secret });
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain("example.com");
      const field = within(dialog).getByLabelText("Password for example.com") as HTMLInputElement;
      expect(field.type).toBe("password");

      field.value = "correct horse battery staple";
      const sendButton = within(dialog).getByRole("button", { name: "Send to the page" });
      fireEvent.click(sendButton);

      const secrets = socket.sent.filter((message) => message.type === "secret");
      expect(secrets).toEqual([
        { type: "secret", requestId: "sec_1", value: "correct horse battery staple" },
      ]);
      expect(field.value).toBe("");
      expect(document.body.innerHTML).not.toContain("correct horse battery staple");
      expect(within(dialog).getByText("Sent to the page. Waiting for it to fill in…")).toBeTruthy();

      // A second press, or a second submit, sends nothing more.
      field.value = "again";
      fireEvent.click(sendButton);
      fireEvent.submit(field.closest("form")!);
      expect(socket.sent.filter((message) => message.type === "secret")).toHaveLength(1);

      // The page filled; the request clears and the box closes.
      status({ secret: undefined });
      expect(screen.queryByText("Sent to the page. Waiting for it to fill in…")).toBeNull();
    });

    it("refuses to send nothing", () => {
      const { socket, status } = setup();
      status({ secret });
      fireEvent.click(screen.getByRole("button", { name: "Send to the page" }));
      expect(screen.getByText("Type it in first.")).toBeTruthy();
      expect(socket.sent.filter((message) => message.type === "secret")).toHaveLength(0);
    });

    it("cancels the request", () => {
      const { socket, status } = setup();
      status({ secret });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(socket.sent).toContainEqual({ type: "secret.cancel", requestId: "sec_1" });
    });

    it("clears the field even when the screen is not connected, and says nothing was sent", () => {
      const { socket, status } = setup();
      status({ secret });
      act(() => socket.drop());
      const dialog = screen.getByRole("dialog");
      const field = within(dialog).getByLabelText("Password for example.com") as HTMLInputElement;
      field.value = "s3cret";
      fireEvent.submit(field.closest("form")!);
      expect(field.value).toBe("");
      expect(within(dialog).getByRole("alert").textContent).toContain("nothing was sent");
      expect(socket.sent.filter((message) => message.type === "secret")).toHaveLength(0);
    });
  });
});
