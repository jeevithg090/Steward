"""One audit record per policy decision, whichever enforcement implementation made it."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class AuditRecord:
    point: str  # pre_tool_call | post_tool_call | output
    tool: str | None
    decision: str  # allow | deny | escalate | transform
    reason: str | None
    enforced: bool  # False in evaluate-only mode


AuditSink = Callable[[AuditRecord], None]
