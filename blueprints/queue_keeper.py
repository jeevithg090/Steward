"""Queue Keeper Agent Blueprint - Waits on hold and notifies when human answers."""

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

QUEUE_KEEPER_BLUEPRINT = Blueprint(
    id="queue_keeper",
    role="Queue keeper: waits on any helpline (HMRC, council, GP, energy) and rings the user (or patches them in) when a human answers. Logs hold time for Time Invoice.",
    version="1.0.0",
    description="Holds the line so the user doesn't have to. Detects human answer vs IVR/hold music. Rings user's best device (Mesh). Logs every minute of hold time.",
    model_policy=ModelPolicy(
        router=ModelRouter.CAREFUL,
        prefer=["claude-sonnet-5-5"],
        temperature=0.0,
    ),
    voice=VoiceConfig(
        persona="tempo",
        disclosure="required",
        language="en-GB",
        turn_taking_patience=5.0,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        STANDARD_TOOLS["wait_on_hold"],
        STANDARD_TOOLS["phone_company"],
        STANDARD_TOOLS["log_stall"],
        ToolSpec(
            name="detect_human_answer",
            category=ToolCategory.READ_ONLY,
            description="Detect when a human answers the call",
        ),
        ToolSpec(
            name="notify_user",
            category=ToolCategory.BINDING,
            requires_consent=["phone_company"],
            description="Ring or message the user that a human has answered",
        ),
        ToolSpec(
            name="warm_handoff",
            category=ToolCategory.BINDING,
            requires_consent=["phone_company"],
            description="Patch the user into the live call",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["wait_on_hold", "detect_human_answer", "notify_user", "warm_handoff", "log_stall"],
        deny=[
            "file_claim",
            "accept_offer",
            "move_money",
            "collect_credentials",
            "give_legal_advice",
        ],
        custom={
            "max_hold_minutes": 60,
            "log_hold_time": True,
            "notify_on_answer": True,
            "warm_handoff_default": True,
            "skip_turn_on_hold": True,
        },
    ),
    limits=LimitsConfig(
        max_call_minutes=60,
        max_tokens=2000,
        max_spend_gbp=0.30,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["hold_minutes", "human_answered", "user_notified", "patched_in"],
    ),
    evals=EvalSpec(
        suite="evals/queue_keeper/",
        publish_threshold=0.90,
        adversarial=True,
    ),
    metadata={
        "target_helplines": [
            "hmrc",
            "dwc",
            "council",
            "gp",
            "energy",
            "broadband",
            "water",
            "rail",
        ],
        "avg_hold_times": {"hmrc": 23, "dwc": 18, "council": 15, "gp": 12},
        "mesh_integration": "routes notification to best device via Device Router",
    },
)
