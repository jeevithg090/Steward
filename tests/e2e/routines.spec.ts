import type { APIRequestContext } from "@playwright/test";
import { conversation, expect, openNewChat, sendMessage, test, uniqueWord } from "./fixtures.ts";

/**
 * Routines, end to end with the scripted model: one asked for in chat is on the Routines page with
 * its next run; switching it off pauses it; Delete asks first and then removes it. Setting one up
 * changes only Steward's own state, so it needs no answer; what the routine later sends still asks.
 */

interface RoutineRow {
  id: string;
  title: string;
}

/** Deletes every routine whose title has `word`, so a failed attempt leaves nothing behind. */
async function deleteRoutines(api: APIRequestContext, word: string): Promise<void> {
  const res = await api.get("/api/routines");
  if (!res.ok()) return;
  for (const routine of (await res.json()) as RoutineRow[]) {
    if (routine.title.includes(word)) await api.delete(`/api/routines/${encodeURIComponent(routine.id)}`);
  }
}

test.describe("Routines", () => {
  let word = "";

  test.afterEach(async ({ api }) => {
    if (word) await deleteRoutines(api, word);
  });

  test("one asked for in chat shows its next run, pauses when switched off, and Delete asks first", async ({
    page,
  }, testInfo) => {
    word = uniqueWord(testInfo, "desk");
    // The scripted model names the routine after the first five words of its work.
    const title = `Check the mail from ${word}`;
    await openNewChat(page);
    await sendMessage(page, `Every weekday at 9, check the mail from ${word}`);
    await expect(conversation(page).getByText(`Done. “${title}” will run`)).toBeVisible({ timeout: 30_000 });

    await page.goto("/routines");
    const card = page.getByRole("article", { name: title, exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByText(`“${title}”`)).toBeVisible();
    // Switched on, with a next run, and nothing run yet.
    const toggle = card.getByRole("switch", { name: /^On schedule/ });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(card.getByText("Hasn't run yet")).toBeVisible();
    await expect(card.getByText("Paused", { exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Run now" })).toBeEnabled();

    // Off: paused, and it cannot be run until it is on again.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(card.getByText("Paused", { exact: true })).toBeVisible();
    await expect(card.getByText("This routine is paused. Turn it on to run it.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Run now" })).toBeDisabled();

    // Delete asks in a dialog; Keep it changes nothing.
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this routine?" });
    await expect(confirm).toContainText(`"${title}" will stop running`);
    await confirm.getByRole("button", { name: "Keep it", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Delete", exact: true }).click();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("article", { name: title, exact: true })).toHaveCount(0);
  });
});
