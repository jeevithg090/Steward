"""Ephemeral workers: a key is released only to a trusted, fresh worker, for one step (S8.4)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tempo_crypto.envelope import aad, new_key, open_, seal
from tempo_crypto.worker_identity import (
    EphemeralWorker,
    ReleaseRefused,
    SignedReport,
    release_context,
    sign_report,
    unb64,
    verify_report,
    wrap_for_worker,
)

NOW = datetime(2026, 10, 24, 19, 0, tzinfo=UTC)
DIGEST = "sha256:" + "a" * 64
DEPLOY = Ed25519PrivateKey.generate()
STATE_AAD = aad("u_margaret", "m_1")


def worker(
    at: datetime = NOW, digest: str = DIGEST, signer: Ed25519PrivateKey = DEPLOY
) -> EphemeralWorker:
    return EphemeralWorker(digest, signer, now=lambda: at)


def check(
    signed: SignedReport,
    *,
    now: datetime = NOW,
    seen: set[str] | None = None,
    allow: tuple[str, ...] = (DIGEST,),
) -> object:
    return verify_report(
        signed, DEPLOY.public_key(), allow, now=now, seen_nonces=set() if seen is None else seen
    )


def test_a_fresh_signed_report_from_an_allowed_image_passes() -> None:
    w = worker()

    assert check(w.signed) == w.signed.report
    assert SignedReport.from_json(w.signed.to_json()) == w.signed


def test_report_with_unknown_digest_rejected() -> None:
    with pytest.raises(ReleaseRefused, match="allowlist"):
        check(worker(digest="sha256:" + "b" * 64).signed)


def test_stale_report_rejected() -> None:
    with pytest.raises(ReleaseRefused, match="stale"):
        check(worker(at=NOW - timedelta(seconds=61)).signed)
    with pytest.raises(ReleaseRefused, match="stale"):
        check(worker(at=NOW + timedelta(minutes=5)).signed)  # a clock far ahead is no better


def test_replayed_nonce_rejected() -> None:
    seen: set[str] = set()
    signed = worker().signed
    check(signed, seen=seen)

    with pytest.raises(ReleaseRefused, match="replayed"):
        check(signed, seen=seen)


def test_a_report_signed_by_another_key_or_altered_is_rejected() -> None:
    forged = worker(signer=Ed25519PrivateKey.generate()).signed
    honest = worker().signed
    altered = SignedReport(
        honest.report.__class__(
            **{**honest.report.__dict__, "image_digest": DIGEST.replace("a", "c")}
        ),
        honest.signature,
    )

    for signed in (forged, altered):
        with pytest.raises(ReleaseRefused, match="signed"):
            check(signed, allow=(DIGEST, DIGEST.replace("a", "c")))
    with pytest.raises(ReleaseRefused):
        SignedReport.from_json({"report": "nope", "signature": ""})


def test_wrapped_key_only_opens_with_matching_ephemeral_key() -> None:
    data_key, intended, other = new_key(), worker(), worker()
    context = release_context("u_margaret", "m_1", "file_claim", intended.signed.report.nonce)
    wrapped = wrap_for_worker(data_key, unb64(intended.signed.report.ephemeral_pub), context)
    state = seal(data_key, b"capsule", STATE_AAD)

    with pytest.raises(ReleaseRefused, match="wasn't released"):
        other.run_step(wrapped, context, state, STATE_AAD, lambda s: s)
    with pytest.raises(ReleaseRefused):  # the same worker, but another step's context
        worker().run_step(
            wrapped,
            release_context("u_margaret", "m_1", "accept_offer", "n"),
            state,
            STATE_AAD,
            lambda s: s,
        )
    out = intended.run_step(wrapped, context, state, STATE_AAD, lambda s: s + b" + filed")
    assert open_(data_key, out, STATE_AAD) == b"capsule + filed"


def test_a_worker_runs_one_step_then_forgets_its_key() -> None:
    data_key, w = new_key(), worker()
    context = release_context("u_margaret", "m_1", "step", w.signed.report.nonce)
    wrapped = wrap_for_worker(data_key, unb64(w.signed.report.ephemeral_pub), context)
    state = seal(data_key, b"x", STATE_AAD)
    w.run_step(wrapped, context, state, STATE_AAD, lambda s: s)

    with pytest.raises(ReleaseRefused, match="already run"):
        w.run_step(wrapped, context, state, STATE_AAD, lambda s: s)


def test_sign_report_is_over_the_canonical_form() -> None:
    signed = sign_report(worker().signed.report, DEPLOY)

    DEPLOY.public_key().verify(unb64(signed.signature), signed.report.canonical())
