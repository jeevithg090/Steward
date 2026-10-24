"""Agent Passport in the Gateway (build plan P2): issue mandates, keep them, say whether one is
live, and revoke them through the consent ledger.

Two ways to issue:
- a passkey (Face ID) signs the mandate's digest on the person's device (`device-biometric`);
- a spoken yes on the landline becomes a Gateway-signed mandate (`gateway-attested`, weaker,
  and it says so).

A mandate carries its own key, so its signature alone proves only that *someone* signed it. The
issuer check closes that: a company asks Tempo about the mandate id *and its digest*, and Tempo
answers "active" only for the exact mandate it issued. A forged one, even one signed with a real
passkey of the forger's own, comes back "unknown" and is refused (fail closed, docs/adr/0004).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import ValidationError

from tempo_core.consent import ConsentEvent, ConsentKind
from tempo_passport import (
    Amount,
    Mandate,
    Matter,
    Principal,
    PrincipalKey,
    Revoked,
    Signature,
    SignedMandate,
    Verdict,
    b64url,
    check,
    check_envelope,
    digest,
)
from tempo_ports.repo import RepoPort

Status = Literal["active", "revoked", "expired", "unknown"]
MAY = ("claim", "call", "accept_cash")
MAY_NOT = ("accept_voucher", "discuss_other_accounts", "change_contract", "share_personal_data")
TTL = timedelta(hours=24)
SKEW = timedelta(minutes=1)  # issued a minute early, so a company's slow clock still accepts it
GATEWAY_KEY_ID = "gw-1"


class NoSigningKey(Exception):
    """A spoken mandate needs MANDATE_SIGNING_KEY; without it Tempo says it can't, honestly."""


def gateway_key(seed_b64: str | None) -> Ed25519PrivateKey | None:
    """MANDATE_SIGNING_KEY: a base64url 32-byte seed (scripts/gen_mandate_key.py makes one)."""
    if not seed_b64:
        return None
    import base64

    seed = base64.urlsafe_b64decode(seed_b64 + "=" * (-len(seed_b64) % 4))
    return Ed25519PrivateKey.from_private_bytes(seed)


def masked(reference: str | None) -> str | None:
    return f"****{reference[-4:]}" if reference else None


