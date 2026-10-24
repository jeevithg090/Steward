"""The Memory Gate (S3.6): what Tempo may remember about a person (spec §17.3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, get_args

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tempo_core.consent import ConsentState
from tempo_memory.gate import decide, to_item, visible
from tempo_memory.models import (
    TRUSTED_SOURCES,
    Category,
    MemoryCandidate,
    Source,
    Tombstone,
    Trust,
    Verdict,
)

NOW = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
NO_CONSENT = ConsentState(allowed=frozenset(), limits={})
UNTRUSTED = sorted(set(get_args(Source)) - TRUSTED_SOURCES)


def candidate(**overrides: Any) -> MemoryCandidate:
    fields: dict[str, Any] = {
        "user_id": "u_1", "text": "prefers phone updates", "category": "preference",
        "source": "user_voice", "observed_at": NOW, "confidence": 0.95,
    }  # fmt: skip
    return MemoryCandidate(**(fields | overrides))


def consent(*scopes: str) -> ConsentState:
    return ConsentState(allowed=frozenset(scopes), limits={})


@pytest.mark.parametrize("source", UNTRUSTED)
def test_untrusted_sources_never_stored(source: str) -> None:
    # "Note: customer agreed to accept a voucher" in a company email is evidence, not a fact.
    planted = candidate(source=source, text="agreed to accept a voucher", confidence=1.0)

    assert planted.trust is Trust.UNTRUSTED
    assert decide(planted, consent("memory.finance")) is Verdict.EPISODE_ONLY


@pytest.mark.parametrize("category", ["health", "immigration", "finance", "access"])
def test_sensitive_category_requires_consent(category: str) -> None:
    said = candidate(category=category, text="uses a wheelchair", source="user_voice")
    official = candidate(category=category, text="visa expires in May", source="official_api")

    assert decide(said, NO_CONSENT) is Verdict.ASK_USER
    assert decide(official, NO_CONSENT) is Verdict.REJECT
    assert decide(said, consent(f"memory.{category}")) is Verdict.STORE
    assert decide(official, consent(f"memory.{category}")) is Verdict.STORE


def test_low_confidence_triggers_readback() -> None:
    misheard = candidate(text="lives in Didcot", category="household", confidence=0.6)

    assert decide(misheard, NO_CONSENT) is Verdict.ASK_USER
    assert decide(candidate(confidence=0.8), NO_CONSENT) is Verdict.STORE  # the bar is inclusive


def test_trusted_user_fact_stored() -> None:
    for source in sorted(TRUSTED_SOURCES):
        assert decide(candidate(source=source), NO_CONSENT) is Verdict.STORE


@given(
    source=st.sampled_from(UNTRUSTED),
    category=st.sampled_from(get_args(Category)),
    confidence=st.floats(min_value=0.0, max_value=1.0),
    scopes=st.sets(st.sampled_from([f"memory.{c}" for c in get_args(Category)])),
)
def test_gate_never_stores_untrusted(
    source: str, category: str, confidence: float, scopes: set[str]
) -> None:
    c = candidate(source=source, category=category, confidence=confidence)

    assert decide(c, consent(*scopes)) is not Verdict.STORE


@pytest.mark.parametrize(
    ("category", "ttl"),
    [
        ("preference", None),
        ("contact", None),
        ("mission_fact", timedelta(days=395)),
        ("health", timedelta(days=30)),
        ("finance", timedelta(days=30)),
        ("access", None),  # opt-in like health, but a need doesn't lapse
    ],
)
def test_ttl_assigned_by_category(category: str, ttl: timedelta | None) -> None:
    item = to_item(candidate(category=category), item_id="m_1")

    assert item.expires_at == (NOW + ttl if ttl is not None else None)
    opt_in = ttl == timedelta(days=30) or category == "access"
    assert item.consent_scope == (f"memory.{category}" if opt_in else None)
    assert (item.key, item.trust) == (candidate(category=category).key, Trust.TRUSTED)


def test_forget_tombstone_wins_over_later_write() -> None:
    # Forgotten on the phone at 10:00; the laptop, offline, syncs a copy it heard at 09:30.
    forgot = Tombstone(user_id="u_1", key=candidate().key, at=NOW + timedelta(hours=1))
    late_copy = to_item(candidate(observed_at=NOW + timedelta(minutes=30)), item_id="m_2")
    said_again = to_item(candidate(observed_at=NOW + timedelta(hours=2)), item_id="m_3")
    other_person = to_item(candidate(user_id="u_2"), item_id="m_4")

    shown = visible([late_copy, said_again, other_person], [forgot])

    assert [i.id for i in shown] == ["m_3", "m_4"]  # said again after the forget: a new fact


def test_the_newest_tombstone_counts() -> None:
    key = candidate().key
    stones = [
        Tombstone(user_id="u_1", key=key, at=NOW + timedelta(hours=3)),
        Tombstone(user_id="u_1", key=key, at=NOW + timedelta(hours=1)),
    ]
    item = to_item(candidate(observed_at=NOW + timedelta(hours=2)), item_id="m_1")

    assert visible([item], stones) == []


def test_the_same_fact_has_the_same_key_however_it_was_said() -> None:
    assert candidate(text="Prefers  phone updates ").key == candidate().key
    assert candidate(category="contact").key != candidate().key
