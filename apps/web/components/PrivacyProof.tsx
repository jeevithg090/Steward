import type { PrivacyProofData } from "@/lib/api";

const OK = "✅";
const NO = "⚠️";

/** What is true of this deployment, each line checked by the Gateway rather than claimed. */
export function PrivacyProof({ proof }: { proof: PrivacyProofData | null }) {
  if (!proof) return null;
  const outsiders = proof.third_parties.length ? proof.third_parties.join(", ") : "none";
  return (
    <section aria-labelledby="privacy-heading" className="rounded-xl border-2 border-slate-200 bg-white p-4 text-sm">
      <h2 id="privacy-heading" className="mb-2 text-lg font-semibold">Privacy proof</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-medium">Mode</dt>
        <dd>{proof.mode} · {proof.region}</dd>
        <dt className="font-medium">Outside AI companies</dt>
        <dd>{proof.third_parties.length ? `${NO} ${outsiders}` : `${OK} none`}</dd>
        <dt className="font-medium">Running image</dt>
        <dd>
          {proof.image_digest ? <code className="break-all">{proof.image_digest.slice(0, 19)}…</code> : "a local build (no digest)"}{" "}
          {proof.allowlist === "missing"
            ? "· no signed allowlist yet"
            : proof.image_allowlisted ? `${OK} on the signed allowlist` : `${NO} not on the signed allowlist`}
        </dd>
        <dt className="font-medium">Your key is held on</dt>
        <dd>{proof.key_held_on.length ? `${proof.key_held_on.join(", ")} (passkey)` : "no device yet: add Face ID in Your devices"}</dd>
        <dt className="font-medium">What an operator sees</dt>
        <dd>
          {proof.operator_view
            ? <code className="break-all" aria-label="Operator view of one stored row">{proof.operator_view.table}: {proof.operator_view.bytes}…</code>
            : "nothing stored in the Vault yet"}
        </dd>
        <dt className="font-medium">Canary test</dt>
        <dd>{proof.canary_test}</dd>
        {proof.attestation !== "n/a" && (
          <>
            <dt className="font-medium">Attestation</dt>
            <dd>{proof.attestation}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
