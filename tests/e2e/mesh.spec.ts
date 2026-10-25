// Tempo Mesh and the Agent Passport (plan.md §12, track M; docs/demo.md beats 6 and 9), end to end:
// two browsers, a CDP virtual authenticator standing in for Face ID, the replay-mode Gateway and the
// production build (playwright.config.ts). WebAuthn's RP id is "localhost", so the pages are opened
// at http://localhost:3010, as the config's baseURL already does.
import { type Browser, type Page, expect, test } from "@playwright/test";

/** The Gateway playwright.config.ts starts (GATEWAY there). */
const GATEWAY = "http://localhost:8010";

async function withFaceId(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
}

/** A browser of its own (its own storage, so its own device), with "Face ID". */
async function screen(browser: Browser, path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await withFaceId(page);
  await page.goto(path);
  return page;
}

/** Make this browser Margaret's device and add Face ID, through the Devices page. */
async function useForApprovals(page: Page): Promise<void> {
  await page.goto("/#/devices");
  await expect(page.getByRole("heading", { level: 1, name: "Devices" })).toBeVisible();
  await page.getByRole("button", { name: "Use this browser for approvals" }).click();
  await page.getByRole("button", { name: "Add Face ID or fingerprint" }).click();
  await expect(page.getByText("Face ID on", { exact: true })).toBeVisible();
}

/**
 * Leave the Gateway as we found it: remove every device (and so every passkey) these tests made.
 * Once Margaret has a passkey the Gateway refuses unsigned answers, which the other specs use.
 */
async function forgetDevices(page: Page | undefined): Promise<void> {
  const token = await page?.evaluate(() => localStorage.getItem("tempo.device")).catch(() => null);
  if (!page || !token) return;
  const headers = { "X-Tempo-Device": token };
  const list = await page.request.get(`${GATEWAY}/mesh/devices`, { headers });
  if (!list.ok()) return;
  const mine = await page.evaluate(() => localStorage.getItem("tempo.device.id"));
  const devices = (await list.json()) as { id: string }[];
  for (const d of [...devices.filter((d) => d.id !== mine), ...devices.filter((d) => d.id === mine)]) {
    await page.request.delete(`${GATEWAY}/mesh/devices/${d.id}`, { headers });
  }
}

test("pair a laptop by QR code: both screens show the same code, then the laptop adds Face ID", async ({ browser }) => {
  let phone: Page | undefined;
  try {
    phone = await screen(browser, "/#/devices");
    await useForApprovals(phone);
    await phone.getByRole("button", { name: "Add another device" }).click();
    await expect(phone.getByRole("img", { name: /QR code for adding your other device/ })).toBeVisible();
    const link = await phone.getByTestId("pairing-link").innerText();
    expect(link).toMatch(/^http:\/\/localhost:3010\/#pair=\w+\.[\w-]+$/);

    const laptop = await screen(browser, link);
    await laptop.getByLabel("What should Tempo call this device?").fill("Laptop");
    await laptop.getByRole("button", { name: "Join" }).click();
    const code = laptop.getByText(/^\d{3} \d{3}$/);
    await expect(code).toBeVisible();
    const shown = await code.innerText();
    await expect(laptop).toHaveURL(/#\/pair$/); // the one-time secret is gone from the address bar

    await expect(phone.getByText(shown, { exact: true })).toBeVisible({ timeout: 10_000 });
    await phone.getByRole("button", { name: "Yes, the codes match" }).click();
    await expect(phone.getByRole("list", { name: "Your devices" }).getByText("Laptop", { exact: true })).toBeVisible();

    await laptop.getByRole("button", { name: "Now add Face ID" }).click({ timeout: 10_000 });
    await expect(laptop.getByText("Face ID is on for this device.")).toBeVisible();
  } finally {
    await forgetDevices(phone);
  }
});

test("approve with Face ID on the phone, the ask leaves the laptop, then sign a mandate and let the company check it", async ({ browser }) => {
  let phone: Page | undefined;
  try {
    phone = await screen(browser, "/#/devices");
    await useForApprovals(phone);

    await phone.goto("/#/missions");
    await phone.getByRole("button", { name: "Start Margaret's claim" }).first().click();
    await expect(phone).toHaveURL(/#\/missions\/m_/);
    await expect(phone.getByText(/You'll confirm with Face ID or your fingerprint/)).toBeVisible();
    const laptop = await screen(browser, phone.url()); // the same mission on her other screen
    await expect(laptop.getByRole("button", { name: /Yes, claim £/ })).toBeVisible();

    const started = Date.now();
    await phone.getByRole("button", { name: /^Yes, claim £\d+\.\d\d with Face ID$/ }).click();
    await expect(phone.getByRole("button", { name: /Yes, claim £/ })).toBeHidden();
    await expect(laptop.getByRole("button", { name: /Yes, claim £/ })).toBeHidden();
    console.log(`the ask left the other screen in ${Date.now() - started} ms`);

    await phone.getByRole("button", { name: "Sign a mandate with Face ID" }).click();
    await expect(phone.getByText(/^For GWR/)).toBeVisible();
    await expect(phone.getByText(/Signed with Face ID on /)).toBeVisible();
    await phone.getByRole("button", { name: /^Check: claim £/ }).click();
    await expect(phone.getByRole("list", { name: "Check results" }).getByText(/^Allowed/)).toBeVisible();
    await phone.getByRole("button", { name: "Check: discuss her mobile contract" }).click();
    await expect(phone.getByRole("list", { name: "Check results" }).getByText(/^Refused/)).toBeVisible();
    await expect(phone.getByText("Signature checked in your browser: ok")).toBeVisible();

    // Every check the company made reaches her other screen too.
    const checked = laptop.getByRole("list", { name: "What the company checked" });
    await expect(checked.getByText(/^Allowed: claim, for GWR/)).toBeVisible({ timeout: 10_000 });
    await expect(checked.getByText(/^Refused: other accounts, for GWR/)).toBeVisible();
    await expect(phone.getByText(/Can't reach|refused the token|didn't verify|couldn't be verified/)).toHaveCount(0);
  } finally {
    await forgetDevices(phone);
  }
});
