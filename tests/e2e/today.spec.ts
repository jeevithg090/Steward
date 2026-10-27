import { expect, test } from "./fixtures.ts";

test.describe("Today", () => {
  test("shows the brief, or a button that makes it, and making it shows what needs you", async ({ page }) => {
    await page.goto("/");

    const brief = page.getByRole("region", { name: "Your brief" });
    await expect(brief).toBeVisible();

    const make = brief.getByRole("button", { name: /make my brief/i });
    const needsYou = brief.getByRole("heading", { name: /^needs you/i });
    // Either the brief is already there (the morning worker may have made it), or it can be made.
    await expect(make.or(needsYou).first()).toBeVisible();

    if (await make.isVisible()) await make.click();

    // The demo inbox always has mail that needs an answer, so the section is there and not empty.
    await expect(needsYou).toBeVisible({ timeout: 60_000 });
    await expect(brief.getByRole("button", { name: /^Start: / }).first()).toBeVisible();
  });

  test("greets without a name", async ({ page }) => {
    await page.goto("/");
    // Steward has not been told a name, so it must not use one (PLAN §2, rule 4).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^(Hi|Good (morning|afternoon|evening))\.?$/,
    );
  });

  test("labels the demo inbox and the scripted model on screen", async ({ page }) => {
    await page.goto("/");
    const ribbon = page.getByRole("complementary", { name: "Demo data" });
    await expect(ribbon).toContainText(/demo inbox/i);
    await expect(ribbon).toContainText(/scripted model/i);
  });
});
