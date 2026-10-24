"""The canonical form of a mandate: the exact bytes that get hashed and signed.

Sorted keys, no whitespace, UTF-8, with money as strings (pydantic's JSON mode writes Decimal
that way). Full RFC 8785 is the roadmap; this is the one function to swap when it lands, and a
pinned test fails if a library upgrade ever changes these bytes.
"""

from __future__ import annotations

import base64
import hashlib
import json

from tempo_passport.mandate import Mandate


def canonical_bytes(mandate: Mandate) -> bytes:
    body = mandate.model_dump(mode="json")
    text = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return text.encode("utf-8")


def digest(mandate: Mandate) -> bytes:
    """SHA-256 of the canonical bytes. It is the WebAuthn challenge, so the passkey signs it."""
    return hashlib.sha256(canonical_bytes(mandate)).digest()


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
