"""The device's whole key-release decision for one mission step (build plan S8.4, S8.8)."""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from tempo_crypto.attestation import Policy, verify_attestation
from tempo_crypto.worker_identity import (
    ReleaseRefused,
    SignedReport,
    release_context,
    unb64,
    verify_report,
    wrap_for_worker,
)


def release_key(
    signed: SignedReport,
    data_key: bytes,
    *,
    deploy_pub: Ed25519PublicKey,
    allowlist: Collection[str],
    now: datetime,
    seen_nonces: set[str],
    user_id: str,
    mission_id: str,
    step: str,
    attestation: dict[str, Any] | None = None,
    confidential: Policy | None = None,
) -> tuple[bytes, bytes]:
    """Returns (wrapped key, context). In Confidential mode (`confidential` set) there is no
    key without an attestation that vouches for this exact worker."""
    report = verify_report(signed, deploy_pub, allowlist, now=now, seen_nonces=seen_nonces)
    if confidential is not None:
        if attestation is None:
            raise ReleaseRefused("Confidential mode needs an attestation before any key leaves")
        verify_attestation(attestation, report, confidential, now=now)
    context = release_context(user_id, mission_id, step, report.nonce)
    return wrap_for_worker(data_key, unb64(report.ephemeral_pub), context), context
