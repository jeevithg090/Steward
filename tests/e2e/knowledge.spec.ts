import type { APIRequestContext } from "@playwright/test";
import { conversation, expect, openNewChat, personSaid, sendMessage, test, uniqueWord } from "./fixtures.ts";

/**
 * What Steward knows about the person, end to end with the scripted model: a fact said in chat is
 * on the Memory page and can be forgotten there, and a skill added on the Skills page is offered
 * when the composer starts with "/" and can be called. Both writes are to Steward's own state, so
 * a conversation that has read nothing from outside does them without asking.
 */

interface Fact {
  id: string;
  text: string;
}

interface SkillRow {
  id: string;
  name: string;
}

/** Forgets every fact that mentions `word`, so a failed attempt leaves nothing for the next one. */
async function forgetFacts(api: APIRequestContext, word: string): Promise<void> {
  const res = await api.get("/api/memory");
  if (!res.ok()) return;
  for (const fact of (await res.json()) as Fact[]) {
    if (fact.text.includes(word)) await api.delete(`/api/memory/${encodeURIComponent(fact.id)}`);
  }
}

async function deleteSkill(api: APIRequestContext, name: string): Promise<void> {
  const res = await api.get("/api/skills");
  if (!res.ok()) return;
  for (const skill of (await res.json()) as SkillRow[]) {
    if (skill.name === name) await api.delete(`/api/skills/${encodeURIComponent(skill.id)}`);
  }
}

test.describe("Memory", () => {
  let word = "";

  test.afterEach(async ({ api }) => {
    if (word) await forgetFacts(api, word);
  });

  test("a fact said in chat is on the Memory page, and Forget removes it", async ({
    page,
    api,
  }, testInfo) => {
    word = uniqueWord(testInfo, "platform");
    const fact = `I take the train on Fridays from ${word}`;
    await openNewChat(page);
    await sendMessage(page, `Remember that ${fact}.`);
    await expect(conversation(page).getByText("Got it. I'll remember that.")).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/memory");
    const list = page.getByRole("region", { name: "What Steward remembers" });
    const item = list.getByRole("listitem").filter({ hasText: fact });
    await expect(item).toHaveCount(1);
    // It says who it came from: the person, not something Steward guessed.
    await expect(item.getByText("You told Steward", { exact: true })).toBeVisible();

    await item.getByRole("button", { name: `Forget: ${fact}`, exact: true }).click();
    await expect(list.getByRole("listitem").filter({ hasText: fact })).toHaveCount(0);
    // Forgotten on the server too, not just hidden on the page.
    const facts = (await (await api.get("/api/memory")).json()) as Fact[];
    expect(facts.filter((f) => f.text.includes(word))).toEqual([]);
    // And after a reload. The heading is there before the list loads, so wait for the list itself
    // (its items, or "Nothing yet") before saying the fact is not in it.
    await page.reload();
    await expect(
      list
        .getByRole("listitem")
        .or(list.getByRole("heading", { name: "Nothing yet" }))
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("main").getByText(fact)).toHaveCount(0);
  });
});

test.describe("Skills", () => {
  let name = "";
  let word = "";

  test.afterEach(async ({ api }) => {
    if (name) await deleteSkill(api, name);
    if (word) await forgetFacts(api, word);
  });

  test("a skill added on the Skills page is offered after / in the composer, and runs when picked", async ({
    page,
  }, testInfo) => {
    name = `e2e-notes-${uniqueWord(testInfo, "")}`;
    word = uniqueWord(testInfo, "locker");
    await page.goto("/skills");
    await page.getByRole("button", { name: "Add a skill" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a skill" });
    await dialog.getByRole("textbox", { name: /^Name/ }).fill(name);
    await dialog.getByRole("textbox", { name: /^What it's for/ }).fill("Keeps notes for the e2e run");
    await dialog
      .getByRole("textbox", { name: /^Instructions/ })
      .fill("Remember what the person says, in their own words.");
    await dialog.getByRole("button", { name: "Add skill", exact: true }).click();
    await expect(dialog).toBeHidden();
    const card = page.getByRole("article", { name: `/${name}`, exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByText("Yours", { exact: true })).toBeVisible();

    // "/" and the start of its name offer it; Enter picks it, the way a keyboard user would.
    const composer = await openNewChat(page);
    await composer.fill(`/${name.slice(0, 12)}`);
    const options = page.getByRole("listbox", { name: "Skills" });
    // The option reads its name, then what it is for.
    await expect(options.getByRole("option", { name: `/${name}` })).toBeVisible();
    await composer.press("Enter");
    await expect(composer).toHaveValue(`/${name} `);
    await expect(options).toBeHidden();

    const fact = `My locker is ${word}`;
    await composer.pressSequentially(`remember that ${fact}`);
    await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).click();
    await expect(personSaid(page, `/${name} remember that ${fact}`)).toBeVisible();
    await expect(conversation(page).getByText("Got it. I'll remember that.")).toBeVisible({
      timeout: 30_000,
    });

    // Deleting asks first, and then it is gone.
    await page.goto("/skills");
    await page.getByRole("button", { name: `Delete /${name}`, exact: true }).click();
    const confirm = page.getByRole("dialog", { name: `Delete /${name}?`, exact: true });
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("article", { name: `/${name}`, exact: true })).toHaveCount(0);
  });
});
