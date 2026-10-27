/**
 * One agent's computer: a Chromium profile, a workspace folder and a restricted shell, plus the
 * live screen, take the wheel and the secret box. Adapted in structure from OpenBot's
 * agent-computer (MIT, CopilotKit), but in-process: no container, no separate server.
 *
 * Every acting method passes the wheel's single gate (`WheelControl.admit`) before it touches
 * anything, so nothing the agent does can run underneath the person.
 */
import { createHmac, randomBytes } from "node:crypto";
import { lstat, mkdir, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type {
  ActivityItem,
  AuditLog,
  AuditType,
  Computer,
  ComputerClientMessage,
  ComputerServerMessage,
  ComputerStatus,
  PageObservation,
  SecretRequest,
  ShellResult,
  WorkspaceFile,
} from "@steward/shared";
import { newId, nowIso } from "@steward/shared";
import type { BrowserContext, Download, Locator, Page } from "playwright";
import { ActivityLog, commandLabel, currentToolCall, durationLabel, elementLabel } from "./activity.ts";
import { installRouteGuard, launchBrowser, VIEWPORT } from "./browser.ts";
import { WheelControl } from "./control.ts";
import { BLOCKED_HEADER, type EgressProxy, startEgressProxy } from "./egress.ts";
import {
  briefCause,
  ComputerError,
  isComputerError,
  isNavigationRace,
  MESSAGES,
  staleRef,
} from "./errors.ts";
import { parseClientMessage } from "./messages.ts";
import { displayUrl, type HostPolicy, parseWebUrl } from "./network.ts";
import { type FrameMessage, PersonInput, Screencast } from "./screen.ts";
import { runShell } from "./shell.ts";
import {
  type AriaItem,
  FIELD_ROLES,
  indexRefs,
  RefBook,
  type RefEntry,
  renderSnapshot,
  SECRET_ATTRIBUTE,
  SENSITIVE_FIELD_SELECTOR,
  toAriaItems,
  valueFieldRefs,
} from "./snapshot.ts";
import { DEFAULT_READ_BYTES, formatBytes, Workspace } from "./workspace.ts";

export const ACTION_TIMEOUT_MS = 10_000;
export const NAVIGATION_TIMEOUT_MS = 30_000;
export const SECRET_TIMEOUT_MS = 10 * 60_000;
const SETTLE_MS = 150;
/** Smooth scrolling animates; wait until the page stops moving, up to this long. */
const SCROLL_SETTLE_MAX_MS = 1_500;
const DEFAULT_SCROLL_PX = 600;
const MAX_TYPED_CHARS = 20_000;
const MAX_SECRET_CHARS = 4_096;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const BLOCK_NOTICE_MS = 60_000;

type Listener = (msg: ComputerServerMessage) => void;

export interface AgentComputerOptions {
  agentId: string;
  /** `<dataDir>/computers/<agentId>`: holds `profile`, `workspace` and `tmp`. */
  dir: string;
  headful: boolean;
  policy: HostPolicy;
  audit?: AuditLog;
  actorId: string;
}

interface PendingSecret {
  request: SecretRequest;
  pwRef: string;
  /** Set while the value is being typed, so a double submit types it once. */
  filling?: boolean;
  finish: (result: { filled: boolean; length: number }) => void;
}

interface BlockedNote {
  at: number;
  host: string;
  message: string;
  navigation?: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : "";
  } catch {
    return "";
  }
}

function pageLabel(url: string): string {
  return hostOf(url) ? displayUrl(url) : "a blank page";
}

export class AgentComputer implements Computer {
  readonly agentId: string;

  private readonly opts: AgentComputerOptions;
  private readonly workspace: Workspace;
  private readonly profileDir: string;
  private readonly tmpDir: string;
  private readonly control = new WheelControl(() => this.emitStatus());
  private readonly log: ActivityLog;
  private readonly listeners = new Set<Listener>();
  private readonly cast = new Screencast((frame) => this.onFrame(frame));
  private readonly input = new PersonInput();
  private readonly refs = new RefBook();
  private readonly wired = new WeakSet<Page>();
  private readonly shells = new Set<() => void>();

  private context: BrowserContext | undefined;
  private proxy: EgressProxy | undefined;
  private livePage: Page | undefined;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  /** Bumped whenever the live document changes; a snapshot from an older generation is stale. */
  private generation = 0;
  private snap: { generation: number; entries: Map<string, RefEntry> } | undefined;
  private title = "";
  private secret: PendingSecret | undefined;
  private castChain: Promise<void> = Promise.resolve();
  private lastFrame: FrameMessage | undefined;
  private lastStatusKey = "";
  private blocks: BlockedNote[] = [];
  /** Dialogs the page raised since the last observation, told to the model with the next one. */
  private dialogNotes: string[] = [];
  /** Set by an explicit close: only `start` (the manager's get or reset) brings the browser back. */
  private closed = false;
  /**
   * Keyed digests of values typed through the secret box, never the values. They let a URL that
   * echoes a filled value (a GET form) be cleaned before it reaches the model or the screen.
   */
  private readonly secretKey = randomBytes(32);
  private readonly secretDigests = new Set<string>();
  private blockNotices = new Map<string, number>();

