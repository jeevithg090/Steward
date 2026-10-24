"""S8.4 end to end: the control plane carries a step and never sees plaintext or keys."""

from __future__ import annotations

from datetime import UTC, datetime

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tempo_crypto.envelope import aad, new_key, open_, seal, unwrap, wrap
from tempo_crypto.worker_identity import (
    EphemeralWorker,
    SignedReport,
    release_context,
    unb64,
    verify_report,
    wrap_for_worker,
)
from tempo_gateway.worker_broker import WorkerBroker

DIGEST = "sha256:" + "d" * 64
CANARY = b"ZEBRA-CANARY-7731"


def test_control_plane_never_receives_plaintext() -> None:
    deploy = Ed25519PrivateKey.generate()
    now = datetime.now(UTC)
    broker = WorkerBroker(
        launch=lambda: EphemeralWorker(DIGEST, deploy, now=lambda: now),
        program=lambda state: state.replace(b"awaiting_consent", b"claim_filed"),
    )
    # On the device: K_user, the mission's wrapped data key, and the sealed state.
    k_user, data_key = new_key(), new_key()
    wrapped_dk = wrap(k_user, data_key, "u_margaret", "m_1")
    state_aad = aad("u_margaret", "m_1")
    state = seal(
        data_key,
        b'{"name": "Margaret", "state": "awaiting_consent", "note": "' + CANARY + b'"}',
        state_aad,
    )

    started = broker.start_step()
    report = verify_report(SignedReport.from_json(started["signed_report"]), deploy.public_key(), [DIGEST],
                           now=now, seen_nonces=set())  # fmt: skip
    context = release_context("u_margaret", "m_1", "file_claim", report.nonce)
    step_key = unwrap(k_user, wrapped_dk, "u_margaret", "m_1")
    result = broker.finish_step(started["step_id"], wrap_for_worker(step_key, unb64(report.ephemeral_pub), context),
                                context, state, state_aad)  # fmt: skip

    assert b'"claim_filed"' in open_(data_key, result, state_aad)  # the device can read the result
    seen = b"".join(broker.handled)
    for secret in (CANARY, b"Margaret", k_user, data_key):
        assert secret not in seen  # the control plane only ever carried ciphertext
    assert broker.pending == {}  # the worker is gone
