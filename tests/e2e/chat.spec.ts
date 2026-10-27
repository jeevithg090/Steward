import { conversation, expect, openNewChat, sendMessage, test } from "./fixtures.ts";

test.describe("Chat", () => {
  test("a hello gets a reply that says it comes from the scripted demo model", async ({ page }) => {
    await openNewChat(page);
    await sendMessage(page, "hello");

    const log = conversation(page);
    await expect(log.getByText(/scripted demo model/i).first()).toBeVisible({ timeout: 30_000 });
    // A greeting never uses a name the person did not give.
    await expect(log.getByText(/^Hi\b/).first()).toBeVisible();
  });

  test("a starter on Today opens the chat and sends it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "What needs me today?" }).first().click();

    await page.waitForURL(/\/chat\/[^/?#]+/);
    const log = conversation(page);
    await expect(log.getByText("What needs me today?", { exact: true })).toBeVisible();
    // The scripted model reads the demo inbox and says that it is demo data.
    await expect(log.getByText(/demo inbox/i).first()).toBeVisible({ timeout: 60_000 });
  });
});
