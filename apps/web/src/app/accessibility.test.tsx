import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESSIBILITY_STORAGE_KEY,
  type AccessibilityContextValue,
  AccessibilityProvider,
  PLAIN_LANGUAGE_SAVE_FAILED,
  useAccessibility,
} from "./accessibility.tsx";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

let current: AccessibilityContextValue | undefined;

function Probe() {
  current = useAccessibility();
  return <p>Theme is {current.resolvedTheme}</p>;
}

const html = () => document.documentElement;

function resetHtml() {
  for (const name of ["data-text", "data-contrast", "data-motion", "data-theme", "data-font"]) {
    html().removeAttribute(name);
  }
  html().classList.remove("dark");
}

beforeEach(() => {
  localStorage.clear();
  resetHtml();
  current = undefined;
  toastError.mockClear();
});

afterEach(() => {
  cleanup();
  resetHtml();
});

describe("AccessibilityProvider", () => {
  it("leaves <html> at the defaults when nothing is chosen", () => {
    render(
      <AccessibilityProvider savePlainLanguage={async () => {}}>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(html().hasAttribute("data-text")).toBe(false);
    expect(html().hasAttribute("data-contrast")).toBe(false);
    expect(html().hasAttribute("data-theme")).toBe(false);
    expect(current?.textSize).toBe(100);
  });

  it("writes each setting to <html> and remembers it", () => {
    render(
      <AccessibilityProvider savePlainLanguage={async () => {}}>
        <Probe />
      </AccessibilityProvider>,
    );
    act(() => current!.setTextSize(130));
    act(() => current!.setContrast("more"));
    act(() => current!.setMotion("reduce"));
    act(() => current!.setTheme("dark"));
    act(() => current!.setFont("readable"));

    expect(html().dataset.text).toBe("130");
    expect(html().dataset.contrast).toBe("more");
    expect(html().dataset.motion).toBe("reduce");
    expect(html().dataset.theme).toBe("dark");
    expect(html().dataset.font).toBe("readable");
    expect(html().classList.contains("dark")).toBe(true);
    expect(screen.getByText("Theme is dark")).toBeTruthy();
    expect(current?.reducedMotion).toBe(true);

    const stored = JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? "{}");
    expect(stored).toMatchObject({
      textSize: 130,
      contrast: "more",
      motion: "reduce",
      theme: "dark",
      font: "readable",
    });

    act(() => current!.setTheme("light"));
    expect(html().dataset.theme).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);

    act(() => current!.reset());
    expect(html().hasAttribute("data-text")).toBe(false);
    expect(html().hasAttribute("data-contrast")).toBe(false);
  });

  it("starts from what this browser remembered", () => {
    localStorage.setItem(
      ACCESSIBILITY_STORAGE_KEY,
      JSON.stringify({ textSize: 150, contrast: "more", theme: "nonsense" }),
    );
    render(
      <AccessibilityProvider savePlainLanguage={async () => {}}>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(current?.textSize).toBe(150);
    expect(current?.theme).toBe("system");
    expect(html().dataset.text).toBe("150");
    expect(html().dataset.contrast).toBe("more");
  });

  it("saves plain language for the agent too", () => {
    const save = vi.fn(async () => {});
    render(
      <AccessibilityProvider savePlainLanguage={save}>
        <Probe />
      </AccessibilityProvider>,
    );
    act(() => current!.setPlainLanguage(true));
    expect(save).toHaveBeenCalledWith(true);
    expect(current?.plainLanguage).toBe(true);
    act(() => current!.setReadAloud(true));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("shows the server's plain language, even after other settings changed here", () => {
    const { rerender } = render(
      <AccessibilityProvider savePlainLanguage={async () => {}} serverPlainLanguage={false}>
        <Probe />
      </AccessibilityProvider>,
    );
    act(() => current!.setTextSize(130));
    rerender(
      <AccessibilityProvider savePlainLanguage={async () => {}} serverPlainLanguage={true}>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(current?.plainLanguage).toBe(true);
    // This browser keeps no copy of its own that could outvote the server later.
    expect(JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? "{}")).not.toHaveProperty(
      "plainLanguage",
    );
  });

  it("ignores a plain-language value an older version stored in this browser", () => {
    localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify({ plainLanguage: true }));
    render(
      <AccessibilityProvider savePlainLanguage={async () => {}} serverPlainLanguage={false}>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(current?.plainLanguage).toBe(false);
  });

  it("puts the switch back and says so when the save fails", async () => {
    let fail: (reason: unknown) => void = () => {};
    const save = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    render(
      <AccessibilityProvider savePlainLanguage={save} serverPlainLanguage={false}>
        <Probe />
      </AccessibilityProvider>,
    );
    act(() => current!.setPlainLanguage(true));
    // While the save is on its way, the switch shows the choice.
    expect(current?.plainLanguage).toBe(true);
    await act(async () => fail(new Error("offline")));
    expect(current?.plainLanguage).toBe(false);
    expect(toastError).toHaveBeenCalledWith(PLAIN_LANGUAGE_SAVE_FAILED);
  });

  it("keeps a saved choice until the server's value catches up, then follows the server", async () => {
    const save = vi.fn(async () => {});
    const { rerender } = render(
      <AccessibilityProvider savePlainLanguage={save} serverPlainLanguage={false}>
        <Probe />
      </AccessibilityProvider>,
    );
    await act(async () => current!.setPlainLanguage(true));
    expect(current?.plainLanguage).toBe(true);
    rerender(
      <AccessibilityProvider savePlainLanguage={save} serverPlainLanguage={true}>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(current?.plainLanguage).toBe(true);
    // Changed later on another device: this one follows.
    rerender(
      <AccessibilityProvider savePlainLanguage={save} serverPlainLanguage={false}>
        <Probe />
      </AccessibilityProvider>,
    );
    expect(current?.plainLanguage).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not save plain language when it is not changing", () => {
    const save = vi.fn(async () => {});
    render(
      <AccessibilityProvider savePlainLanguage={save} serverPlainLanguage={false}>
        <Probe />
      </AccessibilityProvider>,
    );
    act(() => current!.reset());
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses to work outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside <AccessibilityProvider>/);
    spy.mockRestore();
  });
});
