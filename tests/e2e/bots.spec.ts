import type { APIRequestContext, Page } from "@playwright/test";
import { expect, openNewChat, test } from "./fixtures.ts";

/**
 * The bot directory, end to end with the scripted model: the page lists the directory, a listing
 * says what the bot may do, Add puts it under Installed and offers it in a new conversation.
 *
 * The run reads its own small directory (tests/e2e/fixtures/directory, set in playwright.config.ts),
 * not the 1,251 bots that ship with Steward, so a new or retired shelf bot never changes what is
 * tested. One of its bots has a name with `+`, `(` and `)`, which a careless pattern would misread.
 */

/** The fixture bot under test. Its pack is tests/e2e/fixtures/directory/packs/e2e-code-reviewer.json. */
const BOT = { id: "e2e-code-reviewer", name: "C++ (and Rust) reviewer" };

/** Removes these bots whether or not they are installed, so a retry starts from the directory alone. */
async function removeBots(api: APIRequestContext, ids: Iterable<string>): Promise<void> {
  for (const id of ids) {
    const res = await api.delete(`/api/bots/installed/${encodeURIComponent(id)}`);
    expect([200, 204, 404], `removing ${id} answered ${res.status()}`).toContain(res.status());
  }
}

/** The cards under Browse (or Results), which exclude Make a bot. */
function browseCards(page: Page) {
  return page
    .getByRole("region", { name: /^(Browse|Results)$/ })
    .getByRole("article")
    .filter({ hasNot: page.getByRole("heading", { name: "Make a bot" }) });
}

test.describe("Bots", () => {
  test.beforeEach(async ({ api }) => {
    await removeBots(api, [BOT.id]);
  });
  test.afterEach(async ({ api }) => {
    await removeBots(api, [BOT.id]);
  });

  test("the directory lists bots, a listing says what a bot may do, and Add makes it a choice", async ({
    page,
  }) => {
    await page.goto("/bots");
    await expect(page.getByRole("heading", { level: 1, name: "Bots" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "What do you need a bot for?" })).toBeVisible();

    // The fixture directory's two bots, and nothing from the shelf that ships with Steward.
    await expect(browseCards(page)).toHaveCount(2);
    const card = browseCards(page).filter({
      has: page.getByRole("heading", { level: 3, name: BOT.name, exact: true }),
    });
    await expect(card).toHaveCount(1);
    // Every card says who made it: a person, or "AI-made".
    await expect(card.getByText("by steward-e2e", { exact: true })).toBeVisible();

    // The listing page.
    const view = card.getByRole("link", { name: `View ${BOT.name}`, exact: true });
    await expect(view).toHaveAttribute("href", `/bots/${BOT.id}`);
    await view.click();
    await expect(page.getByRole("heading", { level: 1, name: BOT.name, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "What it needs" })).toBeVisible();
    await expect(page.getByRole("region", { name: "What it may do without asking" })).toBeVisible();
    await expect(page.getByRole("region", { name: "What it asks before" })).toContainText(/paying|sending/i);
    await expect(page.getByRole("region", { name: "Who made it" })).toBeVisible();

    // Add, from the listing.
    const add = page.getByRole("button", { name: "Add to Steward" });
    await expect(add).toBeEnabled({ timeout: 30_000 });
    await add.click();
    await expect(page.getByText("Installed", { exact: true })).toBeVisible();
    await page.goto("/bots");

    // Under Installed, with a version and a way to remove it.
    const installed = page.getByRole("region", { name: "Installed" });
    const row = installed.getByRole("article", { name: BOT.name, exact: true });
    await expect(row).toBeVisible();
    await expect(row.getByText(/^Version \d+$/)).toBeVisible();
    await expect(row.getByRole("button", { name: `Remove ${BOT.name}`, exact: true })).toBeVisible();

    // A choice in a new conversation, with the model it runs on under its name.
    await openNewChat(page);
    const picker = page.getByRole("group", { name: "Who should take this?" });
    await expect(picker).toBeVisible();
    const choice = picker.getByRole("radio", { name: `${BOT.name} (bot)`, exact: true });
    await expect(choice).toHaveCount(1);
    await expect(choice).toHaveAccessibleDescription(/Scripted demo model/);
    // Picking a bot starts a fresh conversation with it: a new address, not the empty one.
    const before = page.url();
    // A click, not check(): choosing moves straight to a new conversation, so the radio never stays set here.
    await choice.click();
    await page.waitForURL((url) => /\/chat\/[^/?#]+/.test(url.pathname) && url.href !== before);
    await expect(
      page.getByRole("heading", { level: 2, name: `What can ${BOT.name} do for you` }),
    ).toBeVisible();
  });

  test("Make a bot ends with Submit to the directory, which downloads the pack folder", async ({ page }) => {
    await page.goto("/bots");
    await page.getByRole("button", { name: "Make a bot" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Make a bot" });
    await dialog
      .getByRole("textbox", { name: /^What should it do/ })
      .fill("Share out the week's chores fairly.");
    await dialog.getByRole("button", { name: "Write the bot" }).click();
    const made = page.getByRole("dialog");
    const submit = made.getByRole("region", { name: "Submit to the directory" });
    await expect(submit).toBeVisible({ timeout: 60_000 });
    // The run's own directory is a folder on this machine, which takes no submissions.
    await expect(submit.getByRole("note")).toContainText(/takes no submissions/);
    await submit.getByRole("textbox", { name: /Your GitHub handle/ }).fill("ana-b");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      submit.getByRole("button", { name: "Download the pack folder" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^[a-z0-9-]+\.zip$/);
    const path = await download.path();
    const bytes = await import("node:fs/promises").then((fs) => fs.readFile(path));
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const text = bytes.toString("utf8");
    expect(text).toContain("/bot.yaml");
    expect(text).toContain("handle: ana-b");
    await expect(submit.getByRole("status")).toContainText(/Saved .+\.zip/);
  });

  test("a bot cannot be added from a plain http address", async ({ page }) => {
    await page.goto("/bots/add?pack=http%3A%2F%2Fevil.example%2Fpacks%2Fx.json");
    await expect(page.getByRole("alert")).toContainText(/only adds bots from https addresses/i);
    await expect(page.getByRole("button", { name: "Add to Steward" })).toHaveCount(0);
  });

  test("no serious axe violations on the Bots page", async ({ page }) => {
    const moduleName = "@axe-core/playwright";
    const axe = await import(moduleName).catch(() => undefined);
    test.skip(!axe, "Install @axe-core/playwright to run the automated axe checks.");

    await page.goto("/bots");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("region", { name: /^(Browse|Results)$/ })).toBeVisible();
    const results = await new axe.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations.filter(
      (v: { impact?: string }) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v: { id: string; help: string }) => `/bots: ${v.id} (${v.help})`),
      "axe found serious problems on /bots",
    ).toEqual([]);
  });
});
