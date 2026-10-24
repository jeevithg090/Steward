"""The Agent Passport red team (build plan P5): ten attacks refused, two honest calls allowed.

Every row goes through `check_envelope`, the call a company's agent makes on the JSON it was
handed, which is also what Tempo's MandateGuard runs (as `check`). CI only asserts. To rewrite
docs/passport_redteam.md (keeping its "Latency" section from scripts/bench_passport.py):

    TEMPO_UPDATE_DOCS=1 uv run pytest tests/policy/test_passport_redteam.py
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tempo_passport import (
    PrincipalKey,
    Revoked,
    Signature,
    SignedMandate,
    Verdict,
    b64url,
    check_envelope,
    digest,
)

from ..helpers.passport import (
    COMPANY,
    GATEWAY_KEY_ID,
    NOW,
    changed,
    golden,
    raw_public,
    sign,
    trusted_keys,
)

DOC = Path(__file__).resolve().parents[2] / "docs" / "passport_redteam.md"
LATENCY = "## Latency"
SIGNED = sign(golden())


def wire(
    signed: SignedMandate,
    action: str = "claim",
    amount: str | None = None,
    *,
    company: str = COMPANY,
    at: timedelta = timedelta(0),
    revoked: Revoked | None = None,
) -> Verdict:
    """The company's check, on the JSON it was handed."""
    return check_envelope(
        signed.model_dump_json(), now=NOW + at, counterparty=company, action=action,
        amount_gbp=None if amount is None else Decimal(amount), revoked=revoked,
        gateway_keys=trusted_keys(),
    )  # fmt: skip


def forged() -> Verdict:
    """Vouchers added to her mandate; her signature kept."""
    more = changed(golden(), may=(*golden().may, "accept_voucher"), may_not=("change_contract",))
    return wire(SignedMandate(mandate=more, signature=SIGNED.signature), "accept_voucher")


def replayed() -> Verdict:
    """An assertion captured when yesterday's mandate was issued, replayed to issue a bigger one."""
    yesterday = changed(
        golden(), nonce="n_yesterday", issued_at=golden().issued_at - timedelta(days=1)
    )
    captured = sign(yesterday).signature
    bigger = changed(golden(), amount={"min_gbp": "32.31", "max_gbp": "500"})
    return wire(SignedMandate(mandate=bigger, signature=captured), "accept_cash", "500")


def revoked_mid_call() -> Verdict:
    """The first check passes; she texts STOP; the company checks again before paying."""
    stopped: list[bool] = [False]
    first = wire(SIGNED, revoked=lambda _: stopped[0])
    assert first.ok
    stopped[0] = True
    return wire(SIGNED, "accept_cash", "32.31", revoked=lambda _: stopped[0])


def wrong_key() -> Verdict:
    """A self-made "Gateway" mandate: the attacker's own Ed25519 key, claiming the Gateway's id."""
    attacker = Ed25519PrivateKey.generate()
    key = PrincipalKey(
        kind="gateway-ed25519", public_key=b64url(raw_public(attacker)), key_id=GATEWAY_KEY_ID
    )
    fake = changed(
        golden(), principal=golden().principal.model_copy(update={"key": key}).model_dump()
    )
    sig = Signature(
        kind="gateway-ed25519", key_id=GATEWAY_KEY_ID, sig=b64url(attacker.sign(digest(fake)))
    )
    return wire(SignedMandate(mandate=fake, signature=sig))


@dataclass(frozen=True)
class Row:
    name: str
    attempt: Callable[[], Verdict]
    reason: str


ATTACKS = [
    Row("Forged signature: vouchers added to her mandate, her signature kept", forged, "bad_signature"),
    Row("Expired: the mandate used the day after it ran out", lambda: wire(SIGNED, at=timedelta(days=1)), "expired"),
    Row("Not yet valid: used before its start time", lambda: wire(SIGNED, at=-timedelta(hours=5)), "not_yet_valid"),
    Row("Replayed challenge at issue time: an old assertion on a new, bigger mandate", replayed, "bad_signature"),
    Row("Amount above max: £99 when she allowed £32.31", lambda: wire(SIGNED, "accept_cash", "99"), "amount_above_max"),
    Row("Voucher instead of cash", lambda: wire(SIGNED, "accept_voucher", "32.31"), "action_not_allowed"),
    Row("Out-of-scope matter: her mobile contract", lambda: wire(SIGNED, "discuss_other_accounts"), "action_not_allowed"),
    Row("Wrong counterparty: her Broadbandly mandate shown to another company", lambda: wire(SIGNED, company="Telly Ltd"), "wrong_counterparty"),
    Row("Revoked mid-call: STOP after the first check", revoked_mid_call, "revoked"),
    Row("Wrong key: a self-signed mandate posing as the Gateway", wrong_key, "bad_key"),
]  # fmt: skip
LEGITIMATE = [
    Row("Make the claim she signed for", lambda: wire(SIGNED, "claim"), "ok"),
    Row("Accept £32.31 in cash, the amount she signed for", lambda: wire(SIGNED, "accept_cash", "32.31"), "ok"),
]  # fmt: skip


