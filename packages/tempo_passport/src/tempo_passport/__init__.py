"""Agent Passport: a mandate signed by the person, checked offline by anyone (build plan P1).

Pure and strictly typed, so Tempo's Harness, the Gateway and a company's own agent can all import
it and reach the same verdict on the same mandate.
"""

from tempo_passport.canonical import b64url, canonical_bytes, digest, unb64url
from tempo_passport.mandate import (
    ACTIONS,
    Amount,
    Mandate,
    Matter,
    Principal,
    PrincipalKey,
    Signature,
    SignedMandate,
)
from tempo_passport.signature import Assurance
from tempo_passport.verify import (
    MESSAGES,
    NO_KEYS,
    Reason,
    Revoked,
    Verdict,
    allows,
    check,
    check_envelope,
    verify,
)

__all__ = [
    "ACTIONS",
    "MESSAGES",
    "NO_KEYS",
    "Amount",
    "Assurance",
    "Mandate",
    "Matter",
    "Principal",
    "PrincipalKey",
    "Reason",
    "Revoked",
    "Signature",
    "SignedMandate",
    "Verdict",
    "allows",
    "b64url",
    "canonical_bytes",
    "check",
    "check_envelope",
    "digest",
    "unb64url",
    "verify",
]
