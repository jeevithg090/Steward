"""Writer Claim Agent Blueprint - Drafts claim letters and formal communications."""

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

WRITER_CLAIM_BLUEPRINT = Blueprint(
    id="writer.claim",
    role="Claim letter writer: drafts formal claim/complaint letters using Proof Trace citations. User approves in one tap.",
    version="1.0.0",
    description="Generates clear, cited claim letters from the Proof Trace. Plain language, one-page, includes all evidence references.",
    model_policy=ModelPolicy(
        router=ModelRouter.FAST,
        prefer=["claude-haiku-5-5"],
        temperature=0.1,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        STANDARD_TOOLS["write_letter"],
        ToolSpec(
            name="draft_claim_letter",
            category=ToolCategory.READ_ONLY,
            description="Draft a claim letter from Proof Trace and case facts",
        ),
        ToolSpec(
            name="format_time_invoice",
            category=ToolCategory.READ_ONLY,
            description="Format a Time Invoice as an attachment to the claim",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["draft_claim_letter", "write_letter", "format_time_invoice"],
        deny=["file_claim", "phone_company", "accept_offer", "move_money"],
        custom={
            "user_approval_required": True,
            "include_proof_trace_citations": True,
            "include_time_invoice": True,
            "max_pages": 1,
            "plain_language": True,
        },
    ),
    limits=LimitsConfig(
        max_tokens=2000,
        max_spend_gbp=0.05,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["letter_draft", "letter_id", "proof_trace_refs"],
    ),
    evals=EvalSpec(
        suite="evals/writer_claim/",
        publish_threshold=0.95,
    ),
    metadata={
        "output_formats": ["pdf", "html", "plain_text", "email"],
        "attachments": ["proof_trace.pdf", "time_invoice.pdf", "evidence.pdf"],
        "languages": ["en-GB", "auto-translate"],
    },
)
