"""Rules Entitlement Agent Blueprint - Deterministic rights engine with proof traces."""

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

RULES_ENTITLEMENT_BLUEPRINT = Blueprint(
    id="rules.entitlement",
    role="Deterministic rights engine: evaluates rule packs against facts to produce entitlement amount and Proof Trace. No LLM involved in money decisions.",
    version="1.0.0",
    description="Pure code evaluation of versioned rule packs (Delay Repay, Ofcom, Ofgem, UK261). Produces auditable Proof Trace: fact → rule → clause → amount.",
    model_policy=ModelPolicy(
        router=ModelRouter.FAST,
        prefer=["none"],  # No LLM - pure Python evaluator
        temperature=0.0,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        ToolSpec(
            name="evaluate_rule_pack",
            category=ToolCategory.READ_ONLY,
            description="Evaluate a rule pack against case facts, return Entitlement + ProofTrace",
        ),
        ToolSpec(
            name="load_rule_pack",
            category=ToolCategory.READ_ONLY,
            description="Load a versioned rule pack by operator and scheme",
        ),
        ToolSpec(
            name="list_applicable_packs",
            category=ToolCategory.READ_ONLY,
            description="List all rule packs applicable to the case type",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["evaluate_rule_pack", "load_rule_pack", "list_applicable_packs"],
        deny=["file_claim", "phone_company", "accept_offer", "move_money", "llm_call"],
        custom={
            "deterministic_only": True,
            "proof_trace_required": True,
            "version_pinned": True,
            "citation_required": True,
        },
    ),
    limits=LimitsConfig(
        max_tokens=1000,
        max_spend_gbp=0.01,
        timeout_seconds=5,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["entitlement_gbp", "proof_trace_id", "rule_pack_id", "rule_version"],
    ),
    evals=EvalSpec(
        suite="evals/rules_entitlement/",
        publish_threshold=1.0,  # Must be 100% accurate
    ),
    metadata={
        "rule_packs": [
            "delay-repay-gwr",
            "delay-repay-chiltern",
            "delay-repay-crosscountry",
            "ofcom-missed-appointment",
            "ofcom-repair-delay",
            "ofgem-missed-appointment",
            "uk261-flight-delay",
        ],
        "output": "Entitlement | NotEligible + ProofTrace",
        "audit": "every decision logged with rule version and citation",
    },
)