  constructor(opts: AgentComputerOptions) {
    this.opts = opts;
    this.agentId = opts.agentId;
    this.workspace = new Workspace(join(opts.dir, "workspace"));
    this.profileDir = join(opts.dir, "profile");
    this.tmpDir = join(opts.dir, "tmp");
    this.log = new ActivityLog(opts.agentId, (item) => this.broadcast({ type: "activity", item }));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────────────────────

  /** Starts the browser if it is not running. Safe to call concurrently. */
  async start(): Promise<void> {
    if (this.stopping) await this.stopping;
    this.closed = false;
    if (this.context) return;
    this.starting ??= this.launch().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async launch(): Promise<void> {
    await this.workspace.init();
    await mkdir(this.tmpDir, { recursive: true });
    const proxy = await startEgressProxy({
      policy: this.opts.policy,
      onBlocked: (b) => this.noteBlocked({ at: Date.now(), host: b.host, message: b.message }),
    });
    let context: BrowserContext;
    try {
      context = await launchBrowser({
        profileDir: this.profileDir,
        headful: this.opts.headful,
        proxyUrl: proxy.url,
      });
      await installRouteGuard(context, this.opts.policy, (b) =>
        this.noteBlocked({ at: Date.now(), host: b.host, message: b.message, navigation: b.navigation }),
      );
    } catch (error) {
      await proxy.close().catch(() => {});
      if (isComputerError(error)) throw error;
      const missing = /Executable doesn't exist|browserType\.launch/i.test(String(error));
      throw new ComputerError(
        "failed",
        missing
          ? "Chromium is not installed for Playwright. Run `pnpm exec playwright install chromium`."
          : `The browser could not start: ${briefCause(error)}`,
      );
    }
    this.proxy = proxy;
    this.context = context;
    context.on("page", (page) => this.adopt(page));
    context.on("close", () => this.onContextClosed(context));
    const page = context.pages()[0] ?? (await context.newPage());
    this.adopt(page);
    this.emitStatus();
    this.reconcileCast();
  }

  /** Closes the browser and everything waiting on it. The workspace and the profile stay. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.starting) await this.starting.catch(() => {});
    this.stopping ??= this.shutdown().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  private async shutdown(): Promise<void> {
    const context = this.context;
    const proxy = this.proxy;
    this.context = undefined;
    this.proxy = undefined;
    this.livePage = undefined;
    for (const stop of this.shells) stop();
    this.control.interrupt();
    this.finishSecret({ filled: false, length: 0 });
    this.reconcileCast();
    await this.castChain;
    await this.input.reset();
    if (context) await context.close().catch(() => {});
    if (proxy) await proxy.close().catch(() => {});
    this.secretDigests.clear();
    this.documentChanged();
    this.emitStatus();
  }

  private onContextClosed(context: BrowserContext): void {
    if (this.context !== context) return;
    // The browser went away by itself (crash, or the window was closed in headful mode).
    this.context = undefined;
    this.livePage = undefined;
    const proxy = this.proxy;
    this.proxy = undefined;
    void proxy?.close().catch(() => {});
    this.control.interrupt();
    this.finishSecret({ filled: false, length: 0 });
    this.documentChanged();
    this.reconcileCast();
    this.emitStatus();
  }

  // ── Pages ────────────────────────────────────────────────────────────────────────────────────

  private adopt(page: Page): void {
    if (!this.wired.has(page)) {
      this.wired.add(page);
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame() && page === this.livePage) this.documentChanged();
      });
      page.on("domcontentloaded", () => this.refreshTitle(page));
      page.on("load", () => this.refreshTitle(page));
      page.on("close", () => {
        if (page === this.livePage) this.retarget();
      });
      page.on("download", (download) => void this.saveDownload(download));
      // Headless Chromium draws no dialogs, so nobody could answer one. Leaving a page is allowed;
      // anything else is dismissed, the safe answer to "Delete this?", and the model is told.
      page.on("dialog", (dialog) => {
        const kind = dialog.type();
        const message = dialog.message().replace(/\s+/g, " ").trim().slice(0, 200);
        if (kind === "beforeunload") {
          dialog.accept().catch(() => {});
          return;
        }
        dialog.dismiss().catch(() => {});
        const note = `The page showed a ${kind} box${message ? `: "${message}"` : ""}. Steward dismissed it.`;
        this.dialogNotes.push(note);
        if (this.dialogNotes.length > 5) this.dialogNotes.shift();
        this.log.add({ kind: "click", text: `Dismissed a ${kind} box from the page`, ok: true });
      });
    }
    // The newest page is the live one, so a popup the agent opened is what it sees next.
    if (!page.isClosed()) this.setLive(page);
  }

  private setLive(page: Page): void {
    if (this.livePage === page) return;
    this.livePage = page;
    this.documentChanged();
    void this.input.reset();
    this.reconcileCast();
  }

  private retarget(): void {
    const open = this.context?.pages().filter((p) => !p.isClosed()) ?? [];
    const next = open.at(-1);
    if (next) {
      this.setLive(next);
      return;
    }
    this.livePage = undefined;
    this.documentChanged();
    this.reconcileCast();
  }

  /** The live document changed: refs from earlier snapshots no longer apply. */
  private documentChanged(): void {
    this.generation++;
    this.refs.newDocument();
    this.title = "";
    this.emitStatus();
  }

  private refreshTitle(page: Page): void {
    page
      .title()
      .then((title) => {
        if (page !== this.livePage) return;
        this.title = title;
        this.emitStatus();
      })
      .catch(() => {});
  }

  /**
   * The live page. Starts the browser when it is not running, unless it was closed on purpose or
   * the caller is mid-action (`restart: false`): an action never brings back a browser that stopped
   * under it.
   */
  private async ensurePage(opts: { restart?: boolean } = {}): Promise<Page> {
    if (!this.context && (this.closed || opts.restart === false)) {
      throw new ComputerError("closed", MESSAGES.computerStopped);
    }
    await this.start();
    const context = this.context;
    if (!context) throw new ComputerError("closed", MESSAGES.computerStopped);
    if (this.livePage && !this.livePage.isClosed()) return this.livePage;
    const open = context.pages().filter((p) => !p.isClosed());
    const page = open.at(-1) ?? (await context.newPage());
    this.adopt(page);
    return page;
  }

  /** Runs one agent action on the screen. It holds the barrier, so a take waits for it to finish. */
  private async screenAction<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const release = this.control.admit(true);
    try {
      return await fn(await this.ensurePage());
    } finally {
      release();
    }
  }

  private requireFreshLook(): void {
    if (this.control.snapshotRequired)
      throw new ComputerError("snapshot_required", MESSAGES.snapshotAfterHandback);
  }

  // ── Snapshots and refs ───────────────────────────────────────────────────────────────────────

  /**
   * Playwright's AI snapshot. Never call a default-mode snapshot on this page: Playwright resolves
   * refs against the latest snapshot of a frame, and a default-mode one has no refs, so it would
   * silently invalidate every ref the model holds.
   */
  private async capture(page: Page, boxes: boolean): Promise<AriaItem[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        return toAriaItems(await page.ariaSnapshotJSON({ mode: "ai", boxes, timeout: ACTION_TIMEOUT_MS }));
      } catch (error) {
        if (attempt >= 2 || !isNavigationRace(error)) {
          throw new ComputerError("failed", `The page could not be read: ${briefCause(error)}`);
        }
        await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
      }
    }
  }

  private async sensitiveRefs(page: Page, items: AriaItem[]): Promise<Set<string>> {
    const masked = new Set<string>();
    await Promise.all(
      valueFieldRefs(items).map(async (pwRef) => {
        const sensitive = await page
          .getByRef(pwRef)
          .evaluate((el, selector) => el.matches(selector), SENSITIVE_FIELD_SELECTOR, { timeout: 1_000 })
          // If the check fails, hide the value: fail closed.
          .catch(() => true);
        if (sensitive) masked.add(pwRef);
      }),
    );
    return masked;
  }

  private async observe(page: Page): Promise<PageObservation> {
    let items: AriaItem[] = [];
    let generation = this.generation;
    // A navigation can land while the snapshot is taken; look again so refs match the document.
    for (let attempt = 0; attempt < 3; attempt++) {
      generation = this.generation;
      items = await this.capture(page, true);
      if (generation === this.generation) break;
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    }
    const masked = await this.sensitiveRefs(page, items);
    const rendered = renderSnapshot(items, { refFor: (pwRef) => this.refs.refFor(pwRef), masked });
    this.snap = { generation, entries: rendered.entries };
    this.control.snapshotTaken();
    const title = await page.title().catch(() => this.title);
    if (page === this.livePage) {
      this.title = title;
      this.emitStatus();
    }
    const notes = this.dialogNotes.map((note) => `[${note}]\n`).join("");
    this.dialogNotes = [];
    return {
      url: this.safeUrl(page.url()),
      title,
      snapshot: `${notes}${rendered.text || "[The page is empty.]"}`,
      truncated: rendered.truncated,
    };
  }

  /** Waits briefly for what the action started, then follows the live page (a popup may have opened). */
  private async settle(): Promise<Page> {
    await delay(SETTLE_MS);
    const page = await this.ensurePage({ restart: false });
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    return page;
  }

  /**
   * Turns a ref from the model into a locator, or refuses with a clear "stale ref". The ref must be
   * in the latest snapshot of this document, and a fresh look must find the same element under it
   * with the same role and name, so a page that renamed "Next" to "Pay" cannot redirect a click.
   */
  private async resolveRef(
    page: Page,
    ref: unknown,
  ): Promise<{ locator: Locator; entry: RefEntry; ref: string }> {
    if (typeof ref !== "string" || !/^\s*e\d+\s*$/.test(ref)) {
      throw new ComputerError("bad_input", "Give a ref from your latest snapshot, such as e12.");
    }
    const id = ref.trim();
    this.requireFreshLook();
    const snap = this.snap;
    if (!snap) throw new ComputerError("snapshot_required", MESSAGES.noSnapshot);
    const entry = snap.entries.get(id);
    if (!entry) throw staleRef(id, " it is not in your latest snapshot, so");
    if (snap.generation !== this.generation)
      throw staleRef(id, " the page has changed since your last snapshot, so");
    const now = indexRefs(await this.capture(page, false)).get(entry.pwRef);
    if (!now || now.role !== entry.role || now.name !== entry.name) {
      throw staleRef(id, " that element changed since your last snapshot, so");
    }
    const locator = page.getByRef(entry.pwRef);
    if ((await locator.count()) === 0) throw staleRef(id, " that element is no longer on the page, so");
    return { locator, entry, ref: id };
  }

  // ── Browser tools ────────────────────────────────────────────────────────────────────────────

  status(): ComputerStatus {
    const page = this.livePage && !this.livePage.isClosed() ? this.livePage : undefined;
    const url = page ? this.safeUrl(page.url()) : undefined;
    const pending = this.secret?.request;
    return {
      agentId: this.agentId,
      running: this.context !== undefined,
      ...(url ? { url } : {}),
      ...(this.title ? { title: this.title } : {}),
      controller: this.control.controller,
      ...(this.control.help ? { help: { ...this.control.help } } : {}),
      ...(pending ? { secret: { ...pending } } : {}),
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    };
  }

  async navigate(url: string): Promise<PageObservation> {
    const target = parseWebUrl(url);
    return this.screenAction(async (page) => {
      await this.openUrl(page, target, "agent");
      this.log.add({ kind: "navigate", text: `Opened ${pageLabel(this.safeUrl(page.url()))}`, ok: true });
      return this.observe(await this.settle());
    });
  }

  /** Checks and opens a URL for either driver. Throws a readable refusal when it is blocked. */
  private async openUrl(page: Page, target: URL, who: "agent" | "person"): Promise<void> {
    const verdict = await this.opts.policy.checkUrl(target);
    if (!verdict.ok) {
      if (verdict.reason === "unresolved") throw new ComputerError("not_found", verdict.message);
      this.log.add({ kind: "navigate", text: `Refused to open ${displayUrl(target)}`, ok: false });
      throw new ComputerError("blocked", verdict.message);
    }
    const since = Date.now();
    let response: Awaited<ReturnType<Page["goto"]>>;
    try {
      response = await page.goto(target.href, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      const blocked = this.blockedSince(since, error);
      if (blocked) throw blocked;
      if (who === "agent")
        this.log.add({ kind: "navigate", text: `Could not open ${displayUrl(target)}`, ok: false });
      throw navigationError(error, target);
    }
    if (response?.headers()[BLOCKED_HEADER]) {
      throw this.blockedSince(since) ?? new ComputerError("blocked", "Steward blocked that address.");
    }
  }

  async snapshot(): Promise<PageObservation> {
    const page = await this.ensurePage();
    const observation = await this.observe(page);
    this.log.add({ kind: "snapshot", text: `Looked at ${pageLabel(observation.url)}`, ok: true });
    return observation;
  }

  async click(ref: string): Promise<PageObservation> {
    return this.screenAction(async (page) => {
      const { locator, entry } = await this.resolveRef(page, ref);
      const label = elementLabel(entry.role, entry.name);
      try {
        await locator.click({ timeout: ACTION_TIMEOUT_MS });
      } catch (error) {
        this.log.add({ kind: "click", text: `Could not click ${label}`, ok: false });
        throw actionError(error, `Could not click ${label}`);
      }
      this.log.add({ kind: "click", text: `Clicked ${label}`, ok: true });
      return this.observe(await this.settle());
    });
  }

  async type(ref: string, text: string, opts: { submit?: boolean } = {}): Promise<PageObservation> {
    if (typeof text !== "string") throw new ComputerError("bad_input", "Give the text to type.");
    if (text.length > MAX_TYPED_CHARS)
      throw new ComputerError("bad_input", "That is too much text to type at once.");
    return this.screenAction(async (page) => {
      const { locator, entry } = await this.resolveRef(page, ref);
      const label = elementLabel(entry.role, entry.name);
      let chose = false;
      try {
        const isSelect = await locator
          .evaluate((el) => el instanceof HTMLSelectElement, undefined, { timeout: ACTION_TIMEOUT_MS })
          .catch(() => false);
        if (isSelect) {
          const value = await locator.evaluate(
            (el, wanted) => {
              const want = wanted.trim().toLowerCase();
              const options = Array.from((el as HTMLSelectElement).options).filter((o) => !o.disabled);
              const hit =
                options.find((o) => o.label.trim().toLowerCase() === want) ??
                options.find((o) => o.text.trim().toLowerCase() === want) ??
                options.find((o) => o.value.trim().toLowerCase() === want);
              return hit ? hit.value : null;
            },
            text,
            { timeout: ACTION_TIMEOUT_MS },
          );
          if (value === null) {
            throw new ComputerError(
              "bad_input",
              `${label} has no option with that name. Use one of the options in the snapshot.`,
            );
          }
          await locator.selectOption({ value }, { timeout: ACTION_TIMEOUT_MS });
          chose = true;
        } else {
          await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
        }
        if (opts.submit) await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
      } catch (error) {
        this.log.add({ kind: "type", text: `Could not type into ${label}`, ok: false });
        if (isComputerError(error)) throw error;
        throw typingError(error, label);
      }
      const submitted = opts.submit ? " and pressed Enter" : "";
      this.log.add({
        kind: "type",
        text: chose
          ? `Chose an option in ${label}${submitted}`
          : `Typed into ${label} (${text.length} characters)${submitted}`,
        ok: true,
      });
      return this.observe(await this.settle());
    });
  }

  async press(key: string): Promise<PageObservation> {
    if (typeof key !== "string" || key.trim() === "" || key.length > 50) {
      throw new ComputerError("bad_input", "Give a key name, such as Enter, Tab or Escape.");
    }
    const name = key.trim();
    return this.screenAction(async (page) => {
      this.requireFreshLook();
      try {
        await page.keyboard.press(name);
      } catch (error) {
        if (/Unknown key/i.test(String(error))) {
          throw new ComputerError(
            "bad_input",
            "That is not a key name. Use names like Enter, Tab, Escape or ArrowDown.",
          );
        }
        throw actionError(error, `Could not press ${name}`);
      }
      this.log.add({ kind: "key", text: `Pressed ${name}`, ok: true });
      return this.observe(await this.settle());
    });
  }

  async scroll(direction: "up" | "down", amount?: number): Promise<PageObservation> {
    if (direction !== "up" && direction !== "down")
      throw new ComputerError("bad_input", "Scroll up or down.");
    if (amount !== undefined && !(Number.isFinite(amount) && amount > 0)) {
      throw new ComputerError("bad_input", "Give the scroll amount in pixels, such as 600.");
    }
    const pixels = Math.min(20_000, Math.round(amount ?? DEFAULT_SCROLL_PX));
    return this.screenAction(async (page) => {
      this.requireFreshLook();
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
      await page.mouse.wheel(0, direction === "down" ? pixels : -pixels);
      await settleScroll(page);
      this.log.add({ kind: "scroll", text: `Scrolled ${direction}`, ok: true });
      return this.observe(page);
    });
  }

  async back(): Promise<PageObservation> {
    return this.screenAction(async (page) => {
      this.requireFreshLook();
      const before = page.url();
      const since = Date.now();
      let response: Awaited<ReturnType<Page["goBack"]>>;
      try {
        response = await page.goBack({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      } catch (error) {
        throw this.blockedSince(since, error) ?? actionError(error, "Could not go back");
      }
      if (response === null && page.url() === before) {
        throw new ComputerError("bad_input", "There is no earlier page to go back to.");
      }
      this.log.add({
        kind: "navigate",
        text: `Went back to ${pageLabel(this.safeUrl(page.url()))}`,
        ok: true,
      });
      return this.observe(await this.settle());
    });
  }

  async describe(ref: string): Promise<{ role?: string; name?: string } | undefined> {
    const entry = typeof ref === "string" ? this.snap?.entries.get(ref.trim()) : undefined;
    return entry ? { role: entry.role, name: entry.name } : undefined;
  }

  // ── Help and the secret box ──────────────────────────────────────────────────────────────────

  async requestHelp(reason: string, opts: { signal?: AbortSignal } = {}): Promise<{ released: boolean }> {
    const text = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
    if (!text || text.length > 500) {
      throw new ComputerError("bad_input", "Say what you need the person to do, in one sentence.");
    }
    const page = await this.ensurePage();
    const first = this.control.help === undefined;
    const wait = this.control.requestHelp(text, opts.signal ? { signal: opts.signal } : {});
    if (first) {
      this.record("computer.help_requested", { reason: text, host: hostOf(page.url()) });
      this.log.add({ kind: "help", text: `Asked for your help: ${text}`, ok: true });
    }
    const result = await wait;
    if (!result.released) this.log.add({ kind: "help", text: "Stopped waiting for help", ok: false });
    return result;
  }

  async requestSecret(
    ref: string,
    label: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ filled: boolean; length: number }> {
    const what = typeof label === "string" ? label.replace(/\s+/g, " ").trim() : "";
    if (!what || what.length > 200) {
      throw new ComputerError(
        "bad_input",
        "Say what you need in a few words, such as 'Password for example.com'.",
      );
    }
    this.control.assertAgentMayAct();
    if (this.secret)
      throw new ComputerError("busy", `Steward is already waiting for ${this.secret.request.label}.`);
    const page = await this.ensurePage();
    const resolved = await this.resolveRef(page, ref);
    if (!FIELD_ROLES.has(resolved.entry.role)) {
      throw new ComputerError(
        "bad_input",
        "That is not a text field. Give the ref of the field the value goes into.",
      );
    }
    const host = hostOf(page.url());
    if (!host) throw new ComputerError("bad_input", "Open the page that needs the value first.");
    if (this.secret) throw new ComputerError("busy", "Steward is already waiting for another value.");

    const request: SecretRequest = {
      id: newId("sec"),
      ref: resolved.ref,
      label: what,
      host,
      requestedAt: nowIso(),
    };
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => this.finishSecret({ filled: false, length: 0 }, request.id);
      const finish = (result: { filled: boolean; length: number }) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      this.secret = { request, pwRef: resolved.entry.pwRef, finish };
      timer = setTimeout(() => {
        this.log.add({ kind: "secret", text: `Nobody entered ${what}`, ok: false });
        this.finishSecret({ filled: false, length: 0 }, request.id);
      }, SECRET_TIMEOUT_MS);
      this.record("secret.requested", { label: what, host });
      this.log.add({ kind: "secret", text: `Asked you for ${what} on ${host}`, ok: true });
      this.emitStatus();
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Clears the pending secret request (only `id`'s, when given) and answers whoever waits on it. */
  private finishSecret(result: { filled: boolean; length: number }, id?: string): void {
    const pending = this.secret;
    if (!pending || (id !== undefined && pending.request.id !== id)) return;
    this.secret = undefined;
    pending.finish(result);
    this.emitStatus();
  }

  /**
   * The person's value from the secret box. It goes into the field and nowhere else: it is not
   * logged, stored, returned or put in activity text, and Playwright's errors are not passed on,
   * because they can quote their arguments.
   */
  private async fillSecret(requestId: string, value: string): Promise<void> {
    const pending = this.secret;
    if (!pending || pending.request.id !== requestId) {
      this.sendError("Nothing is waiting for that value any more.");
      return;
    }
    if (value.length === 0 || value.length > MAX_SECRET_CHARS) {
      this.sendError("Type the value into the box, then send it.");
      return;
    }
    if (pending.filling) return;
    pending.filling = true;
    const { request } = pending;
    const page = this.livePage;
    if (!page || page.isClosed() || hostOf(page.url()) !== request.host) {
      this.finishSecret({ filled: false, length: 0 }, request.id);
      this.log.add({ kind: "secret", text: `Did not fill ${request.label}: the page changed`, ok: false });
      this.sendError("The page changed, so the value was not typed. Steward will need to ask again.");
      return;
    }
    try {
      const field = page.getByRef(pending.pwRef);
      if ((await field.count()) === 0) throw new Error("gone");
      // Mark first, so no snapshot can catch the value in clear text between the fill and the mark.
      await field.evaluate(
        (el, attr) => {
          el.setAttribute(attr, "true");
          (el as HTMLElement).style?.setProperty("-webkit-text-security", "disc", "important");
        },
        SECRET_ATTRIBUTE,
        { timeout: 2_000 },
      );
      await field.fill(value, { timeout: ACTION_TIMEOUT_MS });
    } catch {
      this.finishSecret({ filled: false, length: 0 }, request.id);
      this.log.add({ kind: "secret", text: `Could not fill ${request.label}`, ok: false });
      this.sendError("The value could not be typed into the field. Steward will need to ask again.");
      return;
    }
    const length = value.length;
    this.secretDigests.add(this.digest(value));
    this.record("secret.filled", { length, host: request.host });
    this.log.add({
      kind: "secret",
      text: `Filled ${request.label} on ${request.host} (${length} characters)`,
      ok: true,
    });
    this.finishSecret({ filled: true, length }, request.id);
  }

  private digest(value: string): string {
    return createHmac("sha256", this.secretKey).update(value).digest("base64url");
  }

  /** The URL with any query value or path segment that equals a filled secret replaced. */
  private safeUrl(raw: string): string {
    if (this.secretDigests.size === 0) return raw;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return raw;
    }
    const hidden = (text: string) => text !== "" && this.secretDigests.has(this.digest(text));
    let changed = false;
    for (const [key, value] of [...url.searchParams]) {
      if (hidden(value)) {
        url.searchParams.set(key, "hidden");
        changed = true;
      }
    }
    const segments = url.pathname.split("/").map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // Keep the raw segment.
      }
      if (!hidden(decoded)) return segment;
      changed = true;
      return "hidden";
    });
    if (hidden(url.hash.slice(1))) {
      url.hash = "hidden";
      changed = true;
    }
    if (!changed) return raw;
    url.pathname = segments.join("/");
    return url.href;
  }

  // ── Workspace and shell ──────────────────────────────────────────────────────────────────────

  async listFiles(dir?: string): Promise<WorkspaceFile[]> {
    return this.workspace.list(dir);
  }

  async readFile(path: string, opts: { maxBytes?: number } = {}): Promise<string> {
    const limit = opts.maxBytes ?? DEFAULT_READ_BYTES;
    try {
      const file = await this.workspace.read(path, limit);
      this.log.add({ kind: "file", text: `Read ${file.path} (${formatBytes(file.size)})`, ok: true });
      return file.truncated
        ? `${file.text}\n\n[Showing the first ${formatBytes(Buffer.byteLength(file.text))} of ${formatBytes(file.size)}.]`
        : file.text;
    } catch (error) {
      this.log.add({ kind: "file", text: `Could not read ${String(path).slice(0, 80)}`, ok: false });
      throw error;
    }
  }

  async writeFile(path: string, content: string): Promise<WorkspaceFile> {
    this.control.admit(false);
    try {
      const file = await this.workspace.write(path, content);
      this.log.add({ kind: "file", text: `Saved ${file.path} (${formatBytes(file.size)})`, ok: true });
      return file;
    } catch (error) {
      this.log.add({ kind: "file", text: `Could not save ${String(path).slice(0, 80)}`, ok: false });
      throw error;
    }
  }

  async runShell(
    command: string,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<ShellResult> {
    this.control.admit(false);
    const cwd = await this.workspace.root();
    await mkdir(this.tmpDir, { recursive: true });
    const result = await runShell(command, {
      cwd,
      tmpDir: this.tmpDir,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      onStart: (stop) => {
        this.shells.add(stop);
        return () => this.shells.delete(stop);
      },
    });
    const label = `Ran \`${commandLabel(command)}\``;
    const note = result.timedOut
      ? ` (stopped after ${durationLabel(result.durationMs)})`
      : result.exitCode === 0
        ? ""
        : result.exitCode === null
          ? " (stopped)"
          : ` (exit code ${result.exitCode})`;
    const output = result.stdout.trim() || result.stderr.trim();
    this.log.add({
      kind: "shell",
      text: `${label}${note}`,
      ...(output ? { output } : {}),
      ok: result.exitCode === 0 && !result.timedOut,
    });
    return result;
  }

  activity(limit?: number): ActivityItem[] {
    return this.log.list(limit);
  }

  // ── The live screen ──────────────────────────────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.sendTo(listener, { type: "status", status: this.status() });
    if (this.lastFrame && this.context) this.sendTo(listener, this.lastFrame);
    this.reconcileCast();
    return () => {
      if (this.listeners.delete(listener)) this.reconcileCast();
    };
  }

  /** Input from the person's screen. Never throws: problems go back to the screen as an error message. */
  async handle(raw: ComputerClientMessage): Promise<void> {
    try {
      await this.dispatch(raw);
    } catch (error) {
      this.sendError(isComputerError(error) ? error.message : "That could not be done on the screen.");
    }
  }

  private async dispatch(raw: unknown): Promise<void> {
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.sendError("That message was not understood.");
      return;
    }
    switch (msg.type) {
      case "take": {
        await this.ensurePage();
        if (await this.control.take()) {
          this.record("computer.control_taken", { host: hostOf(this.livePage?.url() ?? "") });
          this.log.add({ kind: "control", text: "You took the wheel", ok: true });
        }
        return;
      }
      case "release": {
        const held = this.control.controller === "person";
        if (this.control.release()) {
          this.record("computer.control_released", { host: hostOf(this.livePage?.url() ?? ""), took: held });
          this.log.add({
            kind: "control",
            text: held ? "You handed the wheel back" : "You told Steward to carry on",
            ok: true,
          });
        }
        return;
      }
      case "secret":
        await this.fillSecret(msg.requestId, msg.value);
        return;
      case "secret.cancel": {
        const pending = this.secret;
        if (pending && pending.request.id === msg.requestId) {
          this.log.add({
            kind: "secret",
            text: `You cancelled the request for ${pending.request.label}`,
            ok: false,
          });
          this.finishSecret({ filled: false, length: 0 }, msg.requestId);
        }
        return;
      }
      default: {
        if (this.control.controller !== "person") {
          this.sendError(MESSAGES.takeTheWheelFirst);
          return;
        }
        const page = await this.ensurePage();
        if (msg.type === "navigate") {
          await this.openUrl(page, parseWebUrl(msg.url), "person");
          return;
        }
        await this.input.dispatch(page, msg);
      }
    }
  }

  private reconcileCast(): void {
    this.castChain = this.castChain.then(() => this.syncCast()).catch(() => {});
  }

  /** Brings the screencast in line with what is wanted: on the live page while anyone watches. */
  private async syncCast(): Promise<void> {
    const page = this.livePage;
    const want = this.listeners.size > 0 && this.context && page && !page.isClosed() ? page : undefined;
    if (this.cast.target === want) return;
    if (this.cast.target) {
      await this.cast.stop();
      this.lastFrame = undefined;
    }
    if (!want) return;
    try {
      await this.cast.start(want);
    } catch {
      await this.cast.stop();
    }
  }

  private onFrame(frame: FrameMessage): void {
    this.lastFrame = frame;
    this.broadcast(frame);
  }

  private emitStatus(): void {
    const status = this.status();
    const key = JSON.stringify(status);
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    this.broadcast({ type: "status", status });
  }

  private broadcast(msg: ComputerServerMessage): void {
    for (const listener of this.listeners) this.sendTo(listener, msg);
  }

  private sendTo(listener: Listener, msg: ComputerServerMessage): void {
    try {
      listener(msg);
    } catch {
      // A broken listener must not stop the others.
    }
  }

  private sendError(message: string): void {
    this.broadcast({ type: "error", message });
  }

  // ── Records, blocks and downloads ────────────────────────────────────────────────────────────

  private record(type: AuditType, detail: Record<string, unknown>): void {
    const audit = this.opts.audit;
    if (!audit) return;
    const toolCallId = currentToolCall();
    try {
      audit.append({
        type,
        actorId: this.opts.actorId,
        agentId: this.agentId,
        ...(toolCallId ? { toolCallId } : {}),
        detail,
      });
    } catch {
      // The record failing must not trap the person out of their own screen. Say so on the server.
      console.warn(`[computer] could not write ${type} to the record for ${this.agentId}`);
    }
  }

  private noteBlocked(note: BlockedNote): void {
    this.blocks.push(note);
    if (this.blocks.length > 50) this.blocks.splice(0, this.blocks.length - 50);
    // One line per host per minute, so a page hammering a blocked host does not flood the log.
    const last = this.blockNotices.get(note.host) ?? 0;
    if (note.at - last < BLOCK_NOTICE_MS) return;
    if (this.blockNotices.size > 200) this.blockNotices.clear();
    this.blockNotices.set(note.host, note.at);
    this.log.add({ kind: "navigate", text: `Blocked a request to ${note.host}`, ok: false });
  }

  /**
   * The refusal for a navigation a check stopped, if one did: the route guard fails it with
   * ERR_BLOCKED_BY_CLIENT, the proxy with a refused tunnel (HTTPS) or a marked 403 page (HTTP,
   * called without an error). Other failures are not blamed on a block.
   */
  private blockedSince(since: number, error?: unknown): ComputerError | undefined {
    const text = error === undefined ? "" : String(error);
    const byRoute = /ERR_BLOCKED_BY_CLIENT/.test(text);
    if (error !== undefined && !byRoute && !/ERR_TUNNEL_CONNECTION_FAILED/.test(text)) return undefined;
    const note = [...this.blocks].reverse().find((b) => b.at >= since);
    if (note)
      return new ComputerError("blocked", `The page tried to go to a blocked address. ${note.message}`);
    return byRoute ? new ComputerError("blocked", "Steward blocked that address.") : undefined;
  }

  private async saveDownload(download: Download): Promise<void> {
    const name = safeFileName(download.suggestedFilename());
    try {
      const root = await this.workspace.root();
      const dir = await this.workspace.realParent(root, ["downloads"]);
      const target = await freeName(dir, name);
      await download.saveAs(target);
      const size = (await stat(target)).size;
      if (size > MAX_DOWNLOAD_BYTES) {
        await rm(target, { force: true });
        this.log.add({ kind: "file", text: `Deleted the download ${name}: over 100 MB`, ok: false });
        return;
      }
      this.log.add({
        kind: "file",
        text: `Downloaded downloads/${basename(target)} (${formatBytes(size)})`,
        ok: true,
      });
    } catch {
      this.log.add({ kind: "file", text: `Could not save the download ${name}`, ok: false });
      await download.delete().catch(() => {});
    }
  }
}

