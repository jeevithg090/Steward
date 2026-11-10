import type { Locator, Page } from "@playwright/test";
import { type DisplaySettings, expectNoSeriousAxe, useDisplaySettings } from "./axe.ts";
import { expect, openNewChat, test } from "./fixtures.ts";

/**
 * The display settings a person can choose, and the ones their system can choose for them: dark,
 * more contrast, the largest text, forced colours (Windows High Contrast) and a 320 px screen.
 * The main pages are audited in each, since a colour or a layout that only one of them uses is
 * exactly what an audit in the defaults misses.
 */

const MAIN_PAGES = ["/", "/chat", "/tasks", "/rules", "/record", "/connections", "/settings"];

const VARIANTS: { name: string; settings: DisplaySettings; colorScheme?: "light" | "dark" }[] = [
  { name: "dark", settings: { theme: "dark" }, colorScheme: "dark" },
  { name: "more contrast", settings: { contrast: "more" } },
  { name: "more contrast, dark", settings: { contrast: "more", theme: "dark" }, colorScheme: "dark" },
  { name: "150% text", settings: { textSize: 150 } },
];

for (const variant of VARIANTS) {
  test.describe(`Audit in ${variant.name}`, () => {
    if (variant.colorScheme) test.use({ colorScheme: variant.colorScheme });

    test(`no serious axe violations on the main pages in ${variant.name}`, async ({ page }) => {
      await useDisplaySettings(page, variant.settings);
      for (const path of MAIN_PAGES) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expectNoSeriousAxe(page, `${path} (${variant.name})`);
      }
    });
  });
}

test.describe("The system's own settings", () => {
  test("Increase contrast on the device turns on the stronger colours", async ({ page }) => {
    await page.emulateMedia({ contrast: "more" });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
    // The choice says the device decides, so the screen and the setting agree.
    await expect(
      page.getByRole("group", { name: "Contrast" }).getByRole("radio", { name: "Match this device" }),
    ).toBeChecked();
  });
});

/** A computed style of the element, read in the page. */
function style(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
}

/** The colour the system uses for the page itself, to tell a drawn state from an empty one. */
function canvas(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * The background a person sees behind the element: its own, or the page's where it has none.
 * Forced colours keep a background's transparency, so a tint becomes the page's own colour, and
 * comparing two computed values would see a difference nobody can.
 */
async function seenBackground(locator: Locator): Promise<string> {
  const own = await style(locator, "background-color");
  return own === "transparent" || /,\s*0\)$/.test(own) ? canvas(locator.page()) : own;
}

test.describe("Forced colours (Windows High Contrast)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
  });

  test("switches keep their track and show whether they are on", async ({ page }) => {
    await page.goto("/settings");
    const toggle = page.getByRole("switch", { name: "Keyboard shortcuts" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const track = toggle.locator("span").first();
    const knob = toggle.locator("span").last();
    expect(await style(track, "border-top-style")).toBe("solid");
    const page_ = await canvas(page);
    const onTrack = await style(track, "background-color");
    expect(onTrack, "an on switch fills its track").not.toBe(page_);
    expect(await style(knob, "background-color")).not.toBe(onTrack);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await style(track, "background-color"), "an off switch has an empty track").not.toBe(onTrack);
    expect(await style(knob, "background-color"), "an off switch still shows its knob").not.toBe(page_);
    await toggle.click();
  });

  test("text fields, the chosen tile and cards keep their edges", async ({ page }) => {
    await page.goto("/rules");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const field = page.getByRole("main").getByRole("textbox").first();
    expect(await style(field, "border-top-style")).toBe("solid");

    await page.goto("/settings");
    const sizes = page.getByRole("group", { name: "Text size" });
    const chosen = sizes.getByRole("radio", { name: /^Standard/ }).locator("xpath=..");
    const other = sizes.getByRole("radio", { name: /^Large / }).locator("xpath=..");
    expect(await style(chosen, "border-top-style")).toBe("solid");
    expect(await style(chosen, "border-top-color"), "the chosen tile stands out").not.toBe(
      await style(other, "border-top-color"),
    );

    const card = page.getByRole("region", { name: "Accessibility" });
    expect(await style(card, "outline-style")).toBe("solid");
  });

  test("the selected tab and the current place stand out", async ({ page }) => {
    await page.goto("/tasks");
    const selected = page.getByRole("tab", { selected: true });
    const other = page.getByRole("tab", { selected: false }).first();
    await expect(selected).toBeVisible();
    const page_ = await canvas(page);
    expect(await seenBackground(selected), "the selected tab is filled").not.toBe(page_);
    expect(await seenBackground(other), "another tab is not").toBe(page_);

    const nav = page.getByRole("navigation", { name: "Main" });
    const current = nav.getByRole("link", { name: /Tasks/ });
    await expect(current).toHaveAttribute("aria-current", "page");
    expect(await seenBackground(current), "the current place is filled").not.toBe(page_);
    expect(await seenBackground(nav.getByRole("link", { name: /Rules/ })), "another is not").toBe(page_);
  });

  test("focus is visible in the composer", async ({ page }) => {
    await page.goto("/chat");
    const composer = page.getByRole("textbox", { name: /^Message / });
    await composer.focus();
    expect(await style(composer, "outline-style")).toBe("solid");
  });
});

test.describe("Reflow", () => {
  // 320 px is WCAG's reflow width (1.4.10). At 150% text, 480 px gives the same room in rem, which
  // is what every size in the app is measured in.
  for (const { width, textSize } of [
    { width: 320, textSize: 100 },
    { width: 480, textSize: 150 },
  ] as const) {
    test(`nothing scrolls sideways on the main pages at ${width} px and ${textSize}% text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await useDisplaySettings(page, { textSize });
      for (const path of MAIN_PAGES) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(wide, `${path} is ${wide} px wide`).toBeLessThanOrEqual(width);
      }
    });
  }

  for (const width of [320, 390]) {
    test(`at ${width} px and the largest text, the tab bar's words do not run into each other`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await useDisplaySettings(page, { textSize: 150, font: "readable" });
      await page.goto("/");
      const bar = page.getByRole("navigation", { name: "Main" });
      await expect(bar).toBeVisible();
      const overflowing = await bar.evaluate((nav) =>
        [...nav.querySelectorAll("li > *")]
          .filter((el) => el.scrollWidth > el.clientWidth)
          .map((el) => el.textContent?.trim()),
      );
      expect(overflowing).toEqual([]);
    });
  }
});

test.describe("The chat at the largest text on a laptop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // The shell moves to its phone layout at 150% text on a 1280 px screen, but the chat still
  // measures its own fixed 64rem: it draws the desktop computer panel and pins the composer under
  // the shell's tab bar. Fixed when ChatThread takes `useWideLayout()` from app/layout-mode.ts
  // (handed to the web-chat track); remove `fixme` then.
  test.fixme("follows the shell's phone layout", async ({ page }) => {
    await useDisplaySettings(page, { textSize: 150 });
    await openNewChat(page);
    const bar = page.getByRole("navigation", { name: "Main" });
    await expect(bar).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Steward's computer" })).toHaveCount(0);
    await page.mouse.wheel(0, -2000);
    const send = page.getByRole("main").getByRole("button", { name: "Send", exact: true });
    const sendBox = await send.boundingBox();
    const barBox = await bar.boundingBox();
    expect(sendBox && barBox && sendBox.y + sendBox.height <= barBox.y).toBe(true);
  });
});
