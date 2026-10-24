"""The mandate (build plan P1): a small signed document that says who let an agent act, and how far.

It names the person (by a hash, never their id), the company, the matter, the actions allowed and
refused, the amount range and the time window. It carries its own public key, relying party and
origins, so a company can check it with nothing else. The rules a sound mandate must meet are
checked when it is read, so a verifier never works on a malformed one.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator

ACTIONS = frozenset(
    {
        "claim",
        "call",
        "accept_cash",
        "accept_voucher",
        "discuss_other_accounts",
        "change_contract",
        "share_personal_data",
        "escalate",
    }
)
MAX_LIFETIME = timedelta(days=7)  # a mandate is for one matter, not a standing power


class _Part(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class PrincipalKey(_Part):
    kind: Literal["webauthn-es256", "gateway-ed25519"]
    credential_id: str | None = None  # base64url, webauthn only
    public_key: str  # COSE key (base64url) for webauthn; raw 32 bytes (base64url) for ed25519
    rp_id: str | None = None
    origins: tuple[str, ...] = ()
    key_id: str | None = None  # gateway keys only


class Principal(_Part):
    display_name: str
    user_ref: str  # "sha256:..." of the user id, never the id itself
    key: PrincipalKey


class Matter(_Part):
    skill_id: str
    mission_id: str
    rule_id: str | None = None
    account_ref: str | None = None  # masked, e.g. "****4417"


class Amount(_Part):
    min_gbp: Decimal
    max_gbp: Decimal

    @model_validator(mode="after")
    def _a_range(self) -> Self:
        if not Decimal(0) <= self.min_gbp <= self.max_gbp:
            raise ValueError("the amount range must be 0 <= min_gbp <= max_gbp")
        return self


class Mandate(_Part):
    v: Literal[1] = 1
    mandate_id: str
    principal: Principal
    agent: str = "tempo"
    counterparty: str
    matter: Matter
    may: tuple[str, ...]
    may_not: tuple[str, ...]
    amount: Amount
    issued_at: AwareDatetime
    expires_at: AwareDatetime
    nonce: str
    status_url: str

    @model_validator(mode="after")
    def _sound(self) -> Self:
        unknown = (set(self.may) | set(self.may_not)) - ACTIONS
        if unknown:
            raise ValueError(f"unknown actions: {sorted(unknown)}")
        if set(self.may) & set(self.may_not):
            raise ValueError("an action can't be both allowed and refused")
        if self.expires_at <= self.issued_at:
            raise ValueError("a mandate must end after it starts")
        if self.expires_at - self.issued_at > MAX_LIFETIME:
            raise ValueError("a mandate can last at most 7 days")
        return self


class Signature(_Part):
    kind: Literal["webauthn", "gateway-ed25519"]
    credential: dict[str, Any] | None = None  # webauthn: the assertion JSON from the browser
    key_id: str | None = None  # gateway-ed25519 only
    sig: str | None = None  # gateway-ed25519: base64url signature over the digest


class SignedMandate(_Part):
    mandate: Mandate
    signature: Signature
