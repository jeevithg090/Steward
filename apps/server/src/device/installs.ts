import { randomBytes } from "node:crypto";

/**
 * One-time shortcut downloads (docs/plans/phone-and-shortcuts.md §4.5): a 128-bit id, ten minutes,
 * served once. Kept in memory only: a personal file holds a phone's key, so it never touches disk
 * and a restart forgets it.
 */
export const INSTALL_TTL_MS = 10 * 60_000;

/** Why a key made for a one-tap file was revoked, in the record. */
export const UNFETCHED = "its one-tap file was never downloaded";

interface Pending {
  bytes: Uint8Array;
  name: string;
  personal: boolean;
  expiresAt: number;
  /** Called when the link dies unused, so a key made for it can be revoked. */
  onExpire?: () => void;
  /** Called when the file is fetched. */
  onTake?: () => void;
  timer?: NodeJS.Timeout;
}

export class InstallStore {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  add(file: Omit<Pending, "expiresAt" | "timer">): { id: string; expiresAt: string } {
    this.sweep();
    const id = randomBytes(16).toString("hex");
    const expiresAt = this.now() + INSTALL_TTL_MS;
    // A link dies on time even when no other link is made or fetched after it, so a key made for
    // it is revoked then too. The timer never keeps Steward running.
    const timer = setTimeout(() => this.expire(id), INSTALL_TTL_MS);
    timer.unref?.();
    this.pending.set(id, { ...file, expiresAt, timer });
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** The file, once. A second request, or one after ten minutes, gets nothing. */
  take(id: string): Omit<Pending, "expiresAt" | "onExpire" | "onTake" | "timer"> | undefined {
    this.sweep();
    const file = this.pending.get(id);
    if (!file) return undefined;
    this.pending.delete(id);
    clearTimeout(file.timer);
    file.onTake?.();
    return { bytes: file.bytes, name: file.name, personal: file.personal };
  }

  private expire(id: string): void {
    const file = this.pending.get(id);
    if (!file) return;
    this.pending.delete(id);
    clearTimeout(file.timer);
    try {
      file.onExpire?.();
    } catch (err) {
      console.error(
        "[steward] an expired download could not be cleaned up:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private sweep(): void {
    const at = this.now();
    for (const [id, file] of this.pending) if (file.expiresAt <= at) this.expire(id);
  }
}
