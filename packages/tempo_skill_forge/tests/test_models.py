"""Tests for Skill Forge models."""

from datetime import datetime

import pytest
from tempo_skill_forge.models import (
    BudgetSpec,
    CapabilitySpec,
    ContextSpec,
    EvalSpec,
    FormalSpec,
    GenerationArtifact,
    GenerationStage,
    RetrievalSpec,
    RulePackSpec,
    SkillForgeState,
    SkillTier,
    TimeValueSpec,
    TriggerSpec,
)


def test_formal_spec_creation():
    """Test creating a valid FormalSpec."""
    spec = FormalSpec(
        id="test-skill",
        name="test-skill",
        description="Test skill",
        version="0.1.0",
        tier=SkillTier.COMMUNITY,
        triggers=[
            TriggerSpec(type="intent", examples=["test"]),
        ],
        capabilities=[
            CapabilitySpec(name="test.capability", requires_consent=["file_claim"]),
        ],
        forbidden=["money.move"],
        blueprints=["intake.vision", "rules.entitlement"],
        rule_packs=[
            RulePackSpec(id="test-pack", scheme="Test Scheme", citation_url="https://example.com"),
        ],
        context=ContextSpec(
            pin=["user.time_value"],
            retrieve=RetrievalSpec(provider="test", service="TEST"),
        ),
        budgets=BudgetSpec(max_llm_gbp=0.10),
        time_value=TimeValueSpec(est_user_minutes_saved=10),
        evals=EvalSpec(publish_threshold=0.95),
        created_at=datetime.utcnow(),
        created_by="user-123",
        source_narration="Test narration",
    )

    assert spec.id == "test-skill"
    assert spec.tier == SkillTier.COMMUNITY
    assert len(spec.triggers) == 1
    assert len(spec.capabilities) == 1
    assert "money.move" in spec.forbidden


def test_trigger_spec_types():
    """Test all trigger types."""
    intent_trigger = TriggerSpec(type="intent", examples=["claim refund"])
    event_trigger = TriggerSpec(type="event", source="rail.disruption")
    schedule_trigger = TriggerSpec(type="schedule", cron="0 9 * * 1")

    assert intent_trigger.type == "intent"
    assert event_trigger.source == "rail.disruption"
    assert schedule_trigger.cron == "0 9 * * 1"


def test_capability_spec_risk_levels():
    """Test capability risk levels."""
    low = CapabilitySpec(name="read.data", risk_level="low")
    medium = CapabilitySpec(name="net.api.test", risk_level="medium")
    high = CapabilitySpec(name="act.file_claim", risk_level="high")

    assert low.risk_level == "low"
    assert medium.risk_level == "medium"
    assert high.risk_level == "high"


def test_generation_stages():
    """Test generation stage enum."""
    assert GenerationStage.PENDING.value == "pending"
    assert GenerationStage.SPEC_GENERATED.value == "spec_generated"
    assert GenerationStage.CODE_GENERATED.value == "code_generated"
    assert GenerationStage.TESTS_GENERATED.value == "tests_generated"
    assert GenerationStage.EVAL_RUNNING.value == "eval_running"
    assert GenerationStage.EVAL_PASSED.value == "eval_passed"
    assert GenerationStage.EVAL_FAILED.value == "eval_failed"
    assert GenerationStage.PUBLISHED.value == "published"
    assert GenerationStage.REJECTED.value == "rejected"


def test_skill_forge_state():
    """Test SkillForgeState model."""
    state = SkillForgeState(
        skill_id="test-123",
        stage=GenerationStage.PENDING,
    )

    assert state.skill_id == "test-123"
    assert state.stage == GenerationStage.PENDING
    assert state.spec is None
    assert state.artifacts == []
    assert state.eval_results is None
    assert state.error is None


def test_generation_artifact():
    """Test GenerationArtifact model."""
    artifact = GenerationArtifact(
        id="art-1",
        skill_id="skill-1",
        stage=GenerationStage.CODE_GENERATED,
        artifact_type="manifest",
        content="test content",
        file_path="skills/test/skill.yaml",
        generated_at=datetime.utcnow(),
        generator_model="cortex:careful",
    )

    assert artifact.artifact_type == "manifest"
    assert artifact.file_path == "skills/test/skill.yaml"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
