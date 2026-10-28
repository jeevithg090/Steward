/**
 * The release step: signs the generic Steward shortcut and the launchers with nothing personal in
 * them for anyone, and writes them to `signed/` with a manifest.
 *
 *   pnpm --filter @steward/shortcuts sign:release
 *
 * Needs a Mac signed into iCloud, from a logged-in session: `anyone` signing sends each file to
 * Apple to notarise, which is why only these generic files are ever signed that way. CI cannot do
 * it. Re-sign every release and at least every 6 months (the certificate lasts about 12.7 months).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STEWARD_SHORTCUT } from "@steward/shared";
import { toXmlPlist } from "./plist.ts";
import { SigningError, sign } from "./sign.ts";
import { SIGNED_DIR, type SignedManifest } from "./signed.ts";
import { buildLauncher, buildStewardShortcut, type Workflow } from "./steward.ts";

/** Launchers anyone may have: they name no skill, routine or person. */
export const SHIPPED_LAUNCHERS: { id: string; name: string }[] = [
  { id: "brief", name: "Steward What needs me" },
  { id: "approvals", name: "Steward Needs you" },
];

async function main(): Promise<void> {
  const files: [string, string, Workflow][] = [
    ["Steward.shortcut", STEWARD_SHORTCUT.name, buildStewardShortcut()],
    ...SHIPPED_LAUNCHERS.map(
      ({ id, name }) => [`launchers/${id}.shortcut`, name, buildLauncher(id)] as [string, string, Workflow],
    ),
  ];
  const manifest: SignedManifest = {
    version: STEWARD_SHORTCUT.version,
    signedAt: new Date().toISOString(),
    mode: "anyone",
    files: {},
  };
  mkdirSync(join(SIGNED_DIR, "launchers"), { recursive: true });
  for (const [file, name, workflow] of files) {
    const bytes = await sign(workflow, "anyone", { name });
    if (!bytes) {
      console.error("Only a Mac can sign shortcuts. Nothing was written.");
      process.exit(1);
    }
    writeFileSync(join(SIGNED_DIR, file), bytes);
    manifest.files[file] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      actions: workflow.WFWorkflowActions.length,
    };
    // The unsigned plist next to it, so a reviewer can read exactly what was sent to Apple.
    writeFileSync(join(SIGNED_DIR, file.replace(/\.shortcut$/, ".plist")), toXmlPlist(workflow));
    console.log(`signed ${file} (${bytes.length} bytes, ${workflow.WFWorkflowActions.length} actions)`);
  }
  writeFileSync(join(SIGNED_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof SigningError ? err.message : err);
    process.exit(1);
  });
}
