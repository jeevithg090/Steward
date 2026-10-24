"""Scam Shield Agent Blueprint - Detects scam patterns in messages and calls."""

from ..base import (
    STANDARD_TOOLS,
    Blueprint,
    EvalSpec,
    GuardrailConfig,
    HandoffConfig,
    LimitsConfig,
    ModelPolicy,
    ModelRouter,
    ToolCategory,
    ToolSpec,
)

SCAM_SHIELD_BLUEPRINT = Blueprint(
    id="scam_shield",
    role="Scam detector: checks messages, calls, emails for scam patterns (APP fraud, phishing, smishing). Warns user and family helper. Safe word verification.",
    version="1.0.0",
    description="Real-time scam detection. Analyzes urgency language, 'move money' coaching, fake authority, spoofed numbers. Alerts user + helper. Never asks for credentials.",
    model_policy=ModelPolicy(
        router=ModelRouter.CAREFUL,
        prefer=["claude-sonnet-5-5", "llama4-maverick"],
        temperature=0.0,
    ),
    voice=VoiceConfig(
        persona="tempo",
        disclosure="required",
        language="auto",
        turn_taking_patience=2.0,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        STANDARD_TOOLS["check_scam"],
        ToolSpec(
            name="analyze_message",
            category=ToolCategory.READ_ONLY,
            description="Analyze a message (SMS, email, WhatsApp) for scam indicators",
        ),
        ToolSpec(
            name="analyze_call_transcript",
            category=ToolCategory.READ_ONLY,
            description="Analyze a call transcript for scam coaching patterns",
        ),
        ToolSpec(
            name="verify_safe_word",
            category=ToolCategory.READ_ONLY,
            description="Verify the user's safe word on an inbound call",
        ),
        ToolSpec(
            name="alert_helper",
            category=ToolCategory.BINDING,
            requires_consent=["share_with_helper"],
            description="Send scam alert to family helper",
        ),
        ToolSpec(
            name="block_sender",
            category=ToolCategory.BINDING,
            requires_consent=["file_claim"],
            description="Block a sender at the mesh level",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=[
            "check_scam",
            "analyze_message",
            "analyze_call_transcript",
            "verify_safe_word",
            "alert_helper",
            "block_sender",
        ],
        deny=["move_money", "collect_credentials", "ask_for_pin", "ask_for_password", "file_claim"],
        require_human=["uncertain_scam"],
        custom={
            "scam_categories": [
                "app_fraud_coaching",
                "fake_authority",
                "urgency_pressure",
                "move_money_safe_account",
                "credential_harvesting",
                "remote_access_request",
                "gift_card_payment",
            ],
            "safe_word_required_inbound": True,
            "helper_alert_opt_in": True,
            "never_asks_credentials": True,
        },
    ),
    limits=LimitsConfig(
        max_tokens=2500,
        max_spend_gbp=0.05,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["risk_score", "categories", "action_taken", "helper_alerted"],
    ),
    evals=EvalSpec(
        suite="evals/scam_shield/",
        publish_threshold=0.98,
        adversarial=True,
    ),
    metadata={
        "detection_methods": ["pattern_matching", "llm_analysis", "consensus_court"],
        "consensus_models": 3,
        "uk_finance_app_fraud_2025": 576_400_000,
        "integration": "on-device signal filter + cloud analysis",
    },
)
