// Tempo Mesh v0 (S5.2): approve a claim with "Face ID" (a virtual authenticator), and watch the
// prompt disappear on the person's other screen.
import { type BrowserContext, type Page, expect, test } from "@playwright/test";

async function withFaceId(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
}

async function screen(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/control");
  await expect(page.getByRole("heading", { name: "Tempo · Mission Control" })).toBeVisible();
  return page;
}

test("approve a mission with Face ID; the prompt disappears on the other screen", async ({ browser }) => {
  const phone = await screen(await browser.newContext());
  await withFaceId(phone);
  await phone.getByRole("button", { name: "Use this device for approvals" }).click();
  await phone.getByRole("button", { name: "Add Face ID or fingerprint" }).click();
  await expect(phone.getByText("Face ID is on for approvals.")).toBeVisible();

  await phone.getByRole("button", { name: "Start Margaret's claim" }).click();
  await expect(phone.getByText(/You'll confirm with Face ID/)).toBeVisible();
  const laptop = await screen(await browser.newContext()); // another screen, same person
  await expect(laptop.getByRole("heading", { name: "Waiting for your OK" })).toBeVisible();

  const started = Date.now();
  await phone.getByRole("button", { name: /Yes, claim £/ }).click();

  await expect(phone.getByRole("heading", { name: "Waiting for your OK" })).toBeHidden();
  await expect(laptop.getByRole("heading", { name: "Waiting for your OK" })).toBeHidden();
  console.log(`cross-device dismissal: ${Date.now() - started} ms`);
  await expect(phone.getByText(/Can't reach the Gateway|wasn't|didn't verify/)).toHaveCount(0);
});

test("pairing a second device shows the same code on both screens", async ({ browser }) => {
  const phone = await screen(await browser.newContext());
  await phone.getByRole("button", { name: "Use this device for approvals" }).click();
  await phone.getByRole("button", { name: "Add another device" }).click();
  const link = await phone.locator("p.break-all").innerText();

  const laptop = await (await browser.newContext()).newPage();
  await laptop.goto(link);
  await laptop.getByLabel("What should Tempo call this device?").fill("Laptop");
  await laptop.getByRole("button", { name: "Join" }).click();
  const code = await laptop.locator("strong.font-mono").innerText();

  await expect(phone.locator("strong.font-mono")).toHaveText(code);
  await phone.getByRole("button", { name: "Yes, the codes match" }).click();
  await expect(phone.getByText("Laptop", { exact: true })).toBeVisible();
});
