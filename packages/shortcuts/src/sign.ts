import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PlistDict, toXmlPlist } from "./plist.ts";
import { validate } from "./validate.ts";

/**
 * Signs a shortcut with macOS `shortcuts sign` (docs/research/shortcuts.md §1.3).
 *
 * - `anyone` sends the whole file to Apple to notarise, so it is only for the generic file and
 *   launchers with nothing personal in them. A file holding a device key is refused outright.
 * - `people-who-know-me` signs locally (about 60 ms) for the signer's own devices and contacts.
 *
 * Off macOS it returns null, and the server serves the generic file that ships signed. It never
 * logs the plist: errors carry only what `shortcuts` printed.
 */

export type SignMode = "anyone" | "people-who-know-me";

export type SigningProblem = "secret" | "invalid" | "icloud" | "failed";

export class SigningError extends Error {
  override name = "SigningError";
  constructor(
    readonly problem: SigningProblem,
    message: string,
  ) {
    super(message);
  }
}

/** Runs `shortcuts` with arguments; resolves with its exit code and stderr. Swappable in tests. */
export type ShortcutsRunner = (
  args: string[],
  timeoutMs: number,
) => Promise<{ code: number; stderr: string }>;

const runShortcuts: ShortcutsRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    execFile("shortcuts", args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
      const code = err
        ? typeof (err as { code?: unknown }).code === "number"
          ? (err as { code: number }).code
          : 1
        : 0;
      resolve({ code, stderr: String(stderr ?? (err ? err.message : "")) });
    });
  });

/** Device keys start with this; seeing it in a file means it is personal. */
const KEY_MARKER = "stw_dev_";
const AEA1 = [0x41, 0x45, 0x41, 0x31];

export interface SignOptions {
  /** Defaults to this process's platform; tests pass another. */
  platform?: NodeJS.Platform;
  run?: ShortcutsRunner;
  /** Attempts in all. A transient CloudKit error came back about once in seven `anyone` runs. */
  attempts?: number;
  timeoutMs?: number;
  /** The file name Shortcuts shows on import, without `.shortcut`. */
  name?: string;
}

/** True when the bytes are a signed Apple Encrypted Archive. */
export function isSigned(bytes: Uint8Array): boolean {
  return bytes.length > 4 && AEA1.every((b, i) => bytes[i] === b);
}

/**
 * Signs a workflow. Returns the signed bytes, or null off macOS. Throws `SigningError` with a
 * plain sentence when it cannot: a key in an `anyone` file, a workflow that does not validate,
 * no iCloud session, or `shortcuts` failing three times.
 */
export async function sign(
  workflow: PlistDict,
  mode: SignMode,
  opts: SignOptions = {},
): Promise<Uint8Array | null> {
  const xml = toXmlPlist(workflow);
  if (mode === "anyone" && xml.includes(KEY_MARKER)) {
    throw new SigningError(
      "secret",
      "This shortcut holds a phone's key. Apple keeps a copy of anything signed for anyone, so it can only be signed for your own devices.",
    );
  }
  const checked = validate(xml);
  if (!checked.ok) {
    throw new SigningError(
      "invalid",
      `The shortcut didn't pass its checks: ${checked.problems.slice(0, 3).join(" ")}`,
    );
  }
  if ((opts.platform ?? process.platform) !== "darwin") return null;

  const run = opts.run ?? runShortcuts;
  const attempts = Math.max(1, opts.attempts ?? 3);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const dir = mkdtempSync(join(tmpdir(), "steward-sign-"));
  try {
    // Shortcuts names the imported shortcut after the file, so both carry the shortcut's name.
    const name = (opts.name ?? "Steward").replace(/[/\\:]/g, "-");
    mkdirSync(join(dir, "in"), { mode: 0o700 });
    const input = join(dir, "in", `${name}.shortcut`);
    const out = join(dir, `${name}.shortcut`);
    writeFileSync(input, xml, { mode: 0o600 });
    let last = "";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const { code, stderr } = await run(
        ["sign", "--mode", mode, "--input", input, "--output", out],
        timeoutMs,
      );
      if (/signed into iCloud/i.test(stderr)) {
        throw new SigningError(
          "icloud",
          "Signing needs this Mac to be signed into iCloud, from a logged-in session (not a background service). Sign in under System Settings → Apple Account, then try again.",
        );
      }
      if (code === 0) {
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(readFileSync(out));
        } catch {
          last = "shortcuts said it signed, but wrote no file.";
          continue;
        }
        if (isSigned(bytes)) return bytes;
        last = "shortcuts wrote a file that is not signed (no AEA1 header).";
        continue;
      }
      last = stderr.trim().split("\n").at(-1) ?? `exit ${code}`;
    }
    throw new SigningError(
      "failed",
      `Signing the shortcut failed ${attempts} times. The last error: ${last}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Headers for serving a shortcut file. Personal files are never cached. */
export function shortcutHeaders(filename: string, personal: boolean): Record<string, string> {
  const safe = filename.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 80) || "Steward";
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safe}.shortcut"`,
    "Cache-Control": personal ? "no-store" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
}
