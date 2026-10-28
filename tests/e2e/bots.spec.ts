import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, openNewChat, test } from "./fixtures.ts";

/**
 * The bot directory, end to end with the scripted model: the page lists the bundled seed, a
 * listing says what the bot may do, Add puts it under Installed and offers it in a new
 * conversation. When the seed is empty (the directory is built by another step), the spec makes
 * one through Make a bot first, so it still checks the whole path.
 */

interface InstalledRow {
  id: string;
  name: string;
}

/** Removes every bot this run added, so the next spec starts from the seed alone. */
async function removeInstalled(api: APIRequestContext, ids: Set<string>): Promise<void> {
  const res = await api.get("/api/bots/installed");
  if (!res.ok()) return;
  const rows = (await res.json()) as InstalledRow[];
  for (const row of rows) {
    if (ids.has(row.id)) await api.delete(`/api/bots/installed/${encodeURIComponent(row.id)}`);
  }
}

/** The cards under Browse (or Results), which exclude Make a bot. */
function browseCards(page: Page): Locator {
  return page
    .getByRole("region", { name: /^(Browse|Results)$/ })
    .getByRole("article")
    .filter({ hasNot: page.getByRole("heading", { name: "Make a bot" }) });
}

/** Makes a bot through the dialog and adds it. Returns its name. */
async function makeAndAddBot(page: Page, job: string): Promise<string> {
  await page.getByRole("button", { name: "Make a bot" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Make a bot" });
  await dialog.getByRole("textbox", { name: /^What should it do/ }).fill(job);
  await dialog.getByRole("button", { name: "Write the bot" }).click();
  // The dialog is renamed after the bot once the pack is written.
  const made = page.getByRole("dialog");
  await expect(made.getByRole("heading", { name: /What it may do without asking/ })).toBeVisible({
    timeout: 60_000,
  });
  // With the scripted model the pack is a template, and the dialog says so.
  await expect(made.getByText(/made from a template/i)).toBeVisible();
  const name = (await made.getByRole("heading", { level: 2 }).first().textContent())?.trim() ?? "";
  await made.getByRole("button", { name: "Add to Steward" }).click();
  await expect(made.getByText("Installed", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(made).toBeHidden();
  return name;
}

test.describe("Bots", () => {
  const added = new Set<string>();

  test.afterEach(async ({ api }) => {
    await removeInstalled(api, added);
    added.clear();
  });

  test("the directory lists bots, a listing says what a bot may do, and Add makes it a choice", async ({
    page,
    api,
  }) => {
    await page.goto("/bots");
    await expect(page.getByRole("heading", { level: 1, name: "Bots" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "What do you need a bot for?" })).toBeVisible();

    // The bundled seed, or a bot made here when the seed is empty.
    const browse = page.getByRole("region", { name: /^(Browse|Results)$/ });
    await expect(browse).toBeVisible();
    await expect(browse.getByRole("article").first()).toBeVisible();
    let name: string;
    let viaDirectory = (await browseCards(page).count()) > 0;
    if (viaDirectory) {
      const card = browseCards(page).first();
      name = (await card.getByRole("heading", { level: 3 }).textContent())?.trim() ?? "";
      expect(name).not.toBe("");
      // Every card says who made it: a person, or "AI-made".
      await expect(card.getByText(/^(AI-made|by .+)$/)).toBeVisible();

      // The listing page.
      await card.getByRole("link", { name: `View ${name}` }).click();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page.getByRole("region", { name: "What it needs" })).toBeVisible();
      await expect(page.getByRole("region", { name: "What it may do without asking" })).toBeVisible();
      await expect(page.getByRole("region", { name: "What it asks before" })).toContainText(
        /paying|sending/i,
      );
      await expect(page.getByRole("region", { name: "Who made it" })).toBeVisible();

      // Add, from the listing.
      const add = page.getByRole("button", { name: "Add to Steward" });
      await expect(add).toBeEnabled({ timeout: 30_000 });
      await add.click();
      await expect(page.getByText("Installed", { exact: true })).toBeVisible();
      await page.goto("/bots");
    } else {
      name = await makeAndAddBot(
        page,
        "Plan a week of dinners for a family of four and write the shopping list.",
      );
      viaDirectory = false;
    }

    // Under Installed, with a version and a way to remove it.
    const installed = page.getByRole("region", { name: "Installed" });
    const row = installed.getByRole("article", { name });
    await expect(row).toBeVisible();
    await expect(row.getByText(/^Version \d+$/)).toBeVisible();
    await expect(row.getByRole("button", { name: `Remove ${name}` })).toBeVisible();

    const rows = (await (await api.get("/api/bots/installed")).json()) as InstalledRow[];
    for (const r of rows) if (r.name === name) added.add(r.id);
    expect(added.size).toBeGreaterThan(0);

    // A choice in a new conversation, with the model it runs on under its name.
    await openNewChat(page);
    const picker = page.getByRole("group", { name: "Who should take this?" });
    await expect(picker).toBeVisible();
    const choice = picker.getByRole("radio", { name: `${name} (bot)`, exact: true });
    await expect(choice).toHaveCount(1);
    await expect(choice).toHaveAccessibleDescription(/Scripted demo model/);
    // Picking a bot starts a fresh conversation with it: a new address, not the empty one.
    const before = page.url();
    // A click, not check(): choosing moves straight to a new conversation, so the radio never stays set here.
    await choice.click();
    await page.waitForURL((url) => /\/chat\/[^/?#]+/.test(url.pathname) && url.href !== before);
    await expect(
      page.getByRole("heading", { level: 2, name: new RegExp(`What can ${name} do for you`) }),
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
    // The bundled directory is a folder on this machine, which takes no submissions.
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
