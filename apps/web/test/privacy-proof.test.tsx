import { render, screen } from "@testing-library/react";
import { PrivacyProof } from "@/components/PrivacyProof";
import type { PrivacyProofData } from "@/lib/api";

const PRIVATE: PrivacyProofData = {
  mode: "cloud-private", region: "eu (RunPod Secure Cloud)", third_parties: [],
  image_digest: `sha256:${"ab".repeat(32)}`, allowlist: "signed", image_allowlisted: true,
  key_held_on: ["Margaret's iPhone"], operator_view: { table: "vault_blobs", bytes: "9f3c0a7e" },
  canary_test: "tests/integration/test_canary.py, on every commit in CI", attestation: "n/a",
};

test("privacy proof shows the digest match and who holds the key", () => {
  render(<PrivacyProof proof={PRIVATE} />);

  expect(screen.getByText("✅ none")).toBeInTheDocument();
  expect(screen.getByText(/on the signed allowlist/)).toHaveTextContent("✅");
  expect(screen.getByText("Margaret's iPhone (passkey)")).toBeInTheDocument();
});

test("the operator view is ciphertext, and gaps are said plainly", () => {
  const { rerender } = render(<PrivacyProof proof={PRIVATE} />);
  expect(screen.getByLabelText("Operator view of one stored row")).toHaveTextContent("vault_blobs: 9f3c0a7e…");

  rerender(<PrivacyProof proof={{
    ...PRIVATE, mode: "cloud-standard", third_parties: ["cortex", "elevenlabs"], image_digest: null,
    allowlist: "missing", image_allowlisted: false, key_held_on: [], operator_view: null,
  }} />);

  expect(screen.getByText("⚠️ cortex, elevenlabs")).toBeInTheDocument();
  expect(screen.getByText(/no signed allowlist yet/)).toBeInTheDocument();
  expect(screen.getByText("nothing stored in the Vault yet")).toBeInTheDocument();
});
