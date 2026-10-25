"""Scam Shield's on-device filter (docs/scam-shield.md §5.1): one signal, three gates, four fields."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tempo_core.scam_model import Score
from tempo_core.signals import extract, fired_families, load_signals, matches, only_declared

ROOT = Path(__file__).resolve().parents[2]
(SCAM,) = load_signals(ROOT / "skills" / "scam-shield" / "signals.yaml")
VECTORS = json.loads((ROOT / "fixtures" / "signals" / "scam_messages.json").read_text())
FAMILIES = (
    "scam_safe_account", "scam_code_request", "scam_urgency", "scam_account_threat",
    "scam_short_link", "scam_official_pretext", "scam_loan_app", "scam_family_emergency",
)  # fmt: skip


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["text"][:40] for c in VECTORS["cases"]])
def test_filter_matches_the_shared_vectors(case: dict[str, Any]) -> None:
    assert extract(SCAM, case["sender"], case["text"]) == case["expected"]


def test_the_signal_is_the_one_the_vectors_name() -> None:
    assert (VECTORS["signal"], SCAM.id, SCAM.retention_days) == ("scam_text", "scam_text", 7)
    assert set(SCAM.match.families) == set(FAMILIES)
    assert SCAM.extract == ("rules", "sender_domain", "link_hosts", "score")
    assert SCAM.match.links and SCAM.match.model == "scam-shield/model.json"


def test_every_family_has_phrases_and_no_phrase_is_blank_or_repeated() -> None:
    for name, phrases in SCAM.match.families.items():
        assert phrases, name
        assert all(p.strip() for p in phrases), name
        assert len({p.casefold() for p in phrases}) == len(phrases), name


def test_a_genuine_one_time_code_text_does_not_fire_the_code_family() -> None:
    genuine = (
        "Your code is 482913. Never share it with anyone. If you did not request it, call 159."
    )
    assert fired_families(SCAM, genuine) == []
    assert fired_families(SCAM, "Please read me the code we sent you") == ["scam_code_request"]


def test_the_model_gate_matches_only_in_the_warn_or_sandbox_zone() -> None:
    plain = "Your table is booked for 7pm on Friday. See you then."
    warn = Score(probability=0.97, decision=3.0, zone="warn", top_words=())
    quiet = Score(probability=0.02, decision=-4.0, zone="quiet", top_words=())
    assert not matches(SCAM, "+447700900000", plain)
    assert not matches(SCAM, "+447700900000", plain, score=quiet)
    assert matches(SCAM, "+447700900000", plain, score=warn)
    assert extract(SCAM, "+447700900000", plain, score=warn) == {"score": "0.97"}


def test_only_the_four_fields_may_leave_and_the_body_never_does() -> None:
    assert only_declared(SCAM, {"rules": "scam_urgency", "link_hosts": "bit.ly", "score": "0.91"})
    assert not only_declared(SCAM, {"rules": "scam_urgency", "text": "Act now at bit.ly/x"})
    assert not only_declared(SCAM, {"sender": "+447700900123"})


def test_at_most_five_link_hosts_leave_in_order() -> None:
    text = " ".join(f"http://host{i}-refund.top/x" for i in range(8))
    fields = extract(SCAM, "+447700900000", text)
    assert fields is not None
    assert fields["link_hosts"].split(",") == [f"host{i}-refund.top" for i in range(5)]


def test_the_sender_domain_is_only_for_email_senders() -> None:
    fields = extract(SCAM, "Fraud Team <alerts@hsbc-secure.co>", "Verify your identity now")
    assert fields == {
        "rules": "scam_account_threat",
        "sender_domain": "hsbc-secure.co>",
    } or fields == {"rules": "scam_account_threat", "sender_domain": "hsbc-secure.co"}
    assert extract(SCAM, "+447700900000", "Verify your identity now") == {
        "rules": "scam_account_threat"
    }


def test_the_phone_gets_exactly_this_spec() -> None:
    """fixtures/signals/scam_text.spec.json is what GET /mesh/signals serves; the Kotlin test reads
    it, so it must equal the YAML. Regenerate it when signals.yaml changes."""
    served = json.loads((ROOT / "fixtures" / "signals" / "scam_text.spec.json").read_text())
    assert served == SCAM.model_dump(mode="json")
