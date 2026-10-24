"""Tempo Agent Blueprints - Reusable agent templates for the Conductor."""

from .arbiter import ARBITER_BLUEPRINT
from .base import Blueprint, GuardrailConfig, LimitsConfig, ModelPolicy, VoiceConfig
from .consensus_court import CONSENSUS_COURT_BLUEPRINT
from .consent_executor import CONSENT_EXECUTOR_BLUEPRINT
from .deadline_keeper import DEADLINE_KEEPER_BLUEPRINT
from .form_buddy import FORM_BUDDY_BLUEPRINT
from .intake_vision import INTAKE_VISION_BLUEPRINT
from .intake_voice import INTAKE_VOICE_BLUEPRINT
from .letter_explainer import LETTER_EXPLAINER_BLUEPRINT
from .negotiator_voice import NEGOTIATOR_VOICE_BLUEPRINT
from .queue_keeper import QUEUE_KEEPER_BLUEPRINT
from .rules_entitlement import RULES_ENTITLEMENT_BLUEPRINT
from .scam_shield import SCAM_SHIELD_BLUEPRINT
from .verifier_outcome import VERIFIER_OUTCOME_BLUEPRINT
from .watchdog_payment import WATCHDOG_PAYMENT_BLUEPRINT
from .writer_claim import WRITER_CLAIM_BLUEPRINT

__all__ = [
    "ARBITER_BLUEPRINT",
    "CONSENSUS_COURT_BLUEPRINT",
    "CONSENT_EXECUTOR_BLUEPRINT",
    "DEADLINE_KEEPER_BLUEPRINT",
    "FORM_BUDDY_BLUEPRINT",
    "INTAKE_VISION_BLUEPRINT",
    "INTAKE_VOICE_BLUEPRINT",
    "LETTER_EXPLAINER_BLUEPRINT",
    "NEGOTIATOR_VOICE_BLUEPRINT",
    "QUEUE_KEEPER_BLUEPRINT",
    "RULES_ENTITLEMENT_BLUEPRINT",
    "SCAM_SHIELD_BLUEPRINT",
    "VERIFIER_OUTCOME_BLUEPRINT",
    "WATCHDOG_PAYMENT_BLUEPRINT",
    "WRITER_CLAIM_BLUEPRINT",
    "Blueprint",
    "GuardrailConfig",
    "LimitsConfig",
    "ModelPolicy",
    "VoiceConfig",
]

BLUEPRINT_REGISTRY = {
    "intake.vision": INTAKE_VISION_BLUEPRINT,
    "intake.voice": INTAKE_VOICE_BLUEPRINT,
    "rules.entitlement": RULES_ENTITLEMENT_BLUEPRINT,
    "writer.claim": WRITER_CLAIM_BLUEPRINT,
    "negotiator.voice": NEGOTIATOR_VOICE_BLUEPRINT,
    "watchdog.payment": WATCHDOG_PAYMENT_BLUEPRINT,
    "verifier.outcome": VERIFIER_OUTCOME_BLUEPRINT,
    "letter.explainer": LETTER_EXPLAINER_BLUEPRINT,
    "queue_keeper": QUEUE_KEEPER_BLUEPRINT,
    "scam_shield": SCAM_SHIELD_BLUEPRINT,
    "form_buddy": FORM_BUDDY_BLUEPRINT,
    "deadline_keeper": DEADLINE_KEEPER_BLUEPRINT,
    "consensus_court": CONSENSUS_COURT_BLUEPRINT,
    "arbiter": ARBITER_BLUEPRINT,
    "consent": CONSENT_EXECUTOR_BLUEPRINT,
}


def get_blueprint(blueprint_id: str) -> Blueprint:
    """Get a blueprint by ID."""
    if blueprint_id not in BLUEPRINT_REGISTRY:
        raise ValueError(f"Unknown blueprint: {blueprint_id}")
    return BLUEPRINT_REGISTRY[blueprint_id]


def list_blueprints() -> list[str]:
    """List all available blueprint IDs."""
    return list(BLUEPRINT_REGISTRY.keys())
