import type { Page } from "@playwright/test";
import { expectNoSeriousAxe } from "./axe.ts";
import { expect, openNewChat, sendMessage, test } from "./fixtures.ts";

/** Every place in the app. Each must have exactly one h1, so a screen reader user knows where they are. */
const PAGES = [
  "/",
  "/chat",
  "/bots",
  "/bots/add",
  "/bots/no-such-bot",
  "/tasks",
  "/computer",
  "/routines",
  "/rules",
  "/record",
  "/connections",
  "/skills",
  "/memory",
  "/shortcuts",
  "/settings",
  "/welcome",
  "/no-such-page",
];

/**
 * Known serious problems that another part of the work is fixing. Each names where. Remove an
 * entry once its fix lands; the audit then holds the line.
 */
const KNOWN = {
  // The transcript is an <ol role="log">, which takes the list role away from its items
  // (web-chat: qa:chat-log-breaks-list).
  chatLog: { listitem: "the transcript's <ol role=log> (qa:chat-log-breaks-list)" },
  // The built-in tools table scrolls sideways on a phone, but its scroller cannot take focus, so a
  // keyboard cannot scroll it (web-shell: ConnectionsPage, qa:forced-colors-invisible-controls).
  toolsTable: { "scrollable-region-focusable": "the built-in tools table's scroller on /connections" },
};

/** The places a person uses most, audited again on a phone, where the layout is a different one. */
const PHONE_PAGES = ["/", "/chat", "/tasks", "/rules", "/record", "/connections", "/settings"];

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
});

test.describe("Focus after navigation", () => {
  test("moving to another page puts focus on its heading, also on a page seen before", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });

    for (const [link, title] of [
      ["Rules", /Rules/],
      ["Record", /Record/],
      ["Rules", /Rules/],
    ] as const) {
      await nav.getByRole("link", { name: link, exact: true }).click();
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveText(title);
      // Well inside the shell's 700 ms fallback to <main>: the heading takes focus as it arrives.
      await expect(heading).toBeFocused({ timeout: 500 });
      await expect(page).toHaveTitle(new RegExp(`^${link} · `));
    }
  });

  test("a shortcut moves focus to the new page's heading too", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("k");
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused({ timeout: 500 });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("a place picked from More gets focus, not the More button", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const more = page.getByRole("button", { name: "More", exact: true });
      await more.click();
      const sheet = page.getByRole("dialog", { name: "More" });
      await sheet.getByRole("link", { name: "Rules", exact: true }).click();
      await expect(sheet).toBeHidden();
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveText(/Rules/);
      await expect(heading).toBeFocused();
      // And it stays there: nothing pulls it back once the sheet has gone.
      await page.waitForTimeout(800);
      await expect(heading).toBeFocused();
    });

    test("closing More without going anywhere gives focus back to More", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const more = page.getByRole("button", { name: "More", exact: true });
      await more.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(more).toBeFocused();
    });
  });
});

test.describe("Automated audit (axe)", () => {
  for (const path of PAGES) {
    test(`no serious axe violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expectNoSeriousAxe(page, path);
    });
  }

  test("no serious axe violations on a bot's listing", async ({ page }) => {
    await page.goto("/bots");
    // The bundled directory lists bots, so the first card leads to a listing.
    const card = page
      .getByRole("region", { name: /^(Browse|Results)$/ })
      .getByRole("article")
      .filter({ has: page.getByRole("link", { name: /^View / }) })
      .first();
    await card.getByRole("link", { name: /^View / }).click();
    await expect(page.getByRole("region", { name: "What it needs" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectNoSeriousAxe(page, "a bot's listing");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    for (const path of PHONE_PAGES) {
      test(`no serious axe violations on ${path} on a phone`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expectNoSeriousAxe(page, `${path} on a phone`, {
          waive: path === "/connections" ? KNOWN.toolsTable : undefined,
        });
      });
    }
  });

  test("no serious axe violations in a conversation with an approval waiting", async ({ page }) => {
    await openNewChat(page);
    await sendMessage(page, "Email sam@example.com about Friday: see you at 10");
    const main = page.getByRole("main");
    const refuse = main.getByRole("button", { name: "Refuse", exact: true }).first();
    await expect(refuse).toBeVisible({ timeout: 30_000 });
    // A reply and a card do not add a heading of their own at the top level.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectNoSeriousAxe(page, "a conversation with an approval", { waive: KNOWN.chatLog });
    // Leave nothing waiting for the specs that follow.
    await refuse.click();
    await expect(main.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
  });
});
