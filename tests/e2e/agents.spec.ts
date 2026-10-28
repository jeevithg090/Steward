/**
 * Several Stewards on different models in one app, end to end with the scripted model: the API
 * says what each agent runs on and whether it can answer, the picker shows the model under each
 * name and greys out the ones whose key is missing, and the record counts the tokens of a run.
 * The e2e server has no keys, so "Steward on Claude" and "Steward on Grok" are the greyed ones.
 */
import { conversation, expect, openNewChat, sendMessage, test } from "./fixtures.ts";

interface AgentRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  available: boolean;
  signIn: string;
  reason?: string;
}

test.describe("Agents on their own models", () => {
  test("the API lists every agent with its model and whether it can answer", async ({ api }) => {
    const res = await api.get("/api/agents");
    expect(res.ok()).toBe(true);
    const { agents } = (await res.json()) as { agents: AgentRow[] };
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    expect(byId.steward).toMatchObject({ available: true, provider: "scripted", signIn: "scripted" });
    expect(byId["steward-claude"]).toMatchObject({
      name: "Steward on Claude",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      available: false,
      signIn: "api-key",
      reason: "No OpenRouter key is set. Add one in .env, then restart Steward.",
    });
    expect(byId["steward-grok"]).toMatchObject({
      name: "Steward on Grok",
      provider: "xai",
      model: "grok-4.7",
      available: false,
      reason: "No xAI key is set. Add one in .env, then restart Steward.",
    });
  });

  test("the picker shows each agent's model and greys out the ones without a key", async ({ page }) => {
    await openNewChat(page);
    const picker = page.getByRole("group", { name: "Who should take this?" });
    await expect(picker).toBeVisible();

    const steward = picker.getByRole("radio", { name: "Steward", exact: true });
    await expect(steward).toBeChecked();
    await expect(steward).toHaveAccessibleDescription(/Scripted demo model/);

    const grok = picker.getByRole("radio", { name: "Steward on Grok" });
    await expect(grok).toBeDisabled();
    await expect(grok).toHaveAccessibleDescription(
      "No xAI key is set. Add one in .env, then restart Steward.",
    );
    await expect(picker.getByRole("radio", { name: "Steward on Claude" })).toBeDisabled();
    await expect(picker.getByText("No OpenRouter key is set", { exact: false })).toBeVisible();
  });

  test("the record says what a run cost", async ({ page }) => {
    await openNewChat(page);
    await sendMessage(page, "hello");
    await expect(
      conversation(page)
        .getByText(/scripted demo model/i)
        .first(),
    ).toBeVisible({ timeout: 30_000 });

    await page.goto("/record");
    await page.getByLabel("What happened").selectOption("run.finished");
    const rows = page
      .getByRole("list")
      .filter({ has: page.getByText("Finished work") })
      .getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    // The scripted model reports a token count like a real provider does.
    await expect(rows.first()).toContainText(
      /[\d,]+ tokens · Scripted demo model steward-scripted \([\d,]+ in, [\d,]+ out\)/,
    );
    await expect(rows.first().getByText("Done")).toBeVisible();
  });
});
