// The live GPU demo, in a real browser, on the real Vercel site (playwright.live.config.ts):
// every page, the chat's claim with the jurors on our GPU, a photo read by our model, Scam
// Shield, Tempo's real voice, and Face ID bound to the live site. Run by `make live-test`, which
// restarts the Gateway afterwards so the demo starts clean.
import { type Page, expect, test } from "@playwright/test";
import { SITE, TUNNEL } from "./playwright.live.config";

test.skip(!SITE || !TUNNEL, "no live demo running: run make live-demo first");

const PAGES: ReadonlyArray<readonly [path: string, heading: string]> = [
  ["/#/missions", "Mission Control"], ["/#/memory", "Memory"], ["/#/profiles", "Profiles"],
  ["/#/skills", "Skills"], ["/#/shield", "Scam Shield"], ["/#/read", "Read It To Me"],
  ["/#/owed", "Am I Owed Anything?"], ["/#/callers", "Who's calling?"], ["/#/devices", "Devices"],
  ["/#/privacy", "Privacy Proof"], ["/#/story", "The story"], ["/#/settings", "Settings"],
];

/** Fail on any console error or uncaught exception while the test runs. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** The running Gateway's AI (no token needed for /health). */
async function ai(page: Page): Promise<{ deploy: string; processor: string }> {
  const health = (await (await page.request.get(`${TUNNEL}/health`)).json()) as { deploy: string; model?: { processor: string } };
  return { deploy: health.deploy, processor: health.model?.processor ?? "" };
}

test("the live site talks to the real Gateway and names the real AI behind it", async ({ page }) => {
  const errors = watchErrors(page);
  const { deploy } = await ai(page);
  await page.goto("/#/chat");
  const named = deploy === "cloud-gpu" ? /AI: our own model on a RunPod GPU/ : /AI: Google Gemini/;
  await expect(page.getByText(named).first()).toBeVisible();
  await expect(page.getByText(/not answering yet/)).toHaveCount(0);
  await expect(page.getByText(/SIMULATED company, rail data/).first()).toBeVisible();
  await expect(page.getByText(/SHOWCASE/)).toHaveCount(0);
  await expect(page.getByText("LIVE STREAM")).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [path, heading] of PAGES) {
  test(`${path} loads "${heading}" from the live Gateway with no errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(/can't reach its Gateway/)).toHaveCount(0);
    await page.waitForTimeout(1_500); // let the page's own Gateway calls land
    expect(errors).toEqual([]);
  });
}

test("the chat: Margaret's late train, three real jurors, Yes, and the money arrives", async ({ page }) => {
  const { deploy } = await ai(page);
  await page.goto("/#/chat");
  await page.getByRole("button", { name: /08:12 Oxford to Paddington/ }).click();
  const yes = page.getByRole("button", { name: /Yes, claim £14\.20/ });
  await expect(yes).toBeVisible();
  await page.getByRole("button", { name: /Why this amount/ }).first().click();
  await expect(page.getByText(/3\/3 jurors agreed/).first()).toBeVisible();
  if (deploy === "cloud-gpu") {
    for (const juror of ["runpod-vllm-1", "runpod-vllm-2", "runpod-vllm-3"]) {
      await expect(page.getByText(juror, { exact: true }).first()).toBeVisible();
    }
  } else {
    await expect(page.getByText(/^gemini-/).first()).toBeVisible();
  }
  await yes.click();
  await expect(page.getByText(/Claim filed|Waiting for the money/).first()).toBeVisible();

  await page.goto("/#/missions");
  await page.getByRole("link", { name: /Delay Repay for you.*Waiting for the company/ }).first().click();
  // The payment check also runs on its own (PAYMENT_CHECK_AFTER_S=0): it may already have landed.
  const check = page.getByRole("button", { name: "Check the payment now" });
  const arrived = page.getByText(/Money arrived/).first();
  await expect(check.or(arrived)).toBeVisible();
  if (await check.isVisible()) await check.click();
  await expect(arrived).toBeVisible();
  await expect(page.getByText(/has paid you £14\.20/).first()).toBeVisible();
});

test("Read It To Me: our model reads a sample photo of a water bill", async ({ page }) => {
  await page.goto("/#/read");
  await page.getByText("A water bill: you paid too much").click();
  await expect(page.getByText(/Read by your Gateway/).first()).toBeVisible();
  await expect(page.getByText(/Thames Water/).first()).toBeVisible();
  await expect(page.getByText(/£23\.40/).first()).toBeVisible();
});

test("Scam Shield speaks on the tax-refund trick", async ({ page }) => {
  await page.goto("/#/shield");
  await page.getByRole("button", { name: /tax refund/i }).click();
  await page.getByRole("button", { name: "Check this message" }).click();
  await expect(page.getByText(/This looks like a scam/).first()).toBeVisible();
});

test("Settings: Tempo's real voice is on", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByText("Gateway voice on")).toBeVisible(); // the audio itself: tests/live
});

test("Face ID on the live site: this browser becomes Margaret's device (then is removed)", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  try {
    await page.goto("/#/devices");
    await page.getByRole("button", { name: "Use this browser for approvals" }).click();
    await page.getByRole("button", { name: "Add Face ID or fingerprint" }).click();
    await expect(page.getByText("Face ID on", { exact: true })).toBeVisible();
  } finally {
    // Leave the Gateway as we found it: once Margaret has a passkey, unsigned answers are refused.
    const token = await page.evaluate(() => localStorage.getItem("tempo.device")).catch(() => null);
    const id = await page.evaluate(() => localStorage.getItem("tempo.device.id")).catch(() => null);
    if (token && id) await page.request.delete(`${TUNNEL}/mesh/devices/${id}`, { headers: { "X-Tempo-Device": token } });
  }
});
