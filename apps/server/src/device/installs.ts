import { randomBytes } from "node:crypto";

/**
 * One-time shortcut downloads (docs/plans/phone-and-shortcuts.md §4.5): a 128-bit id, ten minutes,
 * served once. Kept in memory only: a personal file holds a phone's key, so it never touches disk
 * and a restart forgets it.
 */
export const INSTALL_TTL_MS = 10 * 60_000;

interface Pending {
  bytes: Uint8Array;
  name: string;
  personal: boolean;
  expiresAt: number;
  /** Called when the link dies unused, so a key made for it can be revoked. */
  onExpire?: () => void;
}

export class InstallStore {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  add(file: Omit<Pending, "expiresAt">): { id: string; expiresAt: string } {
    this.sweep();
    const id = randomBytes(16).toString("hex");
    const expiresAt = this.now() + INSTALL_TTL_MS;
    this.pending.set(id, { ...file, expiresAt });
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** The file, once. A second request, or one after ten minutes, gets nothing. */
  take(id: string): Omit<Pending, "expiresAt" | "onExpire"> | undefined {
    this.sweep();
    const file = this.pending.get(id);
    if (!file) return undefined;
    this.pending.delete(id);
    return { bytes: file.bytes, name: file.name, personal: file.personal };
  }

  private sweep(): void {
    const at = this.now();
    for (const [id, file] of this.pending) {
      if (file.expiresAt > at) continue;
      this.pending.delete(id);
      file.onExpire?.();
    }
  }
}
