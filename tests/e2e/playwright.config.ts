import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { DEVICE_PORT, SERVER_PORT, SERVER_URL, WEB_PORT, WEB_URL } from "./env.ts";

/**
 * End-to-end tests: the real server and the real web app, driven by Chromium, with the scripted
 * demo model and the demo inbox, so the whole run needs no key and no network.
 *
 *   pnpm e2e                       run everything
 *   pnpm e2e --ui                  watch it run
 *   STEWARD_E2E_REUSE=1 pnpm e2e   reuse servers you already started (never in CI)
 *   STEWARD_E2E_SERVER_PORT=8797 STEWARD_E2E_WEB_PORT=4173 pnpm e2e
 *                                  run beside `pnpm dev`, on ports of its own. The web port must
 *                                  be 5173 or 4173: the server answers only those dev origins.
 *   pnpm build && STEWARD_E2E_BUILT=1 pnpm e2e
 *                                  also run the "built" project: a few specs against the
 *                                  production build, served by the Steward server itself with
 *                                  its real headers, as an install runs it. CI always does.
 *
 * Each run gets a fresh data folder under test-results/e2e-data (the newest three are kept), so a
 * run never reads or changes the data in your own .steward-data. Reusing servers is opt-in for the
 * same reason: a server you started yourself is pointed at your own data, and the tests add rules
 * and refuse emails.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CI = Boolean(process.env.CI);

// Playwright loads this file in the runner and again in each worker. Fixing the folder in the
// environment the first time means the workers, which inherit it, agree with the server. The
// first load also clears out the folders of older runs: with this one, the newest three are kept.
if (!process.env.STEWARD_E2E_DATA_DIR) {
  const runs = join(REPO_ROOT, "test-results", "e2e-data");
  removeOlderRuns(runs, 2);
  process.env.STEWARD_E2E_DATA_DIR = join(runs, `run-${Date.now()}`);
}
const DATA_DIR = process.env.STEWARD_E2E_DATA_DIR;

const reuseExistingServer = !CI && process.env.STEWARD_E2E_REUSE === "1";

// The server serves apps/web/dist when it finds it at start. Opt-in outside CI, so an old build
// left in the folder never fails a run that did not ask for it.
const BUILT = CI || process.env.STEWARD_E2E_BUILT === "1";
if (BUILT && !existsSync(join(REPO_ROOT, "apps", "web", "dist", "index.html"))) {
  throw new Error("The built project needs the production build first: run `pnpm build`.");
}

/** Deletes the `run-<time>` folders in `dir` but the newest `keep`, which a run still going may use. */
function removeOlderRuns(dir: string, keep: number): void {
  if (!existsSync(dir)) return;
  const runs = readdirSync(dir)
    .filter((name) => /^run-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
  for (const name of runs.slice(keep)) rmSync(join(dir, name), { recursive: true, force: true });
}

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // Outside the data folder: Playwright empties its output folder at the start of every run.
  outputDir: join(REPO_ROOT, "test-results", "e2e"),
  // One server, one database: specs run one at a time so one cannot see another's half-done work.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [["github"], ["html", { open: "never", outputFolder: join(REPO_ROOT, "playwright-report") }]]
    : [["list"], ["html", { open: "never", outputFolder: join(REPO_ROOT, "playwright-report") }]],
  use: {
    baseURL: WEB_URL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Through the Vite dev server, which proxies /api and /ws to the Steward server.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The production build, from the Steward server's own origin. A failure only the bundler or
    // the server's Content-Security-Policy causes shows here: the page fixture fails on the
    // console error a blocked resource leaves.
    ...(BUILT
      ? [
          {
            name: "built",
            testMatch: ["chat.spec.ts", "approval.spec.ts", "knowledge.spec.ts"],
            use: { ...devices["Desktop Chrome"], baseURL: SERVER_URL },
          },
        ]
      : []),
  ],
  // Runs once both servers answer, before any spec.
  globalSetup: "./global-setup.ts",
  webServer: [
    {
      name: "server",
      command: "pnpm --filter @steward/server start",
      cwd: REPO_ROOT,
      url: `${SERVER_URL}/api/health`,
      env: {
        STEWARD_MODEL_PROVIDER: "scripted",
        STEWARD_DATA_DIR: DATA_DIR,
        STEWARD_DEMO_GOOGLE: "1",
        STEWARD_TENANT: "steward",
        STEWARD_PORT: String(SERVER_PORT),
        STEWARD_DEVICE_PORT: String(DEVICE_PORT),
        STEWARD_HOST: "127.0.0.1",
        STEWARD_HEADFUL: "0",
        STEWARD_ALLOW_PRIVATE_HOSTS: "0",
        // A small directory of its own, so the bots that ship with Steward never change what is tested.
        STEWARD_DIRECTORY_URL: join(REPO_ROOT, "tests", "e2e", "fixtures", "directory", "index.json"),
        // Set here, so a value in the shell or in .env cannot move the phone port off this machine.
        STEWARD_DEVICE_HOST: "127.0.0.1",
        // Ignore a STEWARD_ENV_FILE from the shell: the run must not pick up someone's real keys.
        // The server still reads <repo>/.env, so global-setup.ts stops the run if a key got in.
        STEWARD_ENV_FILE: "",
      },
      reuseExistingServer,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      name: "web",
      command: `pnpm --filter @steward/web dev --port ${WEB_PORT}`,
      cwd: REPO_ROOT,
      url: WEB_URL,
      env: { STEWARD_SERVER_URL: SERVER_URL },
      reuseExistingServer,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
