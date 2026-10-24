"""Confidential mode: release a key only to an attested enclave (spec §18, build plan S8.8).

SIMULATED. Real verification checks an Intel TDX or AMD SEV-SNP quote and an NVIDIA GPU
attestation against the vendors' certificate chains (CoCo + Trustee, or NVIDIA NRAS). Here a
recorded document is signed by a stand-in attestation service key, and the checks that matter
for key release are the same:

- the document is signed by the attestation service we trust;
- the measured image is one we built (its golden measurement);
- the TEE is not in debug mode (a debug enclave's memory can be read by the host);
- the GPU is in confidential-computing mode;
- it is fresh;
- its report data is the hash of this worker's one-time public key and nonce, so the key we
  release can only be opened inside the enclave that was measured.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from tempo_crypto.worker_identity import ReleaseRefused, WorkerReport, b64, unb64

MAX_AGE = timedelta(minutes=5)


def report_data(report: WorkerReport) -> str:
    """What the enclave must vouch for: this worker's one-time key and nonce."""
    return hashlib.sha256(f"{report.ephemeral_pub}|{report.nonce}".encode()).hexdigest()


@dataclass(frozen=True)
class Policy:
    golden_measurements: frozenset[str]
    service_key: Ed25519PublicKey  # the attestation service we trust (simulated)


def sign_attestation(claims: dict[str, Any], service: Ed25519PrivateKey) -> dict[str, Any]:
    """The stand-in attestation service: used to record fixtures and in tests."""
    body = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
    return {"claims": claims, "signature": b64(service.sign(body)), "simulated": True}


def verify_attestation(
    document: dict[str, Any], report: WorkerReport, policy: Policy, *, now: datetime
) -> None:
    """Raises ReleaseRefused unless every check passes."""
    claims = document.get("claims")
    if not isinstance(claims, dict):
        raise ReleaseRefused("malformed attestation")
    body = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
    try:
        policy.service_key.verify(unb64(str(document.get("signature", ""))), body)
    except (InvalidSignature, ValueError) as e:
        raise ReleaseRefused("the attestation isn't signed by the attestation service") from e
    cpu, gpu = claims.get("cpu") or {}, claims.get("gpu") or {}
    if cpu.get("measurement") not in policy.golden_measurements:
        raise ReleaseRefused("the enclave isn't running an image we built")
    if cpu.get("debug") is not False:
        raise ReleaseRefused("the enclave is in debug mode")
    if gpu.get("cc_mode") != "on":
        raise ReleaseRefused("the GPU isn't in confidential-computing mode")
    if now - datetime.fromisoformat(str(claims.get("issued_at"))) > MAX_AGE:
        raise ReleaseRefused("the attestation has expired")
    if cpu.get("report_data") != report_data(report):
        raise ReleaseRefused("the attestation is for a different worker key")
