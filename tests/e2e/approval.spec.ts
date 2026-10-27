import { conversation, expect, openNewChat, sendMessage, test } from "./fixtures.ts";

test.describe("Asking before acting", () => {
  test("an email waits for an answer, a refusal stops it, and the record keeps the refusal", async ({
    page,
  }) => {
    await openNewChat(page);
    await sendMessage(page, "Email sam@example.com about Friday: see you at 10");

    // The gateway parks the send. The card says exactly what would happen and offers the answers.
    const main = page.getByRole("main");
    const refuse = main.getByRole("button", { name: "Refuse", exact: true }).first();
    await expect(refuse).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole("button", { name: "Allow once", exact: true }).first()).toBeVisible();
    await expect(main.getByText(/sam@example\.com/).first()).toBeVisible();

    await refuse.click();

    // The run resumes with the refusal and the agent says plainly that nothing was sent.
    await expect(
      conversation(page)
        .getByText(/didn['’]t (do that|send)|wasn['’]t sent|not sent/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);

    // The record has the answer, and its hash chain still checks out.
    await page.goto("/record");
    const record = page.getByRole("main");
    await expect(record.getByText(/^(You answered|Refused)$/).first()).toBeVisible();
    await expect(record.getByRole("status").filter({ hasText: /record intact/i })).toBeVisible();
  });
});
