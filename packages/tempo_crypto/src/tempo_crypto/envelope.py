"""Envelope encryption (spec §18, build plan S8.3): we hold ciphertext; the person's device
holds the key.

- Data is sealed with XChaCha20-Poly1305 under a data key (DK): one per mission or vault.
- The AAD binds each blob to `user | mission | version`, so ciphertext moved to another person
  or mission fails to open rather than decrypting in the wrong place.
- Each DK is wrapped by the person's key (K_user). Rotating K_user rewraps the DKs only; the
  data is never re-encrypted. Deleting the wraps makes everything unreadable ("Forget me").
- Nonces are 24 random bytes: XChaCha's nonce is large enough that random nonces don't repeat.
"""

from __future__ import annotations

import base64
import secrets

from nacl.bindings import (
    crypto_aead_xchacha20poly1305_ietf_decrypt,
    crypto_aead_xchacha20poly1305_ietf_encrypt,
    crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
)
from nacl.exceptions import CryptoError

KEY_BYTES = crypto_aead_xchacha20poly1305_ietf_KEYBYTES  # 32 (a size, not a secret) gitleaks:allow
NONCE_BYTES = crypto_aead_xchacha20poly1305_ietf_NPUBBYTES  # 24
VERSION = 1


class CannotOpen(Exception):
    """Wrong key, wrong person or mission, or tampered: never partial plaintext."""


def new_key() -> bytes:
    return secrets.token_bytes(KEY_BYTES)


def aad(user_id: str, mission_id: str, version: int = VERSION) -> bytes:
    for part in (user_id, mission_id):
        if "|" in part:
            raise ValueError("ids can't contain '|'")
    return f"{user_id}|{mission_id}|{version}".encode()


def seal(key: bytes, plaintext: bytes, associated: bytes) -> bytes:
    nonce = secrets.token_bytes(NONCE_BYTES)
    return nonce + crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, associated, nonce, key)


def open_(key: bytes, blob: bytes, associated: bytes) -> bytes:
    try:
        return crypto_aead_xchacha20poly1305_ietf_decrypt(
            blob[NONCE_BYTES:], associated, blob[:NONCE_BYTES], key
        )
    except (CryptoError, ValueError) as e:
        raise CannotOpen("this can't be opened with that key and context") from e


def wrap(k_user: bytes, data_key: bytes, user_id: str, scope: str) -> bytes:
    """A data key sealed under the person's key, bound to who and what it is for."""
    return seal(k_user, data_key, b"wrap|" + aad(user_id, scope))


def unwrap(k_user: bytes, wrapped: bytes, user_id: str, scope: str) -> bytes:
    return open_(k_user, wrapped, b"wrap|" + aad(user_id, scope))


def rewrap(old: bytes, new: bytes, wrapped: bytes, user_id: str, scope: str) -> bytes:
    """Key rotation: the same data key under a new K_user. The data itself is untouched."""
    return wrap(new, unwrap(old, wrapped, user_id, scope), user_id, scope)


# Recovery ----------------------------------------------------------------------------------------


def recovery_code(k_user: bytes) -> str:
    """K_user as a code to print and keep safe: groups of 4 letters and digits, no padding."""
    text = base64.b32encode(k_user).decode().rstrip("=")
    return "-".join(text[i : i + 4] for i in range(0, len(text), 4))


def from_recovery_code(code: str) -> bytes:
    text = code.replace("-", "").replace(" ", "").upper()
    key = base64.b32decode(text + "=" * (-len(text) % 8))
    if len(key) != KEY_BYTES:
        raise ValueError("that isn't a Tempo recovery code")
    return key


def split_for_helper(k_user: bytes) -> tuple[bytes, bytes]:
    """Two shares; both are needed to rebuild K_user, and either alone reveals nothing."""
    helper = secrets.token_bytes(len(k_user))
    return bytes(a ^ b for a, b in zip(k_user, helper, strict=True)), helper


def join_shares(mine: bytes, helper: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(mine, helper, strict=True))
