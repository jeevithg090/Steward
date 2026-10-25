// Smoke (plan.md §1.9: this replaces the Tempo Mesh spec; Mesh is out of scope in the new UI).
// The chat door and every page, against a replay-mode Gateway and a production build of the web
// app on their own ports (playwright.config.ts). The chat beat needs the Gateway's POST /chat;
// if that route is missing the first test fails, which is right.
import { expect, test, type Page } from "@playwright/test";

/** Every page and its one `<h1>` (plan.md §2). */
const PAGES: ReadonlyArray<readonly [path: string, heading: string]> = [
  ["/#/missions", "Mission Control"],
  ["/#/memory", "Memory"],
  ["/#/profiles", "Profiles"],
  ["/#/skills", "Skills"],
  ["/#/read", "Read It To Me"],
  ["/#/owed", "Am I Owed Anything?"],
  ["/#/callers", "Who's calling?"],
  ["/#/privacy", "Privacy Proof"],
  ["/#/story", "The story"],
  ["/#/settings", "Settings"],
];

async function expectH1(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}

test("the chat claims Margaret's late train from one sample chip", async ({ page }) => {
  await page.goto("/#/chat");
  // The honesty badge: a real replay-mode Gateway, not the showcase.
  await expect(page.getByText(/REPLAY data/).first()).toBeVisible();

  await page.getByRole("button", { name: /08:12 Oxford to Paddington/ }).click();
  const yes = page.getByRole("button", { name: /Yes, claim £/ });
  await expect(yes).toBeVisible({ timeout: 20_000 });
  await yes.click();
  await expect(page.getByText(/Waiting for the company|Money arrived|paid/).first()).toBeVisible({ timeout: 20_000 });
});

test("Scam Shield warns about the tax-refund text", async ({ page }) => {
  await page.goto("/#/shield");
  await expectH1(page, "Scam Shield");
  await page.getByRole("button", { name: /tax refund/i }).click();
  await expect(page.getByText(/Tempo speaks|likely a scam|warn/i).first()).toBeVisible({ timeout: 20_000 });
});

for (const [path, heading] of PAGES) {
  test(`${path} shows the heading "${heading}"`, async ({ page }) => {
    await page.goto(path);
    await expectH1(page, heading);
  });
}
