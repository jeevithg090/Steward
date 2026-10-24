"""A software passkey for tests: real WebAuthn registrations and assertions, no phone needed.

The key is an ES256 key, as a phone's secure element would hold, so py_webauthn verifies genuine
signatures. Give it a `seed` to get the same key every run (for pinned fixtures); the seed is a
throwaway test value, never a secret.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

ORIGIN = "http://localhost:3000"


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class SoftAuthenticator:
    """A platform authenticator in software: user present and verified ("Face ID")."""

    def __init__(
        self, rp_id: str = "localhost", origin: str = ORIGIN, *, seed: bytes | None = None
    ) -> None:
        self.rp_id_hash = hashlib.sha256(rp_id.encode()).digest()
        self.origin = origin
        if seed is None:
            self.key = ec.generate_private_key(ec.SECP256R1())
            self.credential_id = os.urandom(16)
        else:
            scalar = int.from_bytes(hashlib.sha256(b"key:" + seed).digest())
            self.key = ec.derive_private_key(scalar, ec.SECP256R1())
            self.credential_id = hashlib.sha256(b"id:" + seed).digest()[:16]
        self.counter = 0

    def cose_public_key(self) -> bytes:
        """The public key as WebAuthn stores it (COSE, EC2, P-256, ES256)."""
        numbers = self.key.public_key().public_numbers()
        return cbor2.dumps(
            {1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32), -3: numbers.y.to_bytes(32)}
        )

    def _client_data(self, kind: str, challenge: str) -> bytes:
        return json.dumps({"type": kind, "challenge": challenge, "origin": self.origin}).encode()

    def create(self, options: dict[str, Any]) -> dict[str, Any]:
        cose = self.cose_public_key()
        attested = bytes(16) + len(self.credential_id).to_bytes(2) + self.credential_id + cose
        auth_data = self.rp_id_hash + bytes([0x45]) + self.counter.to_bytes(4) + attested
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
            "response": {
                "clientDataJSON": b64(self._client_data("webauthn.create", options["challenge"])),
                "attestationObject": b64(attestation),
            },
            "clientExtensionResults": {},
        }  # fmt: skip

    def get(self, options: dict[str, Any], *, tamper: bool = False) -> dict[str, Any]:
        self.counter += 1
        auth_data = self.rp_id_hash + bytes([0x05]) + self.counter.to_bytes(4)
        client_data = self._client_data("webauthn.get", options["challenge"])
        signed = auth_data + hashlib.sha256(client_data).digest()
        signature = self.key.sign(signed, ec.ECDSA(hashes.SHA256()))
        if tamper:
            client_data = self._client_data("webauthn.get", b64(os.urandom(32)))
        return {
            "id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
            "response": {
                "clientDataJSON": b64(client_data), "authenticatorData": b64(auth_data),
                "signature": b64(signature), "userHandle": None,
            },
            "clientExtensionResults": {},
        }  # fmt: skip
