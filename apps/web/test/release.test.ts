import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import vector from "../../../fixtures/crypto/release_vector.json";
import { toBytes } from "@/lib/mesh";
import { ReleaseRefused, type SignedReport, canonical, releaseKey, verifyReport } from "@/lib/release";

const signed = vector.signed_report as SignedReport;
const deployPub = new Uint8Array(toBytes(vector.deploy_pub));
const allowlist = [signed.report.image_digest];
const fresh = new Date(Date.parse(signed.report.issued_at) + 5_000);
const opts = (seen = new Set<string>()) => ({
  deployPub, allowlist, userId: vector.user_id, missionId: vector.mission_id, step: vector.step, now: fresh, seenNonces: seen,
});

test("a report signed in Python verifies on the device, then the key is released", async () => {
  const released = await releaseKey(signed, new Uint8Array(toBytes(vector.data_key)), opts());

  expect(released.context).toBe(`tempo-release|u_margaret|m_1|file_claim|${signed.report.nonce}`);
  expect(toBytes(released.wrapped).byteLength).toBe(32 + 12 + 32 + 16);
  if (process.env.GEN_VECTORS) {
    // A blob made here, for tests/unit/test_release_interop.py to open in Python.
    const out = resolve(process.cwd(), "../../fixtures/crypto/device_wrapped.json"); // run from apps/web
    writeFileSync(out, `${JSON.stringify({ note: "TEST ONLY: made by apps/web/test/release.test.ts", ...released }, null, 2)}\n`);
  }
});

test("the canonical bytes match what Python signed", () => {
  expect(new TextDecoder().decode(canonical(signed.report))).toBe(
    `{"ephemeral_pub":"${signed.report.ephemeral_pub}","image_digest":"${signed.report.image_digest}",` +
      `"issued_at":"${signed.report.issued_at}","nonce":"${signed.report.nonce}"}`,
  );
});

test("the device refuses an altered, unlisted, stale or replayed report", async () => {
  const altered = { ...signed, report: { ...signed.report, image_digest: `sha256:${"f".repeat(64)}` } };
  const seen = new Set<string>();
  await verifyReport(signed, deployPub, allowlist, fresh, seen);

  await expect(verifyReport(altered, deployPub, [...allowlist, altered.report.image_digest], fresh, new Set())).rejects.toThrow("signed");
  await expect(verifyReport(signed, deployPub, [], fresh, new Set())).rejects.toThrow("allowlist");
  await expect(verifyReport(signed, deployPub, allowlist, new Date(fresh.getTime() + 120_000), new Set())).rejects.toThrow("stale");
  await expect(verifyReport(signed, deployPub, allowlist, fresh, seen)).rejects.toBeInstanceOf(ReleaseRefused);
});
