import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteChrome } from "@/components/site/SiteChrome";
import { PLAIN_KEY, TEXT_SIZE_KEY, resetPrefsCache, setPrefs } from "@/lib/a11y-prefs";
import { expectNoA11yViolations } from "./a11y";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-text-size");
  document.documentElement.removeAttribute("data-plain");
  resetPrefsCache();
});

test("the skip link targets the main landmark, and the nav marks the current page", async () => {
  const { container } = render(
    <SiteChrome pathname="/profiles"><p>Page body</p></SiteChrome>,
  );

  expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main");
  expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  expect(screen.getByRole("link", { name: "Profiles" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Scam Shield" })).toHaveAttribute("href", "/shield");
  expect(screen.getByRole("link", { name: "Mission Control" })).toHaveAttribute("href", "/control");
  await expectNoA11yViolations(container);
});

test("Mission Control keeps its own <main>: the chrome wraps /control in a plain container", () => {
  render(<SiteChrome pathname="/control"><main>Mission Control</main></SiteChrome>);

  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(document.getElementById("main")?.tagName).toBe("DIV");
});

test("text size persists in localStorage and on <html>, and survives a remount", async () => {
  render(<SiteChrome pathname="/"><p>Body</p></SiteChrome>);

  await userEvent.click(screen.getByRole("button", { name: "Large text" }));

  expect(window.localStorage.getItem(TEXT_SIZE_KEY)).toBe("large");
  expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
  expect(screen.getByRole("button", { name: "Large text" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Large text on.");

  cleanup();
  resetPrefsCache();
  render(<SiteChrome pathname="/"><p>Body</p></SiteChrome>);

  expect(screen.getByRole("button", { name: "Large text" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Normal text" })).toHaveAttribute("aria-pressed", "false");
});

test("plain mode toggles data-plain and is announced", async () => {
  render(<SiteChrome pathname="/"><p>Body</p></SiteChrome>);
  const plain = screen.getByRole("button", { name: "Plain mode" });

  await userEvent.click(plain);
  expect(document.documentElement.hasAttribute("data-plain")).toBe(true);
  expect(window.localStorage.getItem(PLAIN_KEY)).toBe("1");
  expect(plain).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Plain mode on");

  await userEvent.click(plain);
  expect(document.documentElement.hasAttribute("data-plain")).toBe(false);
  expect(plain).toHaveAttribute("aria-pressed", "false");
});

test("a locked-down browser without storage still applies the setting to the page", () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  try {
    setPrefs({ textSize: "larger" });
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
  } finally {
    Storage.prototype.setItem = original;
  }
});
