import { conversation, expect, openNewChat, sendMessage, test } from "./fixtures.ts";

/**
 * The agent's own browser, end to end with the scripted model. The run sets
 * STEWARD_ALLOW_PRIVATE_HOSTS=0 (playwright.config.ts), as a real install has it, so the browser
 * must never open this machine's own services or the local network (PLAN §4, decision 9). The
 * refusal comes from the computer, not the rules: opening a page is a read, which the rules allow.
 */

test.describe("The agent's computer", () => {
  test("refuses to open an address on this machine, says so, and the record keeps the failure", async ({
    page,
  }) => {
    await openNewChat(page);
    await sendMessage(page, "Open 127.0.0.1");
    // Refused for what the address is, not because nothing answered there.
    const reply = conversation(page)
      .getByText(/didn['’]t work/)
      .filter({ hasText: "127.0.0.1" })
      .filter({ hasText: /private network/ });
    await expect(reply.first()).toBeVisible({ timeout: 60_000 });

    await page.goto("/record");
    const main = page.getByRole("main");
    await main.getByRole("searchbox", { name: "Search" }).fill("127.0.0.1");
    // The count says "match" only once the search has answered, so the rows below are its rows,
    // not the whole record's, and "no Done" cannot pass on an empty or stale list.
    await expect(main.getByText(/ match\.$/)).toBeVisible();
    const entries = main.getByRole("region", { name: "Entries" }).getByRole("listitem");
    await expect(
      entries.filter({ hasText: "Failed" }).filter({ hasText: "127.0.0.1" }).first(),
    ).toBeVisible();
    // Nothing about it says the page was opened.
    await expect(entries.filter({ hasText: "Done" })).toHaveCount(0);
  });
});
