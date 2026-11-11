import type { Page } from "@playwright/test";
import {
  approvalCard,
  conversation,
  deleteRules,
  expect,
  openNewChat,
  recordLength,
  sendMessage,
  sentMail,
  test,
  uniqueAddress,
} from "./fixtures.ts";

/**
 * Asking before acting, end to end with the scripted model and the demo inbox: a send waits for an
 * answer; a refusal stops it; Allow once sends it once; Always allow covers that address and no
 * other; and once a conversation has read the inbox, a send asks with no Always allow. The record
 * keeps every answer, and its chain still checks out.
 */

/** Opens the record on the rows about `address`, found with the page's own search. */
async function recordAbout(page: Page, address: string) {
  await page.goto("/record");
  const main = page.getByRole("main");
  await main.getByRole("searchbox", { name: "Search" }).fill(address);
  const entries = main.getByRole("region", { name: "Entries" }).getByRole("listitem");
  // The search runs as typing pauses; every row it leaves is about this address.
  await expect(entries.first()).toBeVisible();
  await expect(entries.filter({ hasNotText: address })).toHaveCount(0);
  return { main, entries };
}

/** The number in "Record intact · N entries verified". */
async function verifiedCount(page: Page): Promise<number> {
  // Only "Record intact" is announced; the count is written beside it, in the same line.
  const status = page
    .getByRole("main")
    .getByRole("status")
    .filter({ hasText: /record intact/i });
  await expect(status).toBeVisible();
  const text = (await status.locator("xpath=..").textContent()) ?? "";
  return Number(/([\d,]+) entr/.exec(text)?.[1]?.replace(/,/g, "") ?? Number.NaN);
}

