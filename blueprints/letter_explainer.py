"""Letter Explainer Agent Blueprint - Explains official letters in plain language."""

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

LETTER_EXPLAINER_BLUEPRINT = Blueprint(
    id="letter.explainer",
    role="Letter explainer: reads any official letter (council, HMRC, DWP, energy, broadband) and gives a one-sentence summary, what to do, by when, in the user's language.",
    version="1.0.0",
    description="Accessibility-first letter explanation. Photo or forward → plain language summary → action items → reminders. Any language, voice or SMS.",
    model_policy=ModelPolicy(
        router=ModelRouter.FAST,
        prefer=["gemini-3.8-flash", "claude-haiku-5-5"],
        temperature=0.1,
    ),
    voice=VoiceConfig(
        persona="tempo",
        disclosure="none",
        language="auto",
        turn_taking_patience=2.0,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        STANDARD_TOOLS["explain_letter"],
        ToolSpec(
            name="extract_letter_facts",
            category=ToolCategory.READ_ONLY,
            description="Extract key facts from letter: sender, date, reference, deadlines, amounts",
        ),
        ToolSpec(
            name="translate_summary",
            category=ToolCategory.READ_ONLY,
            description="Translate explanation to user's language",
        ),
        ToolSpec(
            name="set_reminder",
            category=ToolCategory.BINDING,
            requires_consent=["track_deadline"],
            description="Set a reminder for a deadline from the letter",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["explain_letter", "extract_letter_facts", "translate_summary", "set_reminder"],
        deny=["file_claim", "phone_company", "accept_offer", "move_money", "give_legal_advice"],
        custom={
            "one_sentence_summary": True,
            "action_items_only": True,
            "deadline_prominence": True,
            "no_jargon": True,
            "any_language": True,
        },
    ),
    limits=LimitsConfig(
        max_tokens=2000,
        max_spend_gbp=0.05,
        max_user_questions=1,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["summary", "action_items", "deadlines", "language"],
    ),
    evals=EvalSpec(
        suite="evals/letter_explainer/",
        publish_threshold=0.95,
    ),
    metadata={
        "letter_types": [
            "council_tax",
            "hmrc",
            "dwp",
            "energy_bill",
            "broadband",
            "rail_compensation",
            "flight_delay",
            "parking_fine",
            "court_summons",
            "nhs_appointment",
        ],
        "output_formats": ["voice", "sms", "web", "email"],
        "languages": "auto-detect + 100+ supported",
    },
)