@pytest.mark.parametrize("row", ATTACKS, ids=[r.reason for r in ATTACKS])
def test_every_attack_is_refused(row: Row) -> None:
    verdict = row.attempt()

    assert not verdict.ok
    assert verdict.reason == row.reason, verdict.message


@pytest.mark.parametrize("row", LEGITIMATE, ids=["claim", "cash"])
def test_legitimate_calls_are_allowed(row: Row) -> None:
    verdict = row.attempt()

    assert verdict.ok and verdict.assurance == "device-biometric"


def test_the_red_team_table() -> None:
    attacks = [(row, row.attempt()) for row in ATTACKS]
    honest = [(row, row.attempt()) for row in LEGITIMATE]

    assert sum(not v.ok for _, v in attacks) == 10
    assert sum(v.ok for _, v in honest) == 2
    if os.environ.get("TEMPO_UPDATE_DOCS") == "1":
        DOC.write_text(table(attacks, honest) + _kept_latency(), encoding="utf-8")


def table(attacks: list[tuple[Row, Verdict]], honest: list[tuple[Row, Any]]) -> str:
    refused = sum(not v.ok for _, v in attacks)
    allowed = sum(v.ok for _, v in honest)
    lines = [
        "# Agent Passport: red team",
        "",
        "Ten attacks on Margaret's signed mandate and two honest calls, each checked by the code a "
        "company's agent runs on the JSON it is handed (`tempo_passport.check_envelope`). Tempo's "
        "own Harness runs the same check (`MandateGuard`) before every binding tool. The passkey "
        "signatures are real ES256 WebAuthn assertions from a software passkey.",
        "",
        f"**{refused}/{len(attacks)} attacks refused. {allowed}/{len(honest)} honest calls allowed.**",
        "",
        "| # | Attack | Reason code | Refused |",
        "|---|---|---|---|",
        *(f"| {i} | {r.name} | `{v.reason}` | {'yes' if not v.ok else '**NO**'} |" for i, (r, v) in enumerate(attacks, 1)),
        "",
        "| Honest call | Reason code | Allowed |",
        "|---|---|---|",
        *(f"| {r.name} | `{v.reason}` | {'yes' if v.ok else '**NO**'} |" for r, v in honest),
        "",
        "Honest notes: the key is self-certifying tonight (the mandate carries its own public key; "
        "a directory or attestation issuer is the roadmap). A landline mandate is signed by the "
        "Gateway (`gateway-attested`), not by a passkey (`device-biometric`). Sign counts are not "
        "checked, because a third party sees one assertion; the window, the nonce and revocation "
        "bound replay instead.",
        "",
        "**The attack this table can't show.** Because the key is self-certifying, a fresh mandate "
        "signed with a forger's *own* passkey passes this offline check. The Gateway closes it: a "
        "company asks Tempo about the mandate id *and its digest*, and Tempo answers \"active\" "
        "only for the exact mandate it issued, so the forgery is refused as `status_unreachable` "
        "(tests/integration/test_mandates.py, "
        "`test_a_well_signed_mandate_tempo_did_not_issue_is_refused`).",
        "",
        "Regenerate: `TEMPO_UPDATE_DOCS=1 uv run pytest tests/policy/test_passport_redteam.py`.",
        "",
    ]  # fmt: skip
    return "\n".join(lines) + "\n"


def _kept_latency() -> str:
    """The Latency section belongs to scripts/bench_passport.py; keep whatever it last wrote."""
    text = DOC.read_text(encoding="utf-8") if DOC.exists() else ""
    return (
        text[text.index(LATENCY) :]
        if LATENCY in text
        else f"{LATENCY}\n\nRun `uv run python scripts/bench_passport.py`.\n"
    )