test.describe("Asking before acting", () => {
  test("an email waits for an answer, a refusal stops it, and the record keeps the refusal", async ({
    page,
    api,
  }, testInfo) => {
    const address = uniqueAddress(testInfo, "refused");
    await openNewChat(page);
    await sendMessage(page, `Email ${address} about Friday: see you at 10`);

    // The gateway parks the send. The card says exactly what would happen and offers the answers.
    const card = approvalCard(page, address);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Refuse", exact: true }).click();

    // The run resumes with the refusal and the agent says plainly that nothing was sent.
    await expect(
      conversation(page)
        .getByText(/didn['’]t (do that|send)|wasn['’]t sent|not sent/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
    expect((await sentMail(api)).filter((mail) => mail.to.includes(address))).toEqual([]);

    // The record has the answer and the refusal, and its hash chain still checks out.
    const { main, entries } = await recordAbout(page, address);
    await expect(entries.filter({ hasText: "You answered" })).toHaveCount(1);
    await expect(entries.filter({ hasText: "You refused it" })).toHaveCount(1);
    await expect(main.getByRole("status").filter({ hasText: /record intact/i })).toBeVisible();
  });

  test("Allow once sends it, once, and the record keeps the answer and the send", async ({
    page,
    api,
  }, testInfo) => {
    const address = uniqueAddress(testInfo, "allowed");
    const before = await recordLength(api);
    await openNewChat(page);
    await sendMessage(page, `Email ${address} about the plan: see you at 10`);

    const card = approvalCard(page, address);
    await expect(card).toBeVisible({ timeout: 30_000 });
    // A plain send in a conversation that has read nothing from outside may be always allowed.
    await expect(card.getByRole("button", { name: "Always allow", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Allow once", exact: true }).click();

    await expect(conversation(page).getByText(`Sent to ${address}.`)).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("button", { name: "Refuse", exact: true })).toHaveCount(0);

    // It reached the demo inbox's Sent folder exactly once, with the words that were shown.
    const sent = (await sentMail(api)).filter((mail) => mail.to.includes(address));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subject: "The plan", body: "See you at 10" });

    const { main, entries } = await recordAbout(page, address);
    await expect(entries.filter({ hasText: "Asked you" })).toHaveCount(1);
    await expect(entries.filter({ hasText: "You answered" })).toHaveCount(1);
    await expect(entries.filter({ hasText: "Done" }).filter({ hasText: "Send an email" })).toHaveCount(1);
    // The new entries are sealed into the chain like every other.
    expect(await verifiedCount(page)).toBeGreaterThan(before);

    // "What happened" narrows the list to one kind of entry: here, the answer alone.
    await main.getByRole("combobox", { name: "What happened" }).selectOption({ label: "You answered" });
    await expect(entries).toHaveCount(1);
    await expect(entries).toContainText("You answered");
    await main.getByRole("combobox", { name: "What happened" }).selectOption({ label: "Everything" });
    await expect(entries.filter({ hasText: "Asked you" })).toHaveCount(1);
  });

  test.describe("Always allow", () => {
    let address = "";

    test.afterEach(async ({ api }) => {
      if (address) await deleteRules(api, (rule) => rule.source === "always" && rule.when.includes(address));
    });

    test("covers the address it was given and no other", async ({ page, api }, testInfo) => {
      address = uniqueAddress(testInfo, "always");
      const other = uniqueAddress(testInfo, "someone-else");
      await openNewChat(page);
      await sendMessage(page, `Email ${address} about the rota: you are on Tuesday`);
      const card = approvalCard(page, address);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole("button", { name: "Always allow", exact: true }).click();
      await expect(conversation(page).getByText(`Sent to ${address}.`)).toBeVisible({ timeout: 30_000 });

      // The rule it made is on the Rules page, where it can be revoked.
      await page.goto("/rules");
      await expect(page.getByRole("main").getByText(address).first()).toBeVisible();

      // In a new conversation, the same address goes without asking.
      await openNewChat(page);
      await sendMessage(page, `Email ${address} about the rota: and on Thursday`);
      await expect(conversation(page).getByText(`Sent to ${address}.`)).toBeVisible({ timeout: 30_000 });
      await expect(approvalCard(page, address)).toHaveCount(0);
      expect((await sentMail(api)).filter((mail) => mail.to.includes(address))).toHaveLength(2);

      // Anyone else still asks.
      await sendMessage(page, `Email ${other} about the rota: you are on Tuesday`);
      const asked = approvalCard(page, other);
      await expect(asked).toBeVisible({ timeout: 30_000 });
      await asked.getByRole("button", { name: "Refuse", exact: true }).click();
      await expect(conversation(page).getByText(/didn['’]t do that/i)).toBeVisible({ timeout: 30_000 });
      expect((await sentMail(api)).filter((mail) => mail.to.includes(other))).toEqual([]);
    });
  });

  test("after reading the inbox, a send asks, with no Always allow, and says why", async ({
    page,
    api,
  }, testInfo) => {
    const address = uniqueAddress(testInfo, "tainted");
    await openNewChat(page);
    // brief_today reads the inbox: mail is someone else's words, so the conversation is tainted.
    await sendMessage(page, "What needs me today?");
    await expect(
      conversation(page)
        .getByText(/demo inbox/i)
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    await sendMessage(page, `Email ${address} about the invoice: it is paid`);
    const card = approvalCard(page, address);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Untrusted content asks")).toBeVisible();
    await expect(card.getByText(/could carry someone else['’]s instructions/)).toBeVisible();
    await expect(card.getByText(/always asks, so there is no Always allow/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Always allow" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Refuse", exact: true }).click();
    await expect(conversation(page).getByText(/didn['’]t do that/i)).toBeVisible({ timeout: 30_000 });
    expect((await sentMail(api)).filter((mail) => mail.to.includes(address))).toEqual([]);

    // The record says which rule asked.
    const { entries } = await recordAbout(page, address);
    await expect(entries.filter({ hasText: "Asked you" })).toHaveCount(1);
    await entries.filter({ hasText: "Asked you" }).getByRole("button").click();
    await expect(entries.filter({ hasText: "Asked you" }).getByText("Untrusted content asks")).toBeVisible();
  });
});
