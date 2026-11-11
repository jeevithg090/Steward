/**
 * Closing never waits forever: a browser in a GPU or renderer hang must not keep the computer shut
 * until Steward restarts. The first case runs real Chromium (Playwright 1.64's cached build).
 */
import { mkdtemp, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentComputer } from "../src/computer.ts";
import { HostPolicy } from "../src/network.ts";
import { PersonInput, Screencast } from "../src/screen.ts";

const never = () => new Promise<never>(() => {});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("closing a browser that has stopped answering", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("kills it after the time limit, and the computer starts again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steward-close-"));
    dirs.push(dir);
    const computer = new AgentComputer({
      agentId: "hung",
      dir,
      headful: false,
      policy: new HostPolicy(),
      actorId: "local",
      closeTimeoutMs: 500,
    });
    await computer.start();
    const lock = await readlink(join(dir, "profile", "SingletonLock"));
    const pid = Number(lock.slice(lock.lastIndexOf("-") + 1));
    expect(isAlive(pid)).toBe(true);

    // Like Playwright with a hung Chromium: close() comes back only once the process has gone.
    const context = (computer as unknown as { context: BrowserContext }).context;
    context.close = () => new Promise<void>((resolve) => context.once("close", () => resolve()));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const started = Date.now();
    await computer.close();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(computer.status().running).toBe(false);
    expect(isAlive(pid)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[computer] the browser for hung did not close within 0.5 s, so it was killed",
    );

    await computer.start();
    expect(computer.status().running).toBe(true);
    expect((await computer.snapshot()).url).toBe("about:blank");
    await computer.close();
  }, 60_000);
});

describe("the screen's CDP sessions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("let go of a session that never answers a detach", async () => {
    vi.useFakeTimers();
    const session = { detach: never, send: never, on: () => {} } as unknown as CDPSession;

    const input = new PersonInput();
    (input as unknown as { session: CDPSession }).session = session;
    let reset = false;
    void input.reset().then(() => {
      reset = true;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reset).toBe(true);

    const cast = new Screencast(() => {});
    Object.assign(cast as unknown as { session: CDPSession; page: Page }, {
      session,
      page: {} as Page,
    });
    let stopped = false;
    void cast.stop().then(() => {
      stopped = true;
    });
    // 2 s for the stop message, 2 s for the detach.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(stopped).toBe(true);
    expect(cast.target).toBeUndefined();
  });
});
