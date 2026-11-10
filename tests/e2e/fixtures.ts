/**
 * What every spec shares. Specs find things the way a person using a screen reader would: by role,
 * label and visible text, never by class names or test ids. If a spec cannot find a control that
 * way, the control is not accessible, and that is the bug.
 */
import {
  type APIRequestContext,
  test as base,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { SERVER_URL, WELCOME_STORAGE_KEY } from "./env.ts";

export { expect };

interface StewardFixtures {
  /** Steward's REST API, called directly. For setting up and cleaning up, never for the thing under test. */
  api: APIRequestContext;
  /**
   * Console errors a spec expects, beyond the ones every spec allows. Set it with
   * `test.use({ allowedConsoleErrors: [/…/] })` next to the test that causes them, and say why.
   */
  allowedConsoleErrors: RegExp[];
}

/** The only hosts the app may reach in a run: this machine. Anything else is a request that leaves it. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Console errors that are not the app's: Chromium reports every 4xx answer as an error, and specs
 * check refusals on purpose. A 5xx is never on this list, so a server failure fails the spec.
 */
const ALWAYS_ALLOWED_CONSOLE_ERRORS = [
  /^Failed to load resource: the server responded with a status of 4\d\d\b/,
];

export const test = base.extend<StewardFixtures>({
  allowedConsoleErrors: [[], { option: true }],
  // A first visit to Today goes to the welcome. Specs start past it; a11y.spec visits it directly.
  //
  // Every page is also watched: an uncaught exception, a console error or a request to any host
  // but this machine fails the spec when it ends. The run promises no network and no key, and a
  // React error or a crashed handler can otherwise pass every assertion.
  page: async ({ page, allowedConsoleErrors }, provide, testInfo) => {
    const problems: string[] = [];
    const allowed = [...ALWAYS_ALLOWED_CONSOLE_ERRORS, ...allowedConsoleErrors];
    page.on("pageerror", (error) => problems.push(`Uncaught in the page: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!allowed.some((pattern) => pattern.test(text))) problems.push(`Console error: ${text}`);
    });
    page.on("websocket", (socket) => {
      if (!isLocal(socket.url())) problems.push(`A WebSocket left this machine: ${socket.url()}`);
    });
    await page.context().route(
      (url) => !isLocal(url.href),
      (route) => {
        problems.push(`A request left this machine: ${route.request().method()} ${route.request().url()}`);
        return route.abort("blockedbyclient");
      },
    );
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, "done");
      } catch {
        // Storage can be blocked; the welcome then shows, and the spec says so when it fails.
      }
    }, WELCOME_STORAGE_KEY);
    await provide(page);
    if (problems.length > 0 && testInfo.status === testInfo.expectedStatus) {
      throw new Error(`The page had problems the spec did not check:\n- ${problems.join("\n- ")}`);
    }
    if (problems.length > 0) {
      await testInfo.attach("page problems", { body: problems.join("\n"), contentType: "text/plain" });
    }
  },
  api: async ({ playwright }, provide) => {
    const api = await playwright.request.newContext({ baseURL: SERVER_URL });
    await provide(api);
    await api.dispose();
  },
});

/** True for http(s) and ws(s) addresses on this machine, and for data:, blob: and about: pages. */
function isLocal(href: string): boolean {
  const url = new URL(href);
  if (!/^(https?|wss?):$/.test(url.protocol)) return true;
  return LOCAL_HOSTS.has(url.hostname);
}

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

/** The person's own bubble with exactly this text. Screen readers hear it as "You said: <text>". */
export function personSaid(page: Page, text: string): Locator {
  return conversation(page)
    .getByRole("listitem")
    .filter({ hasText: `You said: ${text}` });
}

/** Types a message into the composer and sends it with the Send button. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: /^Message / });
  await composer.fill(text);
  await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).click();
  await expect(personSaid(page, text)).toBeVisible();
}

interface RuleSummary {
  id: string;
  name: string;
  when: string;
  source: string;
}

/** Deletes the rules that `match` picks, so a failed run leaves nothing behind for the next spec. */
export async function deleteRules(
  api: APIRequestContext,
  match: (rule: RuleSummary) => boolean,
): Promise<void> {
  const res = await api.get("/api/rules");
  if (!res.ok()) return;
  const rules = (await res.json()) as RuleSummary[];
  for (const rule of rules) {
    if (match(rule)) await api.delete(`/api/rules/${encodeURIComponent(rule.id)}`);
  }
}

/** Deletes rules a spec added, by name prefix. */
export async function deleteRulesNamed(api: APIRequestContext, prefix: string): Promise<void> {
  await deleteRules(api, (rule) => rule.name.startsWith(prefix));
}

/**
 * An address no other test and no earlier attempt of this one has used, so a retry never passes
 * on what the first attempt left in the record or the Sent folder.
 */
export function uniqueAddress(testInfo: TestInfo, label: string): string {
  return `${label}-${testInfo.retry}-${Date.now().toString(36)}@example.com`;
}

/**
 * The approval card whose summary names `text` (an address, say). The card is a region named by
 * its summary, and says why it asks; the tool's own card in the transcript does neither.
 */
export function approvalCard(page: Page, text: string): Locator {
  return page.getByRole("main").getByRole("region", { name: text }).filter({ hasText: "Why it asks" });
}

interface SentMail {
  to: string[];
  subject: string;
  body: string;
}

/** What the demo inbox's Sent folder holds. */
export async function sentMail(api: APIRequestContext): Promise<SentMail[]> {
  const res = await api.get("/demo-google/__demo/sent");
  expect(res.ok(), "the demo inbox's Sent folder could not be read").toBe(true);
  return (await res.json()) as SentMail[];
}

/** How many entries the record has, from the server's own check of the chain. */
export async function recordLength(api: APIRequestContext): Promise<number> {
  const res = await api.get("/api/audit/verify");
  expect(res.ok(), "the record could not be checked").toBe(true);
  const check = (await res.json()) as { ok: boolean; count: number };
  expect(check.ok, "the record's chain was already broken").toBe(true);
  return check.count;
}