class MandateService:
    def __init__(
        self,
        repo: RepoPort,
        clock: Callable[[], datetime],
        *,
        public_url: str,
        signing_key: Ed25519PrivateKey | None = None,
    ) -> None:
        self._repo, self._clock, self._public_url = repo, clock, public_url.rstrip("/")
        self._key = signing_key
        self._issued: dict[str, SignedMandate] = {}
        self._revoked: set[str] = set()
        self._by_mission: dict[str, list[str]] = defaultdict(list)

    @property
    def gateway_keys(self) -> Mapping[str, bytes]:
        if self._key is None:
            return {}
        raw = self._key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        return {GATEWAY_KEY_ID: raw}

    def draft(
        self,
        *,
        mission_id: str,
        user_id: str,
        display_name: str,
        counterparty: str,
        skill_id: str,
        amount_gbp: Decimal,
        rule_id: str | None = None,
        account_ref: str | None = None,
        may: Sequence[str] = MAY,
        may_not: Sequence[str] = MAY_NOT,
        ttl: timedelta = TTL,
    ) -> Mandate:
        """A mandate for one matter, one company and one amount; the key is set when it's signed."""
        now, mandate_id = self._clock(), f"md_{uuid.uuid4().hex[:12]}"
        return Mandate(
            mandate_id=mandate_id,
            principal=Principal(
                display_name=display_name,
                user_ref="sha256:" + hashlib.sha256(user_id.encode()).hexdigest(),
                key=PrincipalKey(kind="webauthn-es256", public_key="unset"),
            ),
            counterparty=counterparty,
            matter=Matter(
                skill_id=skill_id,
                mission_id=mission_id,
                rule_id=rule_id,
                account_ref=masked(account_ref),
            ),
            may=tuple(may),
            may_not=tuple(may_not),
            amount=Amount(min_gbp=amount_gbp, max_gbp=amount_gbp),
            issued_at=now - SKEW,
            expires_at=now + ttl,
            nonce=secrets.token_urlsafe(16),
            status_url=f"{self._public_url}/mandates/{mandate_id}",
        )

    def store(self, signed: SignedMandate) -> SignedMandate:
        mandate = signed.mandate
        if mandate.mandate_id in self._issued:
            raise ValueError("this mandate was already issued")
        self._issued[mandate.mandate_id] = signed
        self._by_mission[mandate.matter.mission_id].append(mandate.mandate_id)
        return signed

    def issue_spoken(self, draft: Mandate) -> SignedMandate:
        """A landline yes: the Gateway signs, and the mandate says it's only gateway-attested."""
        if self._key is None:
            raise NoSigningKey("set MANDATE_SIGNING_KEY to issue mandates on the landline")
        key = PrincipalKey(
            kind="gateway-ed25519", public_key=b64url(self.gateway_keys[GATEWAY_KEY_ID]),
            key_id=GATEWAY_KEY_ID,
        )  # fmt: skip
        principal = draft.principal.model_copy(update={"key": key})
        mandate = Mandate.model_validate(
            draft.model_copy(update={"principal": principal}).model_dump()
        )
        signature = b64url(self._key.sign(digest(mandate)))
        sig = Signature(kind="gateway-ed25519", key_id=GATEWAY_KEY_ID, sig=signature)
        return self.store(SignedMandate(mandate=mandate, signature=sig))

    def status(self, mandate_id: str, digest_hex: str | None = None) -> Status:
        """What Tempo knows about this mandate. With a digest, only the exact mandate it issued."""
        signed = self._issued.get(mandate_id)
        if signed is None:
            return "unknown"
        if digest_hex is not None and not hmac.compare_digest(
            digest_hex, digest(signed.mandate).hex()
        ):
            return "unknown"
        if mandate_id in self._revoked:
            return "revoked"
        return "expired" if self._clock() >= signed.mandate.expires_at else "active"

    def revoked_for(self, presented: SignedMandate) -> Revoked:
        """The revocation check for a presented mandate: it must be the one Tempo issued."""
        try:
            expected = digest(presented.mandate).hex()
        except UnicodeEncodeError:
            return lambda _: None
        answers: dict[Status, bool | None] = {"active": False, "expired": False, "revoked": True}
        return lambda mandate_id: answers.get(self.status(mandate_id, expected))

    def verify(
        self,
        envelope: str | Mapping[str, Any],
        *,
        counterparty: str,
        action: str,
        amount_gbp: Decimal | None = None,
    ) -> Verdict:
        """A company's question: genuine, live, issued by Tempo, and does it cover this?"""
        try:
            signed = (
                SignedMandate.model_validate_json(envelope)
                if isinstance(envelope, str)
                else SignedMandate.model_validate(envelope)
            )
        except ValidationError:
            now = self._clock()
            return check_envelope(envelope, now=now, counterparty=counterparty, action=action)
        return check(
            signed, now=self._clock(), counterparty=counterparty, action=action,
            amount_gbp=amount_gbp, revoked=self.revoked_for(signed),
            gateway_keys=self.gateway_keys,
        )  # fmt: skip

    async def revoke(self, mandate_id: str, device_sig: str) -> Status:
        """Deny wins: the revoke is written to the consent ledger and takes effect at once."""
        signed = self._issued.get(mandate_id)
        if signed is None:
            return "unknown"
        self._revoked.add(mandate_id)
        await self._repo.append_consent(ConsentEvent(
            mission_id=signed.mandate.matter.mission_id, scope=f"mandate:{mandate_id}",
            kind=ConsentKind.REVOKE, at=self._clock(), device_sig=device_sig,
        ))  # fmt: skip
        return "revoked"

    async def revoke_all(self, mission_id: str, device_sig: str) -> list[str]:
        """STOP: every mandate for the mission, wherever the STOP came from."""
        live = [m for m in self._by_mission.get(mission_id, []) if m not in self._revoked]
        for mandate_id in live:
            await self.revoke(mandate_id, device_sig)
        return live

    def envelope(self, mandate_id: str) -> SignedMandate | None:
        """The mandate as issued, for a voice line that only heard its id read out."""
        return self._issued.get(mandate_id)

    def active_for(self, mission_id: str) -> SignedMandate | None:
        live = [m for m in self._by_mission.get(mission_id, []) if self.status(m) == "active"]
        return self._issued[live[-1]] if live else None

    def summary(self, mission_id: str) -> dict[str, Any] | None:
        """The newest mandate for the mission, for Mission Control's Passport card."""
        ids = self._by_mission.get(mission_id, [])
        if not ids:
            return None
        mandate_id = ids[-1]
        signed = self._issued[mandate_id]
        m = signed.mandate
        biometric = m.principal.key.kind == "webauthn-es256"
        return {
            "id": mandate_id, "status": self.status(mandate_id), "counterparty": m.counterparty,
            "may": list(m.may), "may_not": list(m.may_not), "max_gbp": str(m.amount.max_gbp),
            "expires_at": m.expires_at.isoformat(), "account_ref": m.matter.account_ref,
            "assurance": "device-biometric" if biometric else "gateway-attested",
            "digest": digest(m).hex(),
        }  # fmt: skip
