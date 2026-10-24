"""Agent Passport (build plan P1): the canonical form, real passkey signatures, and every refusal.

Signatures are real: a seeded software passkey signs the mandate's digest as the WebAuthn
challenge, and py_webauthn checks it, exactly as a company's verifier would.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, get_args

import cbor2
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from hypothesis import assume, given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from tempo_core.readability import flesch_reading_ease
from tempo_passport import (
    MESSAGES,
    Mandate,
    Reason,
    Signature,
    SignedMandate,
    Verdict,
    allows,
    b64url,
    canonical_bytes,
    check,
    check_envelope,
    digest,
    unb64url,
    verify,
)
from tempo_passport.verify import COVERS, SIGNED_AND_COVERS, UNREADABLE

from ..helpers.passport import (
    COMPANY,
    FIXTURES,
    GATEWAY_KEY_ID,
    NOW,
    changed,
    gateway_key,
    gateway_signed,
    golden,
    passkey,
    raw_public,
    sign,
    trusted_keys,
)
from ..helpers.webauthn import SoftAuthenticator

GOLDEN_SHA256 = "0052b34e13d52e1c60676125af0e1f43e9d7dc4649fc7dc343a129176fd84e58"
SIGNED_FIXTURE = FIXTURES / "signed_mandate.json"
SIGNED = sign(golden())


def with_key(**fields: Any) -> Mandate:
    m = golden()
    key = m.principal.key.model_copy(update=fields)
    return m.model_copy(update={"principal": m.principal.model_copy(update={"key": key})})


def run(signed: SignedMandate, **kw: Any) -> Verdict:
    args: dict[str, Any] = {"now": NOW, "counterparty": COMPANY, "action": "claim"} | kw
    return check(signed, **args)


# --- The canonical form -------------------------------------------------------------------------


def test_the_canonical_form_is_pinned() -> None:
    body = canonical_bytes(golden())

    assert digest(golden()).hex() == GOLDEN_SHA256
    assert body.startswith(b'{"agent":"tempo","amount":{"max_gbp":"32.31","min_gbp":"32.31"},')
    assert b" " not in body.replace(b"****", b"")  # no whitespace between tokens
    assert b'"key_id":null' in body  # absent optional fields are written, as null


def test_the_golden_mandate_carries_the_fixture_passkey() -> None:
    key = golden().principal.key

    assert key.public_key == b64url(passkey().cose_public_key())
    assert key.credential_id == b64url(passkey().credential_id)


def test_non_ascii_text_is_written_as_utf8() -> None:
    m = changed(golden(), counterparty="Café Ltd")

    assert "Café".encode() in canonical_bytes(m)


# --- Signatures -----------------------------------------------------------------------------------


def test_a_passkey_signature_verifies_offline() -> None:
    verdict = verify(SIGNED, now=NOW)

    assert verdict.ok and verdict.reason == "ok"
    assert verdict.assurance == "device-biometric"
    assert verdict.checked_at == NOW and verdict.latency_ms > 0
    assert verdict.message == MESSAGES["ok"]


def test_the_signed_fixture_verifies_offline() -> None:
    """fixtures/passport/signed_mandate.json is the oracle for the browser verifier (P7)."""
    if os.environ.get("TEMPO_UPDATE_FIXTURES") == "1":
        SIGNED_FIXTURE.write_text(json.dumps(SIGNED.model_dump(mode="json"), indent=2) + "\n")
    signed = SignedMandate.model_validate_json(SIGNED_FIXTURE.read_text(encoding="utf-8"))
    assert signed.signature.credential is not None
    client_data = json.loads(unb64url(signed.signature.credential["response"]["clientDataJSON"]))

    assert signed.mandate == golden()
    assert unb64url(client_data["challenge"]) == digest(golden())
    assert verify(signed, now=NOW).ok


TEXT_PATHS = [
    ("mandate_id",), ("agent",), ("counterparty",), ("nonce",), ("status_url",),
    ("principal", "display_name"), ("principal", "user_ref"), ("principal", "key", "rp_id"),
    ("principal", "key", "credential_id"), ("matter", "skill_id"), ("matter", "mission_id"),
    ("matter", "rule_id"), ("matter", "account_ref"),
]  # fmt: skip
CHANGES = st.one_of(
    st.tuples(st.sampled_from(TEXT_PATHS), st.text(max_size=24)),
    st.tuples(
        st.just(("principal", "key", "origins")),
        st.lists(st.text(min_size=1), min_size=1, max_size=2),
    ),
    st.tuples(
        st.just(("amount", "max_gbp")),
        st.decimals(min_value=Decimal("32.32"), max_value=Decimal(9999), places=2).map(str),
    ),
    st.tuples(
        st.just(("amount", "min_gbp")),
        st.decimals(min_value=Decimal(0), max_value=Decimal("32.30"), places=2).map(str),
    ),
    st.tuples(
        st.just(("expires_at",)),
        st.integers(1, 7 * 24 * 60).map(
            lambda m: (golden().issued_at + timedelta(minutes=m)).isoformat()
        ),
    ),
    st.tuples(
        st.just(("may",)),
        st.permutations(["claim", "call", "accept_cash", "escalate"]).map(lambda p: p[:2]),
    ),
)


@settings(max_examples=60, deadline=None)
@given(CHANGES)
def test_changing_any_signed_field_breaks_the_signature(
    change: tuple[tuple[str, ...], Any],
) -> None:
    path, value = change
    data = golden().model_dump(mode="json")
    parent = data
    for part in path[:-1]:
        parent = parent[part]
    parent[path[-1]] = value
    tampered = Mandate.model_validate(data)
    assume(canonical_bytes(tampered) != canonical_bytes(golden()))

    verdict = verify(SignedMandate(mandate=tampered, signature=SIGNED.signature), now=NOW)

    assert verdict.reason == "bad_signature"
    assert verdict.assurance == "none"


# --- Every refusal --------------------------------------------------------------------------------

LATE, EARLY = NOW + timedelta(days=1), NOW - timedelta(hours=5)
OTHER_PASSKEY = SoftAuthenticator()  # same credential id, different key: only the signature differs
OTHER_PASSKEY.credential_id = passkey().credential_id

CASES: list[tuple[str, Callable[[], Verdict], Reason]] = [
    ("expired", lambda: run(SIGNED, now=LATE), "expired"),
    ("not yet valid", lambda: run(SIGNED, now=EARLY), "not_yet_valid"),
    ("wrong counterparty", lambda: run(SIGNED, counterparty="Telly Ltd"), "wrong_counterparty"),
    ("voucher is in may_not", lambda: run(SIGNED, action="accept_voucher"), "action_not_allowed"),
    ("claim not in may", lambda: run(sign(changed(golden(), may=("call",))), action="claim"), "action_not_allowed"),
    ("an action nobody knows", lambda: run(SIGNED, action="transfer_money"), "action_not_allowed"),
    ("cash above max", lambda: run(SIGNED, action="accept_cash", amount_gbp=Decimal("40")), "amount_above_max"),
    ("cash below min", lambda: run(SIGNED, action="accept_cash", amount_gbp=Decimal("30")), "amount_below_min"),
    ("revoked", lambda: run(SIGNED, revoked=lambda _: True), "revoked"),
    ("status unreachable", lambda: run(SIGNED, revoked=lambda _: None), "status_unreachable"),
    ("signed by a different key", lambda: run(sign(golden(), OTHER_PASSKEY)), "bad_signature"),
    ("garbage public key", lambda: run(sign(with_key(public_key="abcde"))), "bad_key"),
    ("unknown version", lambda: run(SIGNED.model_copy(update={"mandate": golden().model_copy(update={"v": 2})})), "unknown_version"),
]  # fmt: skip


@pytest.mark.parametrize(("name", "attempt", "reason"), CASES, ids=[c[0] for c in CASES])
def test_each_refusal(name: str, attempt: Callable[[], Verdict], reason: Reason) -> None:
    verdict = attempt()

    assert not verdict.ok
    assert verdict.reason == reason, verdict.message


def test_every_reason_is_exercised() -> None:
    seen = {attempt().reason for _, attempt, _ in CASES}

    assert seen == set(get_args(Reason)) - {"ok"}


def test_a_request_inside_the_mandate_is_allowed() -> None:
    claim = run(SIGNED)
    cash = run(SIGNED, action="accept_cash", amount_gbp=Decimal("32.31"))

    assert claim.ok and cash.ok
    assert cash.message == SIGNED_AND_COVERS and cash.assurance == "device-biometric"


def test_a_refusal_after_a_good_signature_keeps_its_assurance() -> None:
    verdict = run(SIGNED, action="accept_voucher")

    assert verdict.assurance == "device-biometric"
    assert verdict.message == "This mandate does not cover taking a voucher."


@pytest.mark.parametrize(
    ("mandate", "reason"),
    [
        (with_key(rp_id=None), "bad_key"),
        (with_key(origins=()), "bad_key"),
        (with_key(public_key=b64url(cbor2.dumps({"kty": 2}))), "bad_key"),  # not a COSE key
        (with_key(public_key=b64url(cbor2.dumps({1: 1, 3: -8, -1: 6, -2: bytes(32)}))), "bad_key"),  # Ed25519
        (with_key(public_key=b64url(cbor2.dumps({1: 2, 3: -35, -1: 1, -2: bytes(32), -3: bytes(32)}))), "bad_key"),  # ES384
        (with_key(public_key=b64url(cbor2.dumps({1: 2, 3: -7, -1: 1, -2: b"\1" * 32, -3: b"\2" * 32}))), "bad_key"),  # off the curve
        (with_key(credential_id=b64url(b"another passkey")), "bad_signature"),
    ],
)  # fmt: skip
def test_webauthn_keys_that_cannot_be_trusted(mandate: Mandate, reason: Reason) -> None:
    assert verify(sign(mandate), now=NOW).reason == reason


def test_text_with_no_utf8_form_cannot_have_been_signed() -> None:
    odd = SIGNED.model_copy(update={"mandate": golden().model_copy(update={"nonce": "\ud800"})})

    assert verify(odd, now=NOW).reason == "bad_signature"


@pytest.mark.parametrize(
    "signature",
    [
        Signature(kind="webauthn"),  # no assertion
        Signature(kind="gateway-ed25519", key_id=GATEWAY_KEY_ID, sig="AAAA"),  # the wrong kind
        Signature(kind="webauthn", credential={"id": "x"}),  # not an assertion
        Signature(kind="webauthn", credential=passkey().get({"challenge": b64url(digest(golden()))}, tamper=True)),
    ],
)  # fmt: skip
def test_webauthn_signatures_that_cannot_be_trusted(signature: Signature) -> None:
    verdict = verify(SignedMandate(mandate=golden(), signature=signature), now=NOW)

    assert verdict.reason == "bad_signature"


def test_a_failing_status_service_counts_as_unreachable() -> None:
    def broken(_: str) -> bool | None:
        raise TimeoutError

    assert verify(SIGNED, now=NOW, revoked=broken).reason == "status_unreachable"
    assert verify(SIGNED, now=NOW, revoked=lambda _: False).ok


def test_now_must_be_timezone_aware() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        verify(SIGNED, now=datetime(2026, 10, 25, 12))


# --- The Gateway's Ed25519 path (landline mandates) ----------------------------------------------


def test_a_gateway_signature_verifies_as_gateway_attested() -> None:
    verdict = verify(gateway_signed(golden()), now=NOW, gateway_keys=trusted_keys())

    assert verdict.ok
    assert verdict.assurance == "gateway-attested"


def _resigned(signed: SignedMandate, **sig: Any) -> SignedMandate:
    return signed.model_copy(update={"signature": signed.signature.model_copy(update=sig)})


SPOKEN = gateway_signed(golden())


@pytest.mark.parametrize(
    ("signed", "keys", "reason"),
    [
        (SPOKEN, {}, "bad_key"),  # the verifier doesn't trust any Gateway key
        (SPOKEN, {"gw-2": raw_public(gateway_key())}, "bad_key"),  # wrong key id
        (_resigned(SPOKEN, key_id="gw-2"), None, "bad_key"),  # the signature names another key
        (SPOKEN, {GATEWAY_KEY_ID: raw_public(gateway_key())[:31]}, "bad_key"),  # not an Ed25519 key
        (SignedMandate(mandate=SPOKEN.mandate.model_copy(update={"principal": SPOKEN.mandate.principal.model_copy(update={"key": SPOKEN.mandate.principal.key.model_copy(update={"public_key": "abcde"})})}), signature=SPOKEN.signature), None, "bad_key"),
        (gateway_signed(golden(), signer=Ed25519PrivateKey.generate()), None, "bad_signature"),
        (_resigned(SPOKEN, sig=None), None, "bad_signature"),
        (_resigned(SPOKEN, sig="abcde"), None, "bad_signature"),  # not base64url
        (_resigned(SPOKEN, kind="webauthn"), None, "bad_signature"),
    ],
)  # fmt: skip
def test_gateway_signatures_that_cannot_be_trusted(
    signed: SignedMandate, keys: dict[str, bytes] | None, reason: Reason
) -> None:
    verdict = verify(signed, now=NOW, gateway_keys=trusted_keys() if keys is None else keys)

    assert verdict.reason == reason
    assert verdict.assurance == "none"


# --- Scope without a signature, and envelopes off the wire ----------------------------------------


def test_allows_matches_the_company_whatever_the_case() -> None:
    verdict = allows(golden(), counterparty="  broadBANDLY ", action="call")

    assert verdict.ok and verdict.assurance == "none" and verdict.message == COVERS


@pytest.mark.parametrize(
    ("action", "amount", "reason", "message"),
    [
        ("transfer_money", None, "action_not_allowed", MESSAGES["action_not_allowed"]),
        ("accept_cash", Decimal("NaN"), "amount_above_max", MESSAGES["amount_above_max"]),
        ("accept_cash", Decimal("99"), "amount_above_max", "£99 is more than the £32.31 this mandate allows."),
        ("accept_cash", Decimal("5"), "amount_below_min", "£5 is less than the £32.31 this mandate allows."),
    ],
)  # fmt: skip
def test_allows_explains_each_refusal(
    action: str, amount: Decimal | None, reason: Reason, message: str
) -> None:
    verdict = allows(golden(), counterparty=COMPANY, action=action, amount_gbp=amount)

    assert (verdict.reason, verdict.message) == (reason, message)


def test_an_envelope_off_the_wire_is_checked_as_text_bytes_or_a_dict() -> None:
    text = SIGNED.model_dump_json()

    verdicts = [
        check_envelope(e, now=NOW, counterparty=COMPANY, action="claim")
        for e in (text, text.encode(), json.loads(text))
    ]

    assert all(v.ok for v in verdicts)


@pytest.mark.parametrize(
    ("envelope", "reason", "message"),
    [
        ("not json", "bad_signature", UNREADABLE),
        ("[1, 2]", "bad_signature", UNREADABLE),
        ({"signature": {"kind": "webauthn"}}, "bad_signature", UNREADABLE),
        (SIGNED.model_dump(mode="json") | {"extra": 1}, "bad_signature", UNREADABLE),
        ({**SIGNED.model_dump(mode="json"), "mandate": {**golden().model_dump(mode="json"), "v": 2}}, "unknown_version", MESSAGES["unknown_version"]),
    ],
)  # fmt: skip
def test_an_unreadable_envelope_is_refused_not_raised(
    envelope: Any, reason: Reason, message: str
) -> None:
    verdict = check_envelope(envelope, now=NOW, counterparty=COMPANY, action="claim")

    assert (verdict.ok, verdict.reason, verdict.message) == (False, reason, message)


# --- What a sound mandate is ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fields", "error"),
    [
        ({"may": ("claim", "accept_voucher")}, "both allowed and refused"),
        ({"may": ("claim", "teleport")}, "unknown actions"),
        ({"expires_at": golden().issued_at}, "end after it starts"),
        ({"expires_at": golden().issued_at + timedelta(days=7, seconds=1)}, "at most 7 days"),
        ({"amount": {"min_gbp": "40", "max_gbp": "32.31"}}, "0 <= min_gbp <= max_gbp"),
        ({"amount": {"min_gbp": "-1", "max_gbp": "32.31"}}, "0 <= min_gbp <= max_gbp"),
        ({"issued_at": "2026-10-25T08:00:00"}, "timezone"),
    ],
)  # fmt: skip
def test_unsound_mandates_are_rejected_when_read(fields: dict[str, Any], error: str) -> None:
    with pytest.raises(ValidationError, match=error):
        changed(golden(), **fields)


# --- Plain words ----------------------------------------------------------------------------------


def all_messages() -> list[str]:
    said = {v.message for _, attempt, _ in CASES for v in [attempt()]}
    return sorted(said | set(MESSAGES.values()) | {UNREADABLE, COVERS, SIGNED_AND_COVERS})


@pytest.mark.parametrize("text", all_messages())
def test_every_message_is_plain_and_keeps_secrets(text: str) -> None:
    assert flesch_reading_ease(text) >= 60, text
    assert golden().nonce not in text and golden().principal.key.public_key not in text
