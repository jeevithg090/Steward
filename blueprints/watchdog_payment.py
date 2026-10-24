"""Watchdog Payment Agent Blueprint - Verifies 'automatic' compensation actually arrives."""

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

WATCHDOG_PAYMENT_BLUEPRINT = Blueprint(
    id="watchdog.payment",
    role="Payment watchdog: calculates what's due from rule packs, checks it landed on the bill, chases if missing, generates regulator packs for systemic failures.",
    version="1.0.0",
    description="Verifies automatic compensation (Ofcom, Ofgem) actually arrives. Uses bill photo OCR or open banking to confirm credits. Escalates missing payments.",
    model_policy=ModelPolicy(
        router=ModelRouter.CAREFUL,
        prefer=["claude-sonnet-5-5"],
        temperature=0.0,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        STANDARD_TOOLS["check_payment"],
        ToolSpec(
            name="calculate_due",
            category=ToolCategory.READ_ONLY,
            description="Calculate expected compensation from rule pack and event details",
        ),
        ToolSpec(
            name="read_bill_photo",
            category=ToolCategory.READ_ONLY,
            description="Extract payment credits from a bill photo using vision",
        ),
        ToolSpec(
            name="schedule_check",
            category=ToolCategory.READ_ONLY,
            description="Schedule a future payment verification check",
        ),
        ToolSpec(
            name="escalate_missing",
            category=ToolCategory.BINDING,
            requires_consent=["file_claim", "phone_company"],
            description="Escalate a missing automatic payment",
        ),
        ToolSpec(
            name="generate_regulator_pack",
            category=ToolCategory.BINDING,
            requires_consent=["share_with_helper"],
            description="Generate anonymised regulator-ready evidence pack",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=[
            "calculate_due",
            "check_payment",
            "read_bill_photo",
            "schedule_check",
            "escalate_missing",
            "generate_regulator_pack",
        ],
        deny=["move_money", "collect_credentials"],
        require_human=["regulator_pack_publication"],
        custom={
            "verify_automatic_only": True,
            "k_anonymity_threshold": 10,
            "bill_photo_required": True,
        },
    ),
    limits=LimitsConfig(
        max_tokens=3000,
        max_spend_gbp=0.10,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["payment_verified", "amount_confirmed", "escalation_started"],
    ),
    evals=EvalSpec(
        suite="evals/watchdog_payment/",
        publish_threshold=0.95,
    ),
    metadata={
        "schemes_monitored": [
            "ofcom-missed-appointment",
            "ofcom-repair-delay",
            "ofgem-missed-appointment",
            "delay-repay-auto",
        ],
        "verification_methods": ["bill_photo_ocr", "open_banking", "user_confirmation"],
        "outputs": ["payment_confirmed", "escalation_case", "regulator_pack"],
    },
)
