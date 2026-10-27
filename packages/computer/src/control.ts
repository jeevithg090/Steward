/**
 * Adapted from openbot/agent-computer/src/control.ts and action-barrier.ts (MIT, CopilotKit).
 *
 * Who drives the screen. The agent drives by default; the person can take the wheel at any time,
 * and the agent can ask them to (`requestHelp`). Three rules hold it together:
 *
 * 1. Taking the wheel waits for any agent action already on the screen to finish (the barrier),
 *    so the person never gets a page that is changing under them.
 * 2. While the person holds the wheel, or Steward is waiting for their help, every agent action is
 *    refused at admission. There is one gate, `admit`, and every acting method goes through it.
 * 3. Handing back marks that the agent must look again (`snapshotRequired`) before it acts on the
 *    page, because the person may have changed anything.
 */
import type { Controller } from "@steward/shared";
import { nowIso } from "@steward/shared";
import { ComputerError, MESSAGES } from "./errors.ts";

export const HELP_TIMEOUT_MS = 15 * 60_000;
export const TAKE_DRAIN_MS = 45_000;

type HelpWaiter = (released: boolean) => void;

export class WheelControl {
  controller: Controller = "agent";
  help: { reason: string; requestedAt: string } | undefined;
  /** Set when the person hands back; cleared by the agent's next snapshot. */
  snapshotRequired = false;

  /** True while a take is draining the barrier: new agent actions are already refused. */
  private closing = false;
  private active = 0;
  private readonly drainWaiters = new Set<() => void>();
  private readonly helpWaiters = new Set<HelpWaiter>();

  constructor(private readonly onChange: () => void = () => {}) {}

  /** Throws when the agent may not act right now. */
  assertAgentMayAct(): void {
    if (this.controller === "person" || this.closing) {
      throw new ComputerError("person_has_control", MESSAGES.personHasControl);
    }
    if (this.help) throw new ComputerError("person_has_control", MESSAGES.waitingForHelp);
  }

  /**
   * Admits one agent action. Screen actions also hold the barrier until the returned release is
   * called, so a take waits for them. Files and the shell are admitted but do not hold it.
   */
  admit(holdsScreen: boolean): () => void {
    this.assertAgentMayAct();
    if (!holdsScreen) return () => {};
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      if (this.active === 0) {
        for (const wake of this.drainWaiters) wake();
        this.drainWaiters.clear();
      }
    };
  }

  /** Agent actions still running on the screen. */
  pending(): number {
    return this.active;
  }

  /** The person takes the wheel. Resolves once in-flight agent actions have finished. */
  async take(drainMs = TAKE_DRAIN_MS): Promise<boolean> {
    if (this.controller === "person") return false;
    this.closing = true;
    try {
      await this.drain(drainMs);
    } catch (error) {
      this.closing = false;
      throw error;
    }
    this.closing = false;
    this.controller = "person";
    this.onChange();
    return true;
  }

  /**
   * The person hands the wheel back (or answers a help request without taking it). Wakes the
   * agent's `requestHelp` with `released: true`. Returns false when there was nothing to hand back.
   */
  release(): boolean {
    if (this.controller !== "person" && !this.help) return false;
    this.controller = "agent";
    this.snapshotRequired = true;
    this.help = undefined;
    this.wakeHelp(true);
    this.onChange();
    return true;
  }

  /** Waits for the person to hand back. A second ask while one is open joins the same wait. */
  requestHelp(
    reason: string,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ released: boolean }> {
    if (!this.help) {
      this.help = { reason, requestedAt: nowIso() };
      this.onChange();
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish: HelpWaiter = (released) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        this.helpWaiters.delete(finish);
        resolve({ released });
      };
      const giveUp = () => {
        finish(false);
        // The last one waiting withdraws the ask. A person who already took the wheel keeps it.
        if (this.helpWaiters.size === 0 && this.help) {
          this.help = undefined;
          this.onChange();
        }
      };
      const onAbort = () => giveUp();
      this.helpWaiters.add(finish);
      timer = setTimeout(giveUp, opts.timeoutMs ?? HELP_TIMEOUT_MS);
      if (opts.signal?.aborted) giveUp();
      else opts.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** The agent took a fresh look while it held the wheel: it may act again. */
  snapshotTaken(): void {
    if (this.controller === "agent" && !this.help) this.snapshotRequired = false;
  }

  /** The computer stopped or was reset. Everyone waiting is told no; the agent holds the wheel again. */
  interrupt(): void {
    const changed = this.controller !== "agent" || this.help !== undefined;
    this.controller = "agent";
    this.help = undefined;
    this.closing = false;
    this.snapshotRequired = true;
    this.wakeHelp(false);
    if (changed) this.onChange();
  }

  private wakeHelp(released: boolean): void {
    for (const wake of [...this.helpWaiters]) wake(released);
    this.helpWaiters.clear();
  }

  private drain(ms: number): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.drainWaiters.delete(done);
        reject(new ComputerError("busy", MESSAGES.stillFinishing));
      }, ms);
      this.drainWaiters.add(done);
    });
  }
}
