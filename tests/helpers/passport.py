"""Agent Passport test helpers: the golden mandate, and real signatures over it.

The golden mandate (fixtures/passport/mandate.json) carries the public key of a seeded software
passkey, so tests can sign it for real and get the same key every run.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tempo_passport import Mandate, PrincipalKey, Signature, SignedMandate, b64url, digest

from .webauthn import SoftAuthenticator

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "passport"
SEED = b"tempo passport fixture (a test key, not a secret)"
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)  # inside the golden mandate's window
COMPANY = "Broadbandly"
GATEWAY_KEY_ID = "gw-1"


def passkey() -> SoftAuthenticator:
    """The seeded passkey whose public key is in the golden mandate."""
    return SoftAuthenticator(seed=SEED)


def golden() -> Mandate:
    return Mandate.model_validate_json((FIXTURES / "mandate.json").read_text(encoding="utf-8"))


def changed(mandate: Mandate, **fields: Any) -> Mandate:
    """A copy with top-level fields changed, validated again like any mandate read off the wire."""
    return Mandate.model_validate(mandate.model_dump() | fields)


def sign(mandate: Mandate, authenticator: SoftAuthenticator | None = None) -> SignedMandate:
    """Sign with a passkey: the WebAuthn challenge is the mandate's digest."""
    face_id = authenticator or passkey()
    credential = face_id.get({"challenge": b64url(digest(mandate))})
    return SignedMandate(
        mandate=mandate, signature=Signature(kind="webauthn", credential=credential)
    )


def gateway_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(hashlib.sha256(SEED + b":gateway").digest())


def raw_public(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def gateway_signed(mandate: Mandate, signer: Ed25519PrivateKey | None = None) -> SignedMandate:
    """A landline mandate: the Gateway signs the digest with Ed25519 (gateway-attested)."""
    signer = signer or gateway_key()
    spoken = changed(
        mandate,
        principal=mandate.principal.model_copy(
            update={
                "key": PrincipalKey(
                    kind="gateway-ed25519", public_key=b64url(raw_public(gateway_key())),
                    key_id=GATEWAY_KEY_ID,
                )
            }
        ).model_dump(),
    )  # fmt: skip
    sig = Signature(
        kind="gateway-ed25519", key_id=GATEWAY_KEY_ID, sig=b64url(signer.sign(digest(spoken)))
    )
    return SignedMandate(mandate=spoken, signature=sig)


def trusted_keys() -> dict[str, bytes]:
    return {GATEWAY_KEY_ID: raw_public(gateway_key())}


def envelope_json(signed: SignedMandate) -> str:
    return json.dumps(signed.model_dump(mode="json"))
