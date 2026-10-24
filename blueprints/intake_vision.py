"""Intake Vision Agent Blueprint - Processes ticket photos, letters, bills into structured facts."""

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

INTAKE_VISION_BLUEPRINT = Blueprint(
    id="intake.vision",
    role="Multimodal intake agent: extracts structured facts from ticket photos, letters, bills, and screenshots with confidence scores and source spans.",
    version="1.0.0",
    description="Converts visual/PDF evidence into typed Facts for the Rights Engine. Uses Gemini 3.8 Flash for multimodal extraction.",
    model_policy=ModelPolicy(
        router=ModelRouter.FAST,
        prefer=["gemini-3.8-flash"],
        temperature=0.0,
        json_schema=True,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        ToolSpec(
            name="extract_facts",
            category=ToolCategory.READ_ONLY,
            description="Extract structured facts from an image or PDF with confidence scores",
        ),
        ToolSpec(
            name="ask_clarifying_question",
            category=ToolCategory.READ_ONLY,
            description="Ask the user one plain-language follow-up question for low-confidence fields",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["extract_facts", "ask_clarifying_question"],
        deny=["file_claim", "phone_company", "accept_offer", "move_money"],
        custom={
            "max_questions_per_mission": 2,
            "confidence_threshold": 0.8,
            "require_source_spans": True,
        },
    ),
    limits=LimitsConfig(
        max_tokens=2000,
        max_spend_gbp=0.10,
        max_user_questions=2,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1", required_fields=["facts", "confidence_scores", "source_spans"]
    ),
    evals=EvalSpec(
        suite="evals/intake_vision/",
        publish_threshold=0.95,
    ),
    metadata={
        "skill_packs": ["clawback-uk-rail", "clawback-ofcom", "clawback-uk261", "letter-explainer"],
        "input_modalities": ["image", "pdf", "screenshot"],
        "output_schema": "Fact[]",
    },
)
