import { DEVICE_URL } from "./env.ts";
import { expect, test } from "./fixtures.ts";

/**
 * Settings → Phone (docs/plans/phone-and-shortcuts.md §10.1): the pairing offer shows two QR codes,
 * each with a link and a copy button beside it; a phone pairing through the device port turns the
 * card green; and the page passes an axe audit with the offer open.
 */

const PHONE_URL = "https://e2e-mac.tail1234.ts.net";

/** What the Steward shortcut reads from `steward-pair:1:<base64url JSON>`. */
function parsePairText(text: string): { u: string; c: string; n: string } | undefined {
  const prefix = "steward-pair:1:";
  if (!text.startsWith(prefix)) return undefined;
  return JSON.parse(Buffer.from(text.slice(prefix.length), "base64url").toString("utf8"));
}

test.describe("Settings → Phone", () => {
  test.beforeEach(async ({ api }) => {
    const res = await api.put("/api/phone", { data: { url: PHONE_URL } });
    expect(res.ok()).toBe(true);
  });

  test("pairs a phone from the offer, with every QR code also a link and a copy button", async ({
    page,
    request,
    api,
  }) => {
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Phone" });
    await expect(section.getByRole("heading", { name: "Connection" })).toBeVisible();
    await expect(section.getByRole("textbox", { name: "Phone address" })).toHaveValue(PHONE_URL);
    await expect(section.getByText(/never Steward's main port 8787/)).toBeVisible();

    await section.getByRole("button", { name: "Add iPhone" }).click();
    await expect(
      section.getByRole("img", { name: "QR code to download the Steward shortcut" }),
    ).toBeVisible();
    await expect(
      section.getByRole("img", { name: "QR code to pair your iPhone with Steward" }),
    ).toBeVisible();
    await expect(section.getByRole("link", { name: "On this iPhone? Get the shortcut" })).toHaveAttribute(
      "href",
      `${PHONE_URL}/device/shortcut/Steward.shortcut`,
    );
    await expect(section.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(section.getByRole("button", { name: "Copy pairing link" })).toBeVisible();

    // The phone: read the pairing text the way the shortcut does, then pair through the device port.
    const href = await section.getByRole("link", { name: "On this iPhone? Pair it" }).getAttribute("href");
    expect(href).toMatch(/^shortcuts:\/\/run-shortcut\?name=Steward&input=text&text=/);
    const payload = parsePairText(decodeURIComponent(href!.split("&text=")[1]!));
    expect(payload?.u).toBe(PHONE_URL);
    const name = `E2E iPhone ${Date.now()}`;
    const paired = await request.post(`${DEVICE_URL}/device/pair`, {
      data: { code: payload!.c, deviceName: name, kind: "shortcut" },
    });
    expect(paired.status()).toBe(200);
    const { token } = (await paired.json()) as { token: string };

    await expect(section.getByRole("status").getByText(`${name} paired`)).toBeVisible({ timeout: 10_000 });
    const row = section.getByRole("listitem", { name });
    await expect(row.getByRole("switch", { name: "Say yes to requests" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // The main port answers no device route, even with the token.
    const onMain = await api.get("/device/home", { headers: { authorization: `Bearer ${token}` } });
    expect(onMain.status()).toBe(404);
    const home = await request.get(`${DEVICE_URL}/device/home`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(home.status()).toBe(200);

    // Revoking takes effect on the very next call.
    await row.getByRole("button", { name: "Revoke" }).click();
    await row.getByRole("button", { name: "Remove phone" }).click();
    await expect(section.getByRole("listitem", { name })).toHaveCount(0);
    const after = await request.get(`${DEVICE_URL}/device/home`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status()).toBe(401);
  });

  test("no serious axe violations with a pairing offer open", async ({ page }) => {
    const moduleName = "@axe-core/playwright";
    const axe = await import(moduleName).catch(() => undefined);
    test.skip(!axe, "Install @axe-core/playwright to run the automated axe checks.");
    await page.goto("/settings");
    const section = page.getByRole("region", { name: "Phone" });
    await section.getByRole("button", { name: "Add iPhone" }).click();
    await expect(section.getByRole("img", { name: /QR code to pair/ })).toBeVisible();
    const results = await new axe.default({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations.filter(
      (v: { impact?: string }) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious.map((v: { id: string; help: string }) => `${v.id} (${v.help})`)).toEqual([]);
  });

  test("the Shortcuts page lists the catalogue, and a skill added in the app is offered at once", async ({
    page,
    api,
  }) => {
    const name = `e2e-trip-${Date.now()}`;
    const made = await api.post("/api/skills", {
      data: { name, description: "Plan a trip.", instructions: "Plan it." },
    });
    expect(made.ok()).toBe(true);
    await page.goto("/shortcuts");
    await expect(page.getByRole("heading", { level: 1, name: "Shortcuts" })).toBeVisible();
    await expect(page.getByRole("img", { name: "QR code to download the Steward shortcut" })).toBeVisible();
    const suggested = page.getByRole("region", { name: "Suggested for you" });
    await expect(suggested.getByRole("listitem", { name: "What needs me?" })).toBeVisible();
    await expect(suggested.getByRole("listitem", { name: /^E2e trip/ })).toBeVisible();
    await api.delete(`/api/skills/${(await made.json()).id}`);
  });

  test("the phone app's crypto gives the same bytes in Chromium as in Node", async ({ page }) => {
    await page.goto("/");
    const out = await page.evaluate(async () => {
      // Served by the web app's dev server, the way the phone app's bundle runs it.
      const path = "/src/phone/selftest.ts";
      const mod = (await import(/* @vite-ignore */ path)) as { run(): Promise<Record<string, unknown>> };
      return mod.run();
    });
    expect(out.results).toEqual(out.expected);
    expect(out.nonExtractableOpens).toBe(true);
    expect(out.privateKeyReadable).toBe(false);
    expect(out.base64).toEqual([0, 1, 2]);
  });
});
