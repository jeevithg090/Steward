"""Webhook and caller checks. Every check fails closed and compares secrets in constant time."""

from __future__ import annotations

import hashlib
import hmac
import time
from collections import OrderedDict
from collections.abc import Mapping

from twilio.request_validator import RequestValidator

SIGNATURE_TOLERANCE_S = 30 * 60


def secret_matches(given: str | None, expected: str | None) -> bool:
    return bool(given and expected) and hmac.compare_digest(given or "", expected or "")


def twilio_signature_ok(
    auth_token: str | None, url: str, params: Mapping[str, str], signature: str | None
) -> bool:
    if not auth_token or not signature:
        return False
    return bool(RequestValidator(auth_token).validate(url, dict(params), signature))


def elevenlabs_signature_ok(
    secret: str | None, header: str | None, body: bytes, *, now: float | None = None
) -> bool:
    """(check) ElevenLabs signs post-call webhooks: `t=<unix time>,v0=<HMAC-SHA256 of t.body>`."""
    if not secret or not header:
        return False
    parts = dict(part.split("=", 1) for part in header.split(",") if "=" in part)
    timestamp, given = parts.get("t", ""), parts.get("v0", "")
    if (
        not timestamp.isdigit()
        or abs((now or time.time()) - int(timestamp)) > SIGNATURE_TOLERANCE_S
    ):
        return False
    expected = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(given, expected)


def phone_hash(phone: str) -> str:
    """People are found by a hash of their number; the number itself is never stored here."""
    digits = "".join(c for c in phone if c.isdigit() or c == "+")
    return hashlib.sha256(digits.encode()).hexdigest()


class SeenKeys:
    """Webhook delivery ids already processed (Twilio retries, duplicate post-call events)."""

    def __init__(self, capacity: int = 10_000) -> None:
        self._keys: OrderedDict[str, None] = OrderedDict()
        self._capacity = capacity

    def first_time(self, key: str) -> bool:
        if key in self._keys:
            return False
        self._keys[key] = None
        if len(self._keys) > self._capacity:
            self._keys.popitem(last=False)
        return True
