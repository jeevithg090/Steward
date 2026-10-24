"""Does this signature match this mandate and its key? A passkey (ES256) or the Gateway (Ed25519).

A passkey signs the mandate because the WebAuthn challenge is the mandate's digest. Sign counts
are not checked (``credential_current_sign_count=0``) on purpose: a third party sees one assertion
and can't track an authenticator's counter, so replay is bounded by the window, the nonce and the
revocation check instead. A Gateway signature counts only with a key the verifier already trusts.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from webauthn import verify_authentication_response
from webauthn.helpers import decode_credential_public_key, decoded_public_key_to_cryptography
from webauthn.helpers.cose import COSECRV, COSEAlgorithmIdentifier
from webauthn.helpers.decode_credential_public_key import DecodedEC2PublicKey

from tempo_passport.canonical import b64url, digest, unb64url
from tempo_passport.mandate import PrincipalKey, SignedMandate

SignatureReason = Literal["ok", "bad_signature", "bad_key"]
Assurance = Literal["device-biometric", "gateway-attested", "none"]


def signature_reason(
    signed: SignedMandate, keys: Mapping[str, bytes]
) -> tuple[SignatureReason, Assurance]:
    """The outcome, and the assurance it gives when it is "ok"."""
    try:
        challenge = digest(signed.mandate)
    except UnicodeEncodeError:  # text with no UTF-8 form can't have been signed
        return "bad_signature", "none"
    if signed.mandate.principal.key.kind == "webauthn-es256":
        return _webauthn(signed, challenge), "device-biometric"
    return _ed25519(signed, challenge, keys), "gateway-attested"


def _webauthn(signed: SignedMandate, challenge: bytes) -> SignatureReason:
    key, credential = signed.mandate.principal.key, signed.signature.credential
    public_key = _es256(key)
    if public_key is None or key.rp_id is None or not key.origins:
        return "bad_key"
    if signed.signature.kind != "webauthn" or credential is None:
        return "bad_signature"
    try:
        verified = verify_authentication_response(
            credential=credential, expected_challenge=challenge, expected_rp_id=key.rp_id,
            expected_origin=list(key.origins), credential_public_key=public_key,
            credential_current_sign_count=0, require_user_verification=True,
        )  # fmt: skip
    except Exception:  # any failure to verify is a refusal, whatever raised it
        return "bad_signature"
    if key.credential_id is not None and b64url(verified.credential_id) != key.credential_id:
        return "bad_signature"
    return "ok"


def _es256(key: PrincipalKey) -> bytes | None:
    """The COSE key's bytes if it is a usable ES256 (P-256) public key, else None."""
    try:
        raw = unb64url(key.public_key)
        decoded = decode_credential_public_key(raw)
        if not isinstance(decoded, DecodedEC2PublicKey):
            return None
        if decoded.alg != COSEAlgorithmIdentifier.ECDSA_SHA_256 or decoded.crv != COSECRV.P256:
            return None
        decoded_public_key_to_cryptography(decoded)  # the point must be on the curve
    except Exception:
        return None
    return raw


def _ed25519(signed: SignedMandate, challenge: bytes, keys: Mapping[str, bytes]) -> SignatureReason:
    """The mandate's copy of the Gateway key must match one the verifier trusts, by key id."""
    key, sig = signed.mandate.principal.key, signed.signature
    trusted = keys.get(key.key_id or "")
    if trusted is None or sig.key_id != key.key_id or not _same_key(key.public_key, trusted):
        return "bad_key"
    if sig.kind != "gateway-ed25519" or sig.sig is None:
        return "bad_signature"
    try:
        Ed25519PublicKey.from_public_bytes(trusted).verify(unb64url(sig.sig), challenge)
    except (InvalidSignature, ValueError):
        return "bad_signature"
    return "ok"


def _same_key(text: str, trusted: bytes) -> bool:
    try:
        return len(trusted) == 32 and unb64url(text) == trusted
    except ValueError:
        return False
