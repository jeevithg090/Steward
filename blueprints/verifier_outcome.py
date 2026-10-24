"""Verifier Outcome Agent Blueprint - Verifies mission outcomes and updates ledger."""

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

VERIFIER_OUTCOME_BLUEPRINT = Blueprint(
    id="verifier.outcome",
    role="Outcome verifier: confirms mission completed successfully, updates Time Ledger, closes case, triggers Index update.",
    version="1.0.0",
    description="Final verification that compensation was paid, updates user's Time Ledger, feeds Time Theft Index with verified outcome.",
    model_policy=ModelPolicy(
        router=ModelRouter.FAST,
        prefer=["claude-haiku-5-5"],
        temperature=0.0,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        ToolSpec(
            name="verify_outcome",
            category=ToolCategory.READ_ONLY,
            description="Verify mission outcome against success criteria",
        ),
        ToolSpec(
            name="update_time_ledger",
            category=ToolCategory.BINDING,
            requires_consent=[],
            description="Update user's Time Ledger with minutes returned and £ recovered",
        ),
        ToolSpec(
            name="update_company_index",
            category=ToolCategory.BINDING,
            requires_consent=[],
            description="Update Time Theft Index with verified company event",
        ),
        ToolSpec(
            name="close_mission",
            category=ToolCategory.BINDING,
            requires_consent=[],
            description="Close the mission and archive case",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["verify_outcome", "update_time_ledger", "update_company_index", "close_mission"],
        deny=["file_claim", "phone_company", "accept_offer", "move_money"],
        custom={
            "verification_required": True,
            "ledger_update_atomic": True,
            "index_k_anonymity": 10,
        },
    ),
    limits=LimitsConfig(
        max_tokens=1500,
        max_spend_gbp=0.02,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["verified", "ledger_updated", "index_updated", "mission_closed"],
    ),
    evals=EvalSpec(
        suite="evals/verifier_outcome/",
        publish_threshold=0.98,
    ),
    metadata={
        "verification_sources": [
            "company_confirmation",
            "bank_credit",
            "bill_credit",
            "user_confirmation",
        ],
        "ledger_fields": ["minutes_lost", "minutes_returned", "gbp_recovered", "company", "date"],
        "index_fields": [
            "delay_min",
            "hold_min",
            "stalls_per_call",
            "days_to_pay",
            "rejection_rate",
        ],
    },
)
