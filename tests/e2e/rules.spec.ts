import { deleteRulesNamed, expect, test } from "./fixtures.ts";

const PREFIX = "e2e:";

test.describe("Rules", () => {
  test.afterEach(async ({ api }) => {
    await deleteRulesNamed(api, PREFIX);
  });

  test("a deny rule you add is the rule the tester says refuses", async ({ page }) => {
    const name = `${PREFIX} no commands`;
    await page.goto("/rules");

    await page.getByRole("button", { name: "Add a rule" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /^Name/ }).fill(name);
    await dialog.getByRole("radio", { name: /never allow/i }).check();
    await dialog.getByRole("textbox", { name: /^When/ }).fill('tool.kind == "shell"');
    await dialog.getByRole("button", { name: "Add rule", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("article", { name })).toBeVisible();

    const tester = page.getByRole("region", { name: "Would this be allowed?" });
    await tester.getByRole("combobox", { name: "Action" }).selectOption("shell_run");
    await tester.getByRole("button", { name: "Check", exact: true }).click();

    await expect(tester.getByText(/would be refused/i)).toBeVisible();
    await expect(tester.getByText(name)).toBeVisible();
  });

  test("a rule that cannot be read is refused with a reason, not saved", async ({ page }) => {
    await page.goto("/rules");

    await page.getByRole("button", { name: "Add a rule" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /^Name/ }).fill(`${PREFIX} broken`);
    await dialog.getByRole("textbox", { name: /^When/ }).fill("tool.kind ==");
    await dialog.getByRole("button", { name: "Add rule", exact: true }).click();

    // Fail closed: a rule the gateway cannot evaluate never reaches the policy.
    await expect(dialog.getByText(/cannot be used|not valid/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
