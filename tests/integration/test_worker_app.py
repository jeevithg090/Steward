"""The worker service (S8.4, S8.6): a signed report, one step per released key, then recycle."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from tempo_crypto.envelope import aad, new_key, open_, seal
from tempo_crypto.worker_identity import (
    SignedReport,
    b64,
    release_context,
    unb64,
    verify_report,
    wrap_for_worker,
)
from tempo_worker.app import create_worker

DIGEST = "sha256:" + "9" * 64


def test_the_worker_runs_one_step_per_released_key() -> None:
    signer, now = Ed25519PrivateKey.generate(), datetime.now(UTC)
    worker = TestClient(create_worker(DIGEST, signer, now=lambda: now))
    data_key, state_aad = new_key(), aad("u_margaret", "m_1")
    sealed = seal(data_key, json.dumps({"state": "awaiting_consent"}).encode(), state_aad)

    signed = SignedReport.from_json(worker.get("/report").json())
    report = verify_report(signed, signer.public_key(), [DIGEST], now=now, seen_nonces=set())
    context = release_context("u_margaret", "m_1", "file_claim", report.nonce)
    body = {
        "wrapped_key": b64(wrap_for_worker(data_key, unb64(report.ephemeral_pub), context)),
        "context": context.decode(), "sealed_state": b64(sealed), "state_aad": state_aad.decode(),
    }  # fmt: skip

    done = worker.post("/step", json=body)
    again = worker.post("/step", json=body)  # the same released key, replayed

    assert json.loads(open_(data_key, unb64(done.json()["sealed_state"]), state_aad)) == {
        "state": "claim_filed"
    }
    assert again.status_code == 403  # the key pair was recycled after the first step
    assert worker.get("/report").json()["report"]["nonce"] != report.nonce
    assert worker.get("/docs").status_code == 404  # nothing else is exposed
