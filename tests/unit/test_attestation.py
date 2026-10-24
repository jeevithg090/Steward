"""Confidential mode (S8.8, simulated attestation): keys go only to an attested enclave."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tempo_crypto.attestation import Policy, report_data, sign_attestation, verify_attestation
from tempo_crypto.worker_identity import EphemeralWorker, ReleaseRefused

NOW = datetime(2026, 10, 24, 20, 0, tzinfo=UTC)
GOLDEN = "mrtd:" + "5" * 96
SERVICE = Ed25519PrivateKey.generate()
POLICY = Policy(frozenset({GOLDEN}), SERVICE.public_key())
WORKER = EphemeralWorker("sha256:" + "1" * 64, Ed25519PrivateKey.generate(), now=lambda: NOW)
REPORT = WORKER.signed.report


def attested(**changes: Any) -> dict[str, Any]:
    cpu = {"type": "tdx", "measurement": GOLDEN, "debug": False, "report_data": report_data(REPORT)}
    claims: dict[str, Any] = {"cpu": cpu | changes.pop("cpu", {}), "gpu": {"vendor": "nvidia", "cc_mode": "on"},
                              "issued_at": NOW.isoformat()}  # fmt: skip
    return sign_attestation(claims | changes, SERVICE)


def test_valid_attestation_releases_key() -> None:
    document = attested()

    verify_attestation(document, REPORT, POLICY, now=NOW + timedelta(seconds=30))
    assert document["simulated"] is True  # said on screen: "simulated attestation"


def test_wrong_measurement_blocks_release() -> None:
    with pytest.raises(ReleaseRefused, match="image we built"):
        verify_attestation(
            attested(cpu={"measurement": "mrtd:" + "6" * 96}), REPORT, POLICY, now=NOW
        )


def test_debug_mode_tee_rejected() -> None:
    with pytest.raises(ReleaseRefused, match="debug"):
        verify_attestation(attested(cpu={"debug": True}), REPORT, POLICY, now=NOW)


def test_expired_attestation_rejected() -> None:
    with pytest.raises(ReleaseRefused, match="expired"):
        verify_attestation(attested(), REPORT, POLICY, now=NOW + timedelta(minutes=6))


def test_other_failures_block_release() -> None:
    forged = sign_attestation(attested()["claims"], Ed25519PrivateKey.generate())
    other_worker = EphemeralWorker(
        "sha256:" + "1" * 64, Ed25519PrivateKey.generate(), now=lambda: NOW
    )

    cases = [
        (forged, "attestation service"),
        (attested(gpu={"vendor": "nvidia", "cc_mode": "off"}), "confidential-computing"),
        ({"claims": "nope"}, "malformed"),
    ]
    for document, reason in cases:
        with pytest.raises(ReleaseRefused, match=reason):
            verify_attestation(document, REPORT, POLICY, now=NOW)
    with pytest.raises(ReleaseRefused, match="different worker key"):
        verify_attestation(attested(), other_worker.signed.report, POLICY, now=NOW)


def test_confidential_mode_releases_only_with_attestation() -> None:
    from tempo_crypto.envelope import aad, new_key, open_, seal
    from tempo_crypto.release import release_key

    deploy = Ed25519PrivateKey.generate()
    worker = EphemeralWorker("sha256:" + "1" * 64, deploy, now=lambda: NOW)
    data_key, state_aad = new_key(), aad("u_margaret", "m_1")
    common: dict[str, Any] = {
        "deploy_pub": deploy.public_key(), "allowlist": ["sha256:" + "1" * 64], "now": NOW,
        "user_id": "u_margaret", "mission_id": "m_1", "step": "file_claim", "confidential": POLICY,
    }  # fmt: skip
    claims = attested()["claims"] | {
        "cpu": attested()["claims"]["cpu"] | {"report_data": report_data(worker.signed.report)}
    }

    with pytest.raises(ReleaseRefused, match="needs an attestation"):
        release_key(worker.signed, data_key, seen_nonces=set(), **common)
    wrapped, context = release_key(
        worker.signed,
        data_key,
        seen_nonces=set(),
        attestation=sign_attestation(claims, SERVICE),
        **common,
    )
    out = worker.run_step(
        wrapped, context, seal(data_key, b"s", state_aad), state_aad, lambda s: s + b"!"
    )
    assert open_(data_key, out, state_aad) == b"s!"


def test_other_modes_release_on_the_signed_report_alone() -> None:
    from tempo_crypto.release import release_key

    deploy = Ed25519PrivateKey.generate()
    worker = EphemeralWorker("sha256:" + "1" * 64, deploy, now=lambda: NOW)

    wrapped, context = release_key(
        worker.signed, b"k" * 32, deploy_pub=deploy.public_key(), allowlist=["sha256:" + "1" * 64],
        now=NOW, seen_nonces=set(), user_id="u", mission_id="m", step="s",
    )  # fmt: skip

    assert (
        context.endswith(worker.signed.report.nonce.encode()) and len(wrapped) == 32 + 12 + 32 + 16
    )
