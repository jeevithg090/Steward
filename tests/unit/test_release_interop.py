"""S8.4 interop: a key wrapped by the browser (apps/web/lib/release.ts) opens in a Python worker,
and only there. The vectors are throwaway test keys (fixtures/crypto)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from tempo_crypto.worker_identity import ReleaseRefused, unb64, unwrap_in_worker

CRYPTO = Path(__file__).resolve().parents[2] / "fixtures" / "crypto"
VECTOR = json.loads((CRYPTO / "release_vector.json").read_text())
DEVICE = json.loads((CRYPTO / "device_wrapped.json").read_text())


def test_a_key_wrapped_in_the_browser_opens_in_the_worker() -> None:
    worker = X25519PrivateKey.from_private_bytes(unb64(VECTOR["worker_private"]))

    opened = unwrap_in_worker(unb64(DEVICE["wrapped"]), worker, DEVICE["context"].encode())

    assert opened == unb64(VECTOR["data_key"])


def test_the_browser_wrap_is_bound_to_its_step() -> None:
    worker = X25519PrivateKey.from_private_bytes(unb64(VECTOR["worker_private"]))
    other_step = DEVICE["context"].replace("file_claim", "accept_offer").encode()

    with pytest.raises(ReleaseRefused):
        unwrap_in_worker(unb64(DEVICE["wrapped"]), worker, other_step)
    with pytest.raises(ReleaseRefused):
        unwrap_in_worker(
            unb64(DEVICE["wrapped"]), X25519PrivateKey.generate(), DEVICE["context"].encode()
        )