async function settleScroll(page: Page): Promise<void> {
  let last = Number.NaN;
  for (let waited = 0; waited < SCROLL_SETTLE_MAX_MS; waited += 100) {
    await delay(100);
    const y = await page.evaluate(() => window.scrollY).catch(() => last);
    if (y === last) return;
    last = y;
  }
}

function safeFileName(name: string): string {
  const cleaned = basename(name)
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "download";
}

async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const candidate = join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    const taken = await lstat(candidate).then(
      () => true,
      () => false,
    );
    if (!taken) return candidate;
  }
  return join(dir, `${stem}-${Date.now()}${ext}`);
}

function navigationError(error: unknown, target: URL): ComputerError {
  const text = String(error);
  const where = displayUrl(target);
  if (/ERR_NAME_NOT_RESOLVED/.test(text))
    return new ComputerError("not_found", `Could not find ${target.hostname}.`);
  if (/Timeout \d+ms exceeded/i.test(text)) {
    return new ComputerError(
      "timeout",
      `${where} took too long to load (over ${NAVIGATION_TIMEOUT_MS / 1000} s).`,
    );
  }
  if (/ERR_CONNECTION_REFUSED/.test(text))
    return new ComputerError("failed", `${target.host} refused the connection.`);
  if (
    /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED/.test(text)
  ) {
    return new ComputerError("failed", `Could not reach ${target.host}.`);
  }
  if (/ERR_CERT|SSL/.test(text))
    return new ComputerError("failed", `${target.host} has a certificate problem, so it was not opened.`);
  if (/Download is starting/i.test(text)) {
    return new ComputerError(
      "failed",
      "That address started a download instead of opening a page. It is saved in downloads/.",
    );
  }
  return new ComputerError("failed", `Could not open ${where}: ${briefCause(error)}`);
}

function actionError(error: unknown, prefix: string): ComputerError {
  if (isComputerError(error)) return error;
  if (/Timeout \d+ms exceeded/i.test(String(error))) {
    return new ComputerError(
      "timeout",
      `${prefix}: it did not become ready in time. It may be hidden, covered or disabled.`,
    );
  }
  return new ComputerError("failed", `${prefix}: ${briefCause(error)}`);
}

/** Never quotes Playwright: a fill error could carry the text. */
function typingError(error: unknown, label: string): ComputerError {
  const text = String(error);
  if (/not an <input>|not an <input|contenteditable|Cannot type/i.test(text)) {
    return new ComputerError("bad_input", `${label} does not take typed text. Pick a text field.`);
  }
  if (/Timeout \d+ms exceeded/i.test(text)) {
    return new ComputerError(
      "timeout",
      `${label} did not become ready in time. It may be hidden or disabled.`,
    );
  }
  if (/disabled|not editable|readonly/i.test(text)) {
    return new ComputerError("bad_input", `${label} cannot be edited right now.`);
  }
  return new ComputerError("failed", `The text could not be typed into ${label}.`);
}
