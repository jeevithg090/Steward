"""Ephemeral workers and key release (spec §18, build plan S8.4).

A worker proves which image it runs before a device gives it a key, and the key opens one
mission step only:

1. The worker boots, makes an X25519 key pair, and builds a report: image digest, its public
   key, a nonce and the time. The deploy signing key (CI and RunPod secrets, never a device)
   signs it with Ed25519.
2. The device checks the signature, that the digest is on the signed allowlist, that the
   report is under 60 s old, and that the nonce is new.
3. The device wraps the step's data key to the worker's public key (X25519, HKDF-SHA256,
   AES-256-GCM: what WebCrypto has natively), bound to the person, mission, step and nonce.
4. The worker opens it, runs the step in memory, re-seals the state and forgets its keys.

Honest note: Python can't guarantee memory is wiped, so forgetting is best effort here;
hardware guarantees are Confidential mode's job (S8.8).
"""

from __future__ import annotations

import base64
import json
import secrets
from collections.abc import Callable, Collection
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from tempo_crypto.envelope import open_, seal

MAX_AGE = timedelta(seconds=60)
RAW = serialization.Encoding.Raw, serialization.PublicFormat.Raw


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class ReleaseRefused(Exception):
    """The device keeps its key: the worker isn't one it can trust for this step."""


@dataclass(frozen=True)
class WorkerReport:
    image_digest: str  # "sha256:..."
    ephemeral_pub: str  # X25519, base64url
    nonce: str
    issued_at: str  # ISO 8601 UTC

    def canonical(self) -> bytes:
        return json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()


@dataclass(frozen=True)
class SignedReport:
    report: WorkerReport
    signature: str  # Ed25519 over report.canonical(), base64url

    def to_json(self) -> dict[str, object]:
        return {"report": asdict(self.report), "signature": self.signature}

    @classmethod
    def from_json(cls, data: dict[str, object]) -> SignedReport:
        report = data["report"]
        if not isinstance(report, dict):
            raise ReleaseRefused("malformed report")
        return cls(WorkerReport(**report), str(data["signature"]))


def sign_report(report: WorkerReport, deploy_key: Ed25519PrivateKey) -> SignedReport:
    return SignedReport(report, b64(deploy_key.sign(report.canonical())))


def release_context(user_id: str, mission_id: str, step: str, nonce: str) -> bytes:
    return f"tempo-release|{user_id}|{mission_id}|{step}|{nonce}".encode()


def verify_report(
    signed: SignedReport,
    deploy_pub: Ed25519PublicKey,
    allowlist: Collection[str],
    *,
    now: datetime,
    seen_nonces: set[str],
) -> WorkerReport:
    """The device's checks, all of which must pass before any key leaves it."""
    try:
        deploy_pub.verify(unb64(signed.signature), signed.report.canonical())
    except (InvalidSignature, ValueError) as e:
        raise ReleaseRefused("the report isn't signed by Tempo's deploy key") from e
    report = signed.report
    if report.image_digest not in allowlist:
        raise ReleaseRefused(f"image {report.image_digest} isn't on the signed allowlist")
    age = now - datetime.fromisoformat(report.issued_at)
    if age > MAX_AGE or age < -MAX_AGE:
        raise ReleaseRefused("the report is stale")
    if report.nonce in seen_nonces:
        raise ReleaseRefused("the report was replayed")
    seen_nonces.add(report.nonce)
    return report


def _kdf(shared: bytes, device_pub: bytes, worker_pub: bytes, context: bytes) -> bytes:
    hkdf = HKDF(algorithm=hashes.SHA256(), length=32, salt=device_pub + worker_pub, info=context)
    return hkdf.derive(shared)


def wrap_for_worker(data_key: bytes, worker_pub: bytes, context: bytes) -> bytes:
    """device_pub (32) || iv (12) || AES-256-GCM(data_key), with the context as AAD."""
    device = X25519PrivateKey.generate()
    device_pub = device.public_key().public_bytes(*RAW)
    key = _kdf(
        device.exchange(X25519PublicKey.from_public_bytes(worker_pub)),
        device_pub,
        worker_pub,
        context,
    )
    iv = secrets.token_bytes(12)
    return device_pub + iv + AESGCM(key).encrypt(iv, data_key, context)


def unwrap_in_worker(blob: bytes, worker: X25519PrivateKey, context: bytes) -> bytes:
    device_pub, iv, sealed = blob[:32], blob[32:44], blob[44:]
    worker_pub = worker.public_key().public_bytes(*RAW)
    try:
        key = _kdf(
            worker.exchange(X25519PublicKey.from_public_bytes(device_pub)),
            device_pub,
            worker_pub,
            context,
        )
        return AESGCM(key).decrypt(iv, sealed, context)
    except (InvalidTag, ValueError) as e:
        raise ReleaseRefused("this key wasn't released to this worker for this step") from e


class EphemeralWorker:
    """One mission step, then gone: its key pair is made at boot and dropped after the step."""

    def __init__(
        self, image_digest: str, deploy_key: Ed25519PrivateKey, *, now: Callable[[], datetime]
    ) -> None:
        self._pair: X25519PrivateKey | None = X25519PrivateKey.generate()
        self.signed = sign_report(
            WorkerReport(
                image_digest=image_digest,
                ephemeral_pub=b64(self._pair.public_key().public_bytes(*RAW)),
                nonce=secrets.token_urlsafe(16),
                issued_at=now().isoformat(),
            ),
            deploy_key,
        )

    def run_step(
        self,
        wrapped_key: bytes,
        context: bytes,
        sealed_state: bytes,
        state_aad: bytes,
        step: Callable[[bytes], bytes],
    ) -> bytes:
        """Open the state in memory, run the step, seal the new state, forget the keys."""
        if self._pair is None:
            raise ReleaseRefused("this worker has already run its step")
        key = bytearray(unwrap_in_worker(wrapped_key, self._pair, context))
        try:
            state = bytearray(open_(bytes(key), sealed_state, state_aad))
            result = seal(bytes(key), step(bytes(state)), state_aad)
            state[:] = bytes(len(state))  # best effort: Python may hold other copies
            return result
        finally:
            key[:] = bytes(len(key))
            self._pair = None
