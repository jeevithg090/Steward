# Confidential mode (build plan S8.8): roadmap, with simulated attestation

**What runs today is simulated.** `tempo_crypto.attestation` checks a recorded attestation
document signed by a stand-in attestation service, and `tempo_crypto.release.release_key`
refuses to release any key in Confidential mode without one. Demos say "simulated
attestation" on screen (`"simulated": true` is in every document).

The checks are the ones real key release needs: a trusted signature, the golden measurement of
an image we built, no debug mode, the GPU in confidential-computing mode, freshness, and report
data that binds the attestation to the worker's one-time key, so a released key opens only
inside the measured enclave.

## Making it real

| Piece | Options | Status |
|---|---|---|
| Confidential GPU | NVIDIA H100/H200 in CC mode inside a TDX or SEV-SNP confidential VM (Azure confidential H100 VMs, Phala Cloud) | not provisioned; we found no RunPod offering |
| Attestation | Confidential Containers (CoCo) + Trustee, or Phala dstack; GPU evidence via NVIDIA NRAS or offline verification | replace `verify_attestation`'s signature check with the vendor chains |
| Golden measurements | from the reproducible image build (S8.6), published next to the allowlist | not yet published |
