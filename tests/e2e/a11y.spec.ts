import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/** Every place in the app. Each must have exactly one h1, so a screen reader user knows where they are. */
const PAGES = [
  "/",
  "/chat",
  "/tasks",
  "/computer",
  "/routines",
  "/rules",
  "/record",
  "/connections",
  "/skills",
  "/memory",
  "/settings",
  "/welcome",
];

/** True when the focused element draws a visible focus indicator: an outline or a ring. */
async function focusIsVisible(page: Page): Promise<{ visible: boolean; what: string }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return { visible: false, what: "nothing" };
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    const ring = style.boxShadow !== "none" && style.boxShadow !== "";
    const box = el.getBoundingClientRect();
    const what = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
    return { visible: (outline || ring) && box.width > 0 && box.height > 0, what };
  });
}

test.describe("Accessibility", () => {
  test("the skip link is the first stop and jumps past the navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    // After skipping, the next stop is inside the main content, not the navigation.
    const insideMain = await page.evaluate(() => {
      const main = document.querySelector("main");
      return Boolean(main && document.activeElement && main.contains(document.activeElement));
    });
    expect(insideMain, "the first Tab after the skip link should land inside <main>").toBe(true);
  });

  test("the frame has one main landmark and a labelled navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Today/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  for (const path of PAGES) {
    test(`${path} has exactly one h1`, async ({ page }) => {
      await page.goto(path);
      // Pages load lazily; wait for the heading rather than for the network.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("");
    });
  }

  test("keyboard focus is always visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const focus = await focusIsVisible(page);
      expect(focus.visible, `focus indicator on Tab ${i + 1} (${focus.what})`).toBe(true);
    }
  });

  test("text can be made larger and the page still has one h1", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // The text size setting is applied to <html> before first paint; check that it sticks across a reload.
    await page.evaluate(() => {
      window.localStorage.setItem("steward.accessibility", JSON.stringify({ textSize: 150 }));
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-text", "150");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("no serious axe violations on the main pages", async ({ page }) => {
    // Optional: runs when @axe-core/playwright is installed, and says so when it is not.
    const moduleName = "@axe-core/playwright";
    const axe = await import(moduleName).catch(() => undefined);
    test.skip(!axe, "Install @axe-core/playwright to run the automated axe checks.");

    for (const path of ["/", "/chat", "/tasks", "/rules", "/record", "/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const results = await new axe.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const serious = results.violations.filter(
        (v: { impact?: string }) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v: { id: string; help: string }) => `${path}: ${v.id} (${v.help})`),
        `axe found serious problems on ${path}`,
      ).toEqual([]);
    }
  });
});
