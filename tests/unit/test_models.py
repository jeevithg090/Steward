from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from tempo_core.models import ContextCapsule, Fact, MissionState, ProofStep, ProofTrace

PII_KEYS = {"phone", "phone_number", "dob", "date_of_birth", "address", "postcode", "email"}


def typical_capsule() -> ContextCapsule:
    """Margaret's rail claim from spec §7.5."""
    return ContextCapsule(
        mission_id="m_8f2",
        goal="Recover Delay Repay for 1Y42 on 2026-10-23",
        display_name="Margaret",
        time_value_gbp_h=Decimal("18"),
        facts=(
            Fact(
                key="service",
                value="1Y42 Oxford→Paddington 08:12",
                source="ticket.jpg#ocr",
                confidence=0.97,
            ),
            Fact(
                key="arrival_delay_min",
                value=38,
                source="national_rail_hsp:RID:202610238123",
                confidence=1.0,
            ),
            Fact(key="fare_gbp", value=Decimal("28.40"), source="ticket.jpg#ocr", confidence=0.95),
            Fact(key="ticket_number", value="0812", source="ticket.jpg#ocr", confidence=0.9),
        ),
        proof_trace_id="pt_31c",
        consent_scopes=("file_claim", "phone_company"),
        do_not=("accept settlement below entitlement", "share date of birth"),
    )


@pytest.mark.parametrize("confidence", [-0.01, 1.01])
def test_fact_confidence_bounds(confidence: float) -> None:
    with pytest.raises(ValidationError):
        Fact(key="k", value="v", source="s", confidence=confidence)


def test_fact_requires_a_source() -> None:
    with pytest.raises(ValidationError):
        Fact(key="k", value="v", source="", confidence=1.0)


def test_proof_trace_requires_at_least_one_step() -> None:
    with pytest.raises(ValidationError):
        ProofTrace(id="pt_1", steps=(), amount_gbp=Decimal("1.00"))


def test_proof_trace_amount_cannot_be_negative() -> None:
    step = ProofStep(
        fact_keys=("k",), rule_id="r", rule_version="1", citation_url="https://x", explanation="e"
    )
    with pytest.raises(ValidationError):
        ProofTrace(id="pt_1", steps=(step,), amount_gbp=Decimal("-0.01"))


def test_capsule_roundtrip_json() -> None:
    capsule = typical_capsule()

    restored = ContextCapsule.model_validate_json(capsule.model_dump_json())

    assert restored == capsule
    values = {f.key: f.value for f in restored.facts}
    assert values["fare_gbp"] == Decimal("28.40")
    assert isinstance(values["fare_gbp"], Decimal)
    assert isinstance(values["arrival_delay_min"], int)
    assert values["ticket_number"] == "0812"  # numeric-looking strings stay strings


def test_capsule_size_under_4kb() -> None:
    assert len(typical_capsule().model_dump_json().encode()) < 4096


def _property_names(schema: Any) -> set[str]:
    names: set[str] = set()
    if isinstance(schema, dict):
        names |= set(schema.get("properties", {}))
        for value in schema.values():
            names |= _property_names(value)
    elif isinstance(schema, list):
        for value in schema:
            names |= _property_names(value)
    return names


def test_capsule_has_no_pii_fields() -> None:
    names = _property_names(ContextCapsule.model_json_schema())

    assert "facts" in names  # the walk reaches nested models
    assert names.isdisjoint(PII_KEYS)


def test_models_are_frozen() -> None:
    capsule = typical_capsule()
    with pytest.raises(ValidationError):
        capsule.goal = "something else"  # type: ignore[misc]


def test_mission_states_match_the_spec_lifecycle() -> None:
    assert {s.value for s in MissionState} == {
        "received", "understood", "planned", "appraised", "declined", "awaiting_consent",
        "running", "checkpoint", "waiting", "completed", "failed_safe", "verified",
    }  # fmt: skip
