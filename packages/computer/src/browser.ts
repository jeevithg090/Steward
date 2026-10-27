/**
 * Adapted from openbot/agent-computer/src/profiles.ts (MIT, CopilotKit).
 *
 * Launches one persistent Chromium profile for one agent. The profile keeps cookies and sign-ins
 * between runs; everything the browser fetches goes through the route guard here and then the
 * egress proxy (egress.ts).
 */
import { mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Route } from "playwright";
import { ComputerError } from "./errors.ts";
import type { HostPolicy } from "./network.ts";

export const VIEWPORT = { width: 1280, height: 800 } as const;

const SINGLETON_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

/**
 * Chromium leaves `Singleton*` links behind when it is killed, and then refuses the profile. They
 * are removed when stale; when another live process on this machine holds the profile, starting is
 * refused instead, because two browsers on one profile corrupt it.
 */
export async function sweepProfileLocks(profileDir: string): Promise<void> {
  const lock = await readlink(join(profileDir, "SingletonLock")).catch(() => undefined);
  if (lock) {
    const dash = lock.lastIndexOf("-");
    const host = lock.slice(0, dash);
    const pid = Number(lock.slice(dash + 1));
    if (host === hostname() && Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) {
      throw new ComputerError(
        "busy",
        `This computer's browser profile is in use by another process (${pid}). Stop the other Steward first.`,
      );
    }
  }
  await Promise.all(SINGLETON_FILES.map((f) => rm(join(profileDir, f), { force: true })));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * WebRTC can reveal local addresses and reach the network without the proxy. The command-line
 * switch no longer works, so the policy goes into the profile's preferences, merged with what is there.
 */
export async function writeProfilePreferences(profileDir: string): Promise<void> {
  const dir = join(profileDir, "Default");
  const file = join(dir, "Preferences");
  await mkdir(dir, { recursive: true });
  let prefs: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object") prefs = parsed as Record<string, unknown>;
  } catch {
    // Missing or unreadable: start fresh.
  }
  const webrtc = (prefs.webrtc && typeof prefs.webrtc === "object" ? prefs.webrtc : {}) as Record<
    string,
    unknown
  >;
  prefs.webrtc = { ...webrtc, ip_handling_policy: "disable_non_proxied_udp" };
  await writeFile(file, JSON.stringify(prefs));
}

export interface LaunchOptions {
  profileDir: string;
  headful: boolean;
  proxyUrl: string;
}

export async function launchBrowser(opts: LaunchOptions): Promise<BrowserContext> {
  await mkdir(opts.profileDir, { recursive: true });
  await sweepProfileLocks(opts.profileDir);
  await writeProfilePreferences(opts.profileDir);
  return chromium.launchPersistentContext(opts.profileDir, {
    // Full Chromium in "new headless" mode, so headless and headful behave the same.
    channel: "chromium",
    headless: !opts.headful,
    viewport: VIEWPORT,
    args: [
      // Without it the first screencast frames are 1280×713 until the first navigation.
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "--disable-blink-features=AutomationControlled",
      // Quiet Chromium's own traffic to Google (sync, pings, field trials, safe-browsing pings,
      // translation, optimisation hints). The agent may still browse Google on purpose.
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--no-pings",
      "--disable-domain-reliability",
      "--disable-client-side-phishing-detection",
      "--metrics-recording-only",
      // No --disable-features here: Chromium honours only the last one, and Playwright's own list
      // (Translate, MediaRouter, certificate-transparency updates, ...) must stay in force.
      // Playwright already passes --use-mock-keychain and --password-store=basic, so macOS never
      // shows a keychain prompt; repeated here so it stays true if those defaults change.
      ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
    ],
    // No automation banner or navigator.webdriver; keep Chromium's own popup blocker.
    ignoreDefaultArgs: ["--enable-automation", "--disable-popup-blocking"],
    // Keep Chromium's sandbox where the OS provides it. Linux containers often lack the namespaces.
    chromiumSandbox: process.platform === "darwin" || process.platform === "win32",
    // Service workers fetch outside `context.route`; the agent's browser does not need them.
    serviceWorkers: "block",
    acceptDownloads: true,
    proxy: { server: opts.proxyUrl },
    // Steward owns shutdown, so the profile is closed cleanly and cookies are flushed.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

/** Schemes a page may load without a network request. Everything else non-web is refused. */
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

/**
 * The first network check: every request a page makes is decided against the host policy before it
 * leaves the browser. Refused requests fail with ERR_BLOCKED_BY_CLIENT and are reported through
 * `onBlocked`. Redirect hops and WebSockets are not shown to routes; the egress proxy covers those.
 */
export async function installRouteGuard(
  context: BrowserContext,
  policy: HostPolicy,
  onBlocked: (blocked: {
    url: string;
    host: string;
    reason: string;
    message: string;
    navigation: boolean;
  }) => void,
): Promise<void> {
  await context.route(
    () => true,
    async (route: Route) => {
      const request = route.request();
      let url: URL;
      try {
        url = new URL(request.url());
      } catch {
        await route.abort("blockedbyclient").catch(() => {});
        return;
      }
      if (LOCAL_SCHEMES.has(url.protocol)) {
        await route.fallback().catch(() => {});
        return;
      }
      const verdict = await policy.checkUrl(url);
      if (verdict.ok) {
        await route.fallback().catch(() => {});
        return;
      }
      if (verdict.reason === "unresolved") {
        await route.abort("namenotresolved").catch(() => {});
        return;
      }
      onBlocked({
        url: url.href,
        host: verdict.host,
        reason: verdict.reason,
        message: verdict.message,
        navigation: request.isNavigationRequest(),
      });
      await route.abort("blockedbyclient").catch(() => {});
    },
  );
}
