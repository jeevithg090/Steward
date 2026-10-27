/**
 * What every spec shares. Specs find things the way a person using a screen reader would: by role,
 * label and visible text, never by class names or test ids. If a spec cannot find a control that
 * way, the control is not accessible, and that is the bug.
 */
import { type APIRequestContext, test as base, expect, type Locator, type Page } from "@playwright/test";
import { SERVER_URL, WELCOME_STORAGE_KEY } from "./env.ts";

export { expect };

interface StewardFixtures {
  /** Steward's REST API, called directly. For setting up and cleaning up, never for the thing under test. */
  api: APIRequestContext;
}

export const test = base.extend<StewardFixtures>({
  // A first visit to Today goes to the welcome. Specs start past it; a11y.spec visits it directly.
  page: async ({ page }, provide) => {
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, "done");
      } catch {
        // Storage can be blocked; the welcome then shows, and the spec says so when it fails.
      }
    }, WELCOME_STORAGE_KEY);
    await provide(page);
  },
  api: async ({ playwright }, provide) => {
    const api = await playwright.request.newContext({ baseURL: SERVER_URL });
    await provide(api);
    await api.dispose();
  },
});

/** The conversation transcript: a live log region. */
export function conversation(page: Page): Locator {
  return page.getByRole("log", { name: "Conversation" });
}

/** Opens a new conversation and waits until it can take a message. */
export async function openNewChat(page: Page): Promise<Locator> {
  await page.goto("/chat");
  // `/chat` creates a conversation and moves to `/chat/<id>`; typing before that would be lost.
  await page.waitForURL(/\/chat\/[^/?#]+/);
  const composer = page.getByRole("textbox", { name: /^Message / });
  await expect(composer).toBeEditable();
  return composer;
}

/** Types a message into the composer and sends it with the Send button. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: /^Message / });
  await composer.fill(text);
  await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).click();
  await expect(conversation(page).getByText(text, { exact: true })).toBeVisible();
}

interface RuleSummary {
  id: string;
  name: string;
}

/** Deletes rules a spec added, by name prefix, so a failed run leaves nothing behind for the next spec. */
export async function deleteRulesNamed(api: APIRequestContext, prefix: string): Promise<void> {
  const res = await api.get("/api/rules");
  if (!res.ok()) return;
  const rules = (await res.json()) as RuleSummary[];
  for (const rule of rules) {
    if (rule.name.startsWith(prefix)) await api.delete(`/api/rules/${encodeURIComponent(rule.id)}`);
  }
}
