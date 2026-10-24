"""Form Buddy Agent Blueprint - Fills forms from known facts, user approves before sending."""

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

FORM_BUDDY_BLUEPRINT = Blueprint(
    id="form_buddy",
    role="Form filler: fills official forms (council tax reduction, benefit claims, compensation forms) from facts the user already gave. User approves before anything is sent.",
    version="1.0.0",
    description="Eliminates form-filling friction. Maps user facts to form fields. Shows filled form for approval. Submits only with consent. Supports PDF, web forms, government portals.",
    model_policy=ModelPolicy(
        router=ModelRouter.FAST,
        prefer=["claude-haiku-5-5"],
        temperature=0.1,
    ),
    tools_allowlist=[
        STANDARD_TOOLS["get_case_capsule"],
        STANDARD_TOOLS["fill_form"],
        ToolSpec(
            name="map_facts_to_form",
            category=ToolCategory.READ_ONLY,
            description="Map user facts to form field schema",
        ),
        ToolSpec(
            name="render_filled_form",
            category=ToolCategory.READ_ONLY,
            description="Render the filled form for user review (PDF/HTML)",
        ),
        ToolSpec(
            name="submit_form",
            category=ToolCategory.BINDING,
            requires_consent=["file_claim"],
            description="Submit the approved form to the target portal",
        ),
        ToolSpec(
            name="save_draft",
            category=ToolCategory.BINDING,
            requires_consent=[],
            description="Save form draft for later completion",
        ),
    ],
    guardrails=GuardrailConfig(
        allow=["fill_form", "map_facts_to_form", "render_filled_form", "submit_form", "save_draft"],
        deny=["move_money", "collect_credentials", "file_claim_without_approval"],
        require_human=["submit_form"],
        custom={
            "approval_required": True,
            "show_all_fields": True,
            "highlight_mapped_fields": True,
            "no_auto_submit": True,
            "support_gov_uk_forms": True,
        },
    ),
    limits=LimitsConfig(
        max_tokens=3000,
        max_spend_gbp=0.10,
    ),
    handoff=HandoffConfig(
        emits="context_capsule.v1",
        required_fields=["form_id", "fields_filled", "submitted", "reference"],
    ),
    evals=EvalSpec(
        suite="evals/form_buddy/",
        publish_threshold=0.95,
    ),
    metadata={
        "form_types": [
            "council_tax_reduction",
            "universal_credit",
            "pip",
            "attendance_allowance",
            "delay_repay_claim",
            "ofcom_compensation",
            "flight_compensation",
            "parking_appeal",
            "consumer_complaint",
        ],
        "portals": ["gov.uk", "local_council", "hmrc", "dwc", "rail_operators"],
        "output": "filled_pdf | web_form_submission | draft_save",
    },
)
