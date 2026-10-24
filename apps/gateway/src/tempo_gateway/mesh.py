"""Tempo Mesh v0 (spec §15, build plan S5.2): one person's devices, paired, with passkey-signed
approvals, content-free push and a Device Router.

What v0 is, honestly: TLS, a key per device and signed passkey approvals, with the Gateway's
state as the source of truth and the WebSocket fanning changes out to every device. End-to-end
encryption (MLS), offline CRDT merges and the Rust core are the roadmap (spec §15.13).

- Device tokens are stored only as hashes; the device list file holds public keys, never secrets.
- Pairing: an existing device makes a one-time link (2 minutes) shown as a QR code. The new
  device claims it and both screens show the same 6-digit code; the existing device confirms.
- Approvals: each challenge is single-use and bound to one request and one answer (yes or no),
  so a captured approval can't be replayed or turned into a different answer.
- Push says only "sync needed"; the device fetches the details itself, over its own session.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal, Protocol

import segno
import structlog
from pydantic import BaseModel, ConfigDict, Field
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

log = structlog.get_logger("tempo.mesh")

CAPABILITIES = frozenset(
    {
        "approve.biometric",
        "notifications.show",
        "notifications.read",
        "status.live",
        "camera.capture",
    }
)
PAIRING_TTL = timedelta(minutes=2)
CHALLENGE_TTL = timedelta(minutes=5)
SYNC_PAYLOAD = json.dumps({"type": "sync"})  # all a push ever says


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class MeshError(Exception):
    status = 400


class NotFound(MeshError):
    status = 404


class Expired(MeshError):
    status = 410


class Replayed(MeshError):
    status = 409


class BadSignature(MeshError):
    status = 401


class Device(BaseModel):
    id: str
    user_id: str
    name: str = Field(max_length=60)
    capabilities: tuple[str, ...] = ()
    token_hash: str
    active: bool = True  # False until the pairing is confirmed on an existing device
    credential_id: str | None = None  # the passkey (base64url)
    public_key: str | None = None  # its COSE public key (base64url)
    sign_count: int = 0
    push: dict[str, Any] | None = None  # the Web Push subscription
    last_active: datetime

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "capabilities": list(self.capabilities),
            "active": self.active, "passkey": self.credential_id is not None,
            "push": self.push is not None, "last_active": self.last_active.isoformat(),
        }  # fmt: skip


class Pairing(BaseModel):
    id: str
    user_id: str
    secret_hash: str
    by_device: str
    expires_at: datetime
    new_device: str | None = None
    code: str | None = None


class Challenge(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str  # the challenge bytes, base64url
    device_id: str
    purpose: Literal["register", "approve"]
    request_id: str | None = None
    approved: bool | None = None
    limits: tuple[tuple[str, str], ...] = ()  # signed with the answer, e.g. auto_accept_max_gbp
    expires_at: datetime


class PushSender(Protocol):
    async def send(self, subscription: dict[str, Any], payload: str) -> bool:
        """False when the subscription is gone (the browser unsubscribed)."""
        ...


class WebPushSender:
    """(check) Web Push with VAPID through pywebpush."""

    def __init__(self, private_key: str, subject: str) -> None:
        self.private_key, self.subject = private_key, subject

    async def send(self, subscription: dict[str, Any], payload: str) -> bool:
        from pywebpush import WebPushException, webpush

        try:
            await asyncio.to_thread(
                webpush, subscription, data=payload, vapid_private_key=self.private_key,
                vapid_claims={"sub": self.subject}, timeout=10,
            )  # fmt: skip
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):
                return False
            log.warning("push_failed", error_code=str(status))
        return True


class Mesh:
    def __init__(
        self,
        *,
        rp_id: str,
        origins: list[str],
        path: Path | None = None,
        push: PushSender | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.rp_id, self.origins, self.path, self.push, self.clock = (
            rp_id, origins, path, push, clock,
        )  # fmt: skip
        self.devices: dict[str, Device] = {}
        self.pairings: dict[str, Pairing] = {}
        self.challenges: dict[str, Challenge] = {}
        if path is not None and path.exists():
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.devices = {d["id"]: Device.model_validate(d) for d in saved.get("devices", [])}

    # Devices ------------------------------------------------------------------------------------

    def add_device(
        self, user_id: str, name: str, capabilities: list[str], *, active: bool = True
    ) -> tuple[Device, str]:
        token = secrets.token_urlsafe(32)
        device = Device(
            id=f"d_{uuid.uuid4().hex[:12]}", user_id=user_id, name=name,
            capabilities=tuple(c for c in capabilities if c in CAPABILITIES),
            token_hash=_hash(token), active=active, last_active=self.clock(),
        )  # fmt: skip
        self.devices[device.id] = device
        self._save()
        return device, token

    def device_for_token(self, token: str | None) -> Device | None:
        if not token:
            return None
        wanted = _hash(token)
        for device in self.devices.values():
            if hmac.compare_digest(device.token_hash, wanted):
                return self._touch(device)
        return None

    def devices_of(self, user_id: str) -> list[Device]:
        return [d for d in self.devices.values() if d.user_id == user_id]

    def remove(self, by: Device, device_id: str) -> None:
        """A lost phone can be removed from any of the person's other devices."""
        target = self.devices.get(device_id)
        if target is None or target.user_id != by.user_id:
            raise NotFound("no such device")
        del self.devices[device_id]
        self._save()

    def set_push(self, device: Device, subscription: dict[str, Any] | None) -> None:
        self._update(device, push=subscription)

    def has_passkey(self, user_id: str) -> bool:
        return any(d.credential_id for d in self.devices_of(user_id) if d.active)

    # Pairing ------------------------------------------------------------------------------------

    def start_pairing(self, by: Device, web_origin: str) -> dict[str, Any]:
        secret = secrets.token_urlsafe(16)
        pairing = Pairing(
            id=uuid.uuid4().hex[:12], user_id=by.user_id, secret_hash=_hash(secret),
            by_device=by.id, expires_at=self.clock() + PAIRING_TTL,
        )  # fmt: skip
        self.pairings[pairing.id] = pairing
        link = f"{web_origin.rstrip('/')}/#pair={pairing.id}.{secret}"
        return {
            "pairing_id": pairing.id, "link": link, "expires_at": pairing.expires_at.isoformat(),
            "qr_svg": segno.make(link, error="m").svg_inline(scale=4, border=2),
        }  # fmt: skip

    def claim(
        self, pairing_id: str, secret: str, name: str, capabilities: list[str]
    ) -> tuple[Device, str, str]:
        pairing = self._live_pairing(pairing_id)
        if not hmac.compare_digest(pairing.secret_hash, _hash(secret)):
            raise BadSignature("that pairing link isn't valid")
        if pairing.new_device is not None:
            raise Replayed("this pairing link was already used")
        device, token = self.add_device(pairing.user_id, name, capabilities, active=False)
        mac = hmac.new(secret.encode(), f"{pairing.id}:{device.id}".encode(), hashlib.sha256)
        code = f"{int.from_bytes(mac.digest()[:4]) % 1_000_000:06d}"
        self.pairings[pairing.id] = pairing.model_copy(
            update={"new_device": device.id, "code": code}
        )
        return device, token, code

    def pairing_status(self, by: Device, pairing_id: str) -> dict[str, Any]:
        pairing = self._own_pairing(by, pairing_id)
        new = self.devices.get(pairing.new_device or "")
        return {
            "claimed": new is not None,
            "code": pairing.code,
            "device_name": new.name if new else None,
        }

    def confirm(self, by: Device, pairing_id: str) -> Device:
        """The codes matched: the new device joins the person's mesh."""
        pairing = self._own_pairing(by, pairing_id)
        new = self.devices.get(pairing.new_device or "")
        if new is None:
            raise NotFound("nothing has claimed this pairing yet")
        del self.pairings[pairing_id]
        return self._update(new, active=True)

    # Passkeys -----------------------------------------------------------------------------------

    def registration_options(self, device: Device) -> dict[str, Any]:
        challenge = self._challenge(device, "register")
        options = generate_registration_options(
            rp_id=self.rp_id, rp_name="Tempo", user_name=device.user_id,
            user_id=device.user_id.encode(), user_display_name=device.name,
            challenge=unb64url(challenge.id),
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
        )  # fmt: skip
        return {"challenge_id": challenge.id, "options": json.loads(options_to_json(options))}

    def finish_registration(
        self, device: Device, challenge_id: str, credential: dict[str, Any]
    ) -> None:
        challenge = self._take(device, challenge_id, "register")
        try:
            verified = verify_registration_response(
                credential=credential, expected_challenge=unb64url(challenge.id),
                expected_rp_id=self.rp_id, expected_origin=self.origins,
                require_user_verification=True,
            )  # fmt: skip
        except InvalidRegistrationResponse as e:
            raise BadSignature("the passkey couldn't be verified") from e
        self._update(
            device, credential_id=b64url(verified.credential_id),
            public_key=b64url(verified.credential_public_key), sign_count=verified.sign_count,
        )  # fmt: skip

    def approval_options(
        self,
        device: Device,
        request_id: str,
        approved: bool,
        limits: tuple[tuple[str, str], ...] = (),
    ) -> dict[str, Any]:
        if device.credential_id is None:
            raise NotFound("this device has no passkey yet")
        challenge = self._challenge(
            device, "approve", request_id=request_id, approved=approved, limits=limits
        )
        options = generate_authentication_options(
            rp_id=self.rp_id, challenge=unb64url(challenge.id),
            allow_credentials=[PublicKeyCredentialDescriptor(id=unb64url(device.credential_id))],
            user_verification=UserVerificationRequirement.REQUIRED,
        )  # fmt: skip
        return {"challenge_id": challenge.id, "options": json.loads(options_to_json(options))}

    def verify_approval(
        self, device: Device, request_id: str, challenge_id: str, credential: dict[str, Any]
    ) -> Challenge:
        """Check a signed answer; returns what was signed (the answer and its limits)."""
        challenge = self._take(device, challenge_id, "approve")
        if challenge.request_id != request_id or challenge.approved is None:
            raise BadSignature("that signature was for a different question")
        if device.credential_id is None or device.public_key is None:
            raise BadSignature("this device has no passkey")
        try:
            verified = verify_authentication_response(
                credential=credential, expected_challenge=unb64url(challenge.id),
                expected_rp_id=self.rp_id, expected_origin=self.origins,
                credential_public_key=unb64url(device.public_key),
                credential_current_sign_count=device.sign_count, require_user_verification=True,
            )  # fmt: skip
        except InvalidAuthenticationResponse as e:
            raise BadSignature("the approval signature didn't verify") from e
        if b64url(verified.credential_id) != device.credential_id:
            raise BadSignature("that passkey belongs to another device")
        self._update(device, sign_count=verified.new_sign_count)
        return challenge

    # Device Router and push ---------------------------------------------------------------------

    def route(self, user_id: str, capability: str = "approve.biometric") -> Device | None:
        """v0: the most recently active device that can do it and can be woken (spec §15.8)."""
        able = [
            d for d in self.devices_of(user_id)
            if d.active and capability in d.capabilities and d.push is not None
        ]  # fmt: skip
        return max(able, key=lambda d: d.last_active, default=None)

    async def notify(self, user_id: str) -> Device | None:
        device = self.route(user_id) or self.route(user_id, "notifications.show")
        if device is None or device.push is None or self.push is None:
            return None
        if not await self.push.send(device.push, SYNC_PAYLOAD):
            self.set_push(device, None)  # the browser unsubscribed
            return None
        return device

    # Internals ----------------------------------------------------------------------------------

    def _challenge(
        self, device: Device, purpose: Literal["register", "approve"], **bound: Any
    ) -> Challenge:
        challenge = Challenge(
            id=b64url(secrets.token_bytes(32)), device_id=device.id, purpose=purpose,
            expires_at=self.clock() + CHALLENGE_TTL, **bound,
        )  # fmt: skip
        self.challenges[challenge.id] = challenge
        return challenge

    def _take(self, device: Device, challenge_id: str, purpose: str) -> Challenge:
        """Single use: a challenge is gone after the first attempt, right or wrong."""
        challenge = self.challenges.pop(challenge_id, None)
        if challenge is None:
            raise Replayed("that challenge was already used, or never issued")
        if challenge.device_id != device.id or challenge.purpose != purpose:
            raise BadSignature("that challenge is for another device")
        if self.clock() >= challenge.expires_at:
            raise Expired("that challenge expired; ask again")
        return challenge

    def _live_pairing(self, pairing_id: str) -> Pairing:
        pairing = self.pairings.get(pairing_id)
        if pairing is None:
            raise NotFound("no such pairing")
        if self.clock() >= pairing.expires_at:
            del self.pairings[pairing_id]
            raise Expired("that pairing link expired; make a new one")
        return pairing

    def _own_pairing(self, by: Device, pairing_id: str) -> Pairing:
        pairing = self.pairings.get(pairing_id)
        if pairing is None or pairing.by_device != by.id:
            raise NotFound("no such pairing")
        return pairing

    def _touch(self, device: Device) -> Device:
        touched = device.model_copy(update={"last_active": self.clock()})
        self.devices[device.id] = touched
        return touched

    def _update(self, device: Device, **changes: Any) -> Device:
        updated = self.devices[device.id].model_copy(update=changes)
        self.devices[device.id] = updated
        self._save()
        return updated

    def _save(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        body = {"devices": [d.model_dump(mode="json") for d in self.devices.values()]}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(body, indent=1), encoding="utf-8")
        tmp.replace(self.path)
