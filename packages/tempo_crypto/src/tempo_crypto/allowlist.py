"""The transparency allowlist (build plan S8.6): the image digests a device may release keys to.

CI writes deploy/transparency/allowlist.json after a release build and signs it with cosign
(`cosign sign-blob`: ECDSA P-256 over SHA-256, base64 DER). Anyone can check it with cosign or
with verify_allowlist below; a worker whose digest isn't listed gets no key (S8.4).
"""

from __future__ import annotations

import base64
import json
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_pem_public_key

PINNED = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")


class AllowlistInvalid(Exception):
    pass


def pinned(image_ref: str) -> bool:
    """Deploys name images by digest only: a tag can be moved to other bytes, a digest can't."""
    return bool(PINNED.match(image_ref))


def verify_allowlist(document: bytes, signature_b64: str, public_key_pem: bytes) -> list[str]:
    key = load_pem_public_key(public_key_pem)
    if not isinstance(key, ec.EllipticCurvePublicKey):
        raise AllowlistInvalid("the cosign key must be ECDSA P-256")
    try:
        key.verify(base64.b64decode(signature_b64), document, ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError) as e:
        raise AllowlistInvalid("the allowlist's signature doesn't verify") from e
    images = json.loads(document)["images"]
    digests = [str(i["digest"]) for i in images]
    if not all(re.fullmatch(r"sha256:[0-9a-f]{64}", d) for d in digests):
        raise AllowlistInvalid("the allowlist names something other than digests")
    return digests
