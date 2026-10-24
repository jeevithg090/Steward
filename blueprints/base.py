"""Base classes for agent blueprints."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ModelRouter(str, Enum):
    """Model routing strategies."""

    AUTO = "auto"
    FAST = "fast"
    CAREFUL = "careful"
    JUROR = "juror"


@dataclass(frozen=True)
class ModelPolicy:
    """Model selection policy for an agent."""

    router: ModelRouter = ModelRouter.AUTO
    prefer: list[str] = field(default_factory=list)  # Specific model IDs to prefer
    fallback: str | None = None
    temperature: float = 0.0
    max_tokens: int | None = None
    json_schema: bool = False


@dataclass(frozen=True)
class VoiceConfig:
    """Voice configuration for voice-enabled agents."""

    provider: str = "elevenlabs"
    persona: str = "tempo"
    disclosure: str = "required"  # "required" | "optional" | "none"
    language: str = "en-GB"
    turn_taking_patience: float = 2.0  # seconds to wait for user


@dataclass(frozen=True)
class GuardrailConfig:
    """Guardrail configuration for an agent."""

    allow: list[str] = field(default_factory=list)
    deny: list[str] = field(default_factory=list)
    require_human: list[str] = field(default_factory=list)
    custom: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LimitsConfig:
    """Resource limits for an agent."""

    max_call_minutes: int = 30
    max_tokens: int = 4000
    max_spend_gbp: float = 0.50
    max_transfers: int = 4
    max_user_questions: int = 2
    timeout_seconds: int = 30


class ToolCategory(StrEnum):
    """Categories of tools for approval modes."""

    READ_ONLY = "read_only"
    BINDING = "binding"
    ADMIN = "admin"


@dataclass(frozen=True)
class ToolSpec:
    """Tool specification with approval requirements."""

    name: str
    category: ToolCategory = ToolCategory.READ_ONLY
    requires_consent: list[str] = field(default_factory=list)
    idempotent: bool = True
    description: str = ""


@dataclass(frozen=True)
class HandoffConfig:
    """Handoff configuration between agents."""

    emits: str = "context_capsule.v1"
    accepts: str = "context_capsule.v1"
    required_fields: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class EvalSpec:
    """Evaluation specification for an agent/blueprint."""

    suite: str = "evals/"
    publish_threshold: float = 0.95
    adversarial: bool = False


class Blueprint(BaseModel):
    """Agent blueprint - a reusable agent template."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    role: str
    version: str = "1.0.0"
    description: str = ""
    model_policy: ModelPolicy = Field(default_factory=ModelPolicy)
    voice: VoiceConfig | None = None
    tools_allowlist: list[ToolSpec] = Field(default_factory=list)
    guardrails: GuardrailConfig = Field(default_factory=GuardrailConfig)
    limits: LimitsConfig = Field(default_factory=LimitsConfig)
    handoff: HandoffConfig | None = None
    evals: EvalSpec = Field(default_factory=EvalSpec)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def to_agent_kwargs(self) -> dict[str, Any]:
        """Convert blueprint to MAF Agent constructor kwargs."""
        return {
            "name": self.id,
            "instructions": self._build_instructions(),
            "tools": [t.name for t in self.tools_allowlist],
            "model": self._resolve_model(),
        }

    def _build_instructions(self) -> str:
        """Build system instructions from blueprint."""
        parts = [f"Role: {self.role}", f"Version: {self.version}"]
        if self.voice:
            parts.append(f"Voice: {self.voice.persona} ({self.voice.provider})")
            parts.append(f"Disclosure: {self.voice.disclosure}")
        if self.guardrails.allow:
            parts.append(f"Allowed actions: {', '.join(self.guardrails.allow)}")
        if self.guardrails.deny:
            parts.append(f"Forbidden actions: {', '.join(self.guardrails.deny)}")
        if self.guardrails.require_human:
            parts.append(f"Requires human approval: {', '.join(self.guardrails.require_human)}")
        if self.limits:
            parts.append(
                f"Limits: {self.limits.max_call_minutes} min calls, £{self.limits.max_spend_gbp} max spend"
            )
        return "\n".join(parts)

    def _resolve_model(self) -> str:
        """Resolve model based on policy."""
        if self.model_policy.router == ModelRouter.AUTO:
            return "cortex:auto"
        return f"cortex:{self.model_policy.router.value}"


# Standard tool specifications
STANDARD_TOOLS = {
    "get_case_capsule": ToolSpec(
        name="get_case_capsule",
        category=ToolCategory.READ_ONLY,
        description="Retrieve the current case capsule with mission context",
    ),
    "log_stall": ToolSpec(
        name="log_stall",
        category=ToolCategory.READ_ONLY,
        description="Log a stalling tactic detected during a call",
    ),
    "record_reference": ToolSpec(
        name="record_reference",
        category=ToolCategory.BINDING,
        requires_consent=["file_claim"],
        description="Record a reference number from the company",
    ),
    "file_claim": ToolSpec(
        name="file_claim",
        category=ToolCategory.BINDING,
        requires_consent=["file_claim"],
        description="File a compensation claim with the company",
        idempotent=True,
    ),
    "phone_company": ToolSpec(
        name="phone_company",
        category=ToolCategory.BINDING,
        requires_consent=["phone_company", "ai_disclosure"],
        description="Initiate an outbound call to a company",
        idempotent=False,
    ),
    "accept_offer": ToolSpec(
        name="accept_offer",
        category=ToolCategory.BINDING,
        requires_consent=["accept_offer"],
        description="Accept a settlement offer from a company",
        idempotent=True,
    ),
    "request_human": ToolSpec(
        name="request_human",
        category=ToolCategory.BINDING,
        requires_consent=["phone_company"],
        description="Request transfer to a human operator",
    ),
    "get_service_delay": ToolSpec(
        name="get_service_delay",
        category=ToolCategory.READ_ONLY,
        description="Query rail service delay from National Rail HSP/RTT",
    ),
    "write_letter": ToolSpec(
        name="write_letter",
        category=ToolCategory.BINDING,
        requires_consent=["file_claim"],
        description="Draft and send a formal claim letter",
    ),
    "check_payment": ToolSpec(
        name="check_payment",
        category=ToolCategory.READ_ONLY,
        description="Verify if compensation payment has arrived",
    ),
    "explain_letter": ToolSpec(
        name="explain_letter",
        category=ToolCategory.READ_ONLY,
        description="Explain an official letter in plain language",
    ),
    "wait_on_hold": ToolSpec(
        name="wait_on_hold",
        category=ToolCategory.BINDING,
        requires_consent=["phone_company"],
        description="Wait on hold and notify when human answers",
    ),
    "check_scam": ToolSpec(
        name="check_scam",
        category=ToolCategory.READ_ONLY,
        description="Check a message or call for scam patterns",
    ),
    "fill_form": ToolSpec(
        name="fill_form",
        category=ToolCategory.BINDING,
        requires_consent=["file_claim"],
        description="Fill a form from known facts",
    ),
    "track_deadline": ToolSpec(
        name="track_deadline",
        category=ToolCategory.READ_ONLY,
        description="Track a renewal or claim deadline",
    ),
}
