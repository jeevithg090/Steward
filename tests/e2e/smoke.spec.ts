// Smoke (plan.md §1.9, §12.1 finding 9): the chat door, Mission Control and every page.
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

test("the chat claims Margaret's late train from one sample chip, and Mission Control sees the money arrive", async ({ page }) => {
  await page.goto("/#/chat");
  // The honesty badge: a real replay-mode Gateway, not the showcase.
  await expect(page.getByText(/REPLAY data/).first()).toBeVisible();

  await page.getByRole("button", { name: /08:12 Oxford to Paddington/ }).click();
  const yes = page.getByRole("button", { name: /Yes, claim £/ });
  // mesh.spec.ts runs first against the same Gateway and may already have claimed this journey;
  // then the Gateway says it is on it instead of asking again. Either way a claim is waiting.
  const already = page.getByText(/already on this one/);
  await expect(yes.or(already).first()).toBeVisible({ timeout: 20_000 });
  if (await yes.isVisible()) {
    await yes.click();
    // What the chat says after Yes: the claim is filed and Tempo waits for the money.
    await expect(page.getByText(/Claim filed|Waiting for the money|paid you/).first()).toBeVisible({ timeout: 20_000 });
  }

  // Mission Control: the payment check finds the money.
  await page.goto("/#/missions");
  await page.getByRole("link", { name: /Delay Repay for you.*Waiting for the company/ }).first().click();
  const check = page.getByRole("button", { name: "Check the payment now" });
  await expect(check).toBeVisible({ timeout: 20_000 });
  await check.click();
  await expect(page.getByText(/Money arrived/).first()).toBeVisible({ timeout: 20_000 });
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
