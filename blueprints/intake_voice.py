"""Intake Voice Agent Blueprint - Handles inbound voice calls, extracts facts from speech."""

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
    VoiceConfig,
)

INTAKE_VOICE_BLUEPRINT = Blueprint(
    id="intake.voice",
    role="Inbound voice intake agent: listens to user's spoken problem, extracts facts, asks at most 2 clarifying questions, and builds the initial case capsule.",
    version="1.0.0",
    description="The friendly voice of Tempo on inbound calls. Handles any language, stammer-friendly pacing, never rushes.",
    model_policy=ModelPolicy(
        router=ModelRouter.CAREFUL,
        prefer=["claude-sonnet-5-5"],
        temperature=0.2,
    ),
    voice=VoiceConfig(
        persona="tempo",
        disclosure="required",
        language="auto",
        turn_taking_patience=3.0,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        STANDARD_TOOLS["record_consent"],
        ToolSpec(
            name="create_mission",
            category=ToolCategory.BINDING,
            requires_consent=["file_claim"],
            description="Create a new mission from the user's spoken facts",
        ),
        ToolSpec(
            name="lookup_journey",
            category=ToolCategory.READ_ONLY,
            description="Look up a registered journey by description",
        ),
        ToolSpec(
            name="ask_clarifying_question",
            category=ToolCategory.READ_ONLY,
            description="Ask one plain-language follow-up question",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["create_mission", "lookup_journey", "ask_clarifying_question", "record_consent"],
        deny=["file_claim", "phone_company", "accept_offer", "move_money", "collect_credentials"],
        custom={
            "one_question_at_a_time": True,
            "read_back_confirmation": True,
            "no_jargon": True,
            "stammer_friendly": True,
            "max_questions": 2,
        },
    ),
    limits=LimitsConfig(
        max_call_minutes=10,
        max_tokens=3000,
        max_spend_gbp=0.15,
        max_user_questions=2,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["goal", "facts", "language", "time_value_gbp_h"],
    ),
    evals=EvalSpec(
        suite="evals/intake_voice/",
        publish_threshold=0.95,
    ),
    metadata={
        "channels": ["phone", "landline", "voip"],
        "languages": ["auto-detect", "en-GB", "hi-IN", "cy-GB", "gd-GB"],
        "accessibility": ["stammer_friendly", "no_timeout", "read_back"],
    },
)
