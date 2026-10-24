"""Which workflow runs a mission: one engine per skill, chosen from the mission's stored skill id.

Each skill has its own workflow, checkpoint types and start/resume functions, so an answer, a
timer or a restart always reaches the right one.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agent_framework import CheckpointStorage, FileCheckpointStorage, Workflow

from tempo_missions import clawback_ofcom as ofcom
from tempo_missions import clawback_rail as rail

RAIL = "clawback.uk-rail-delay-repay"
OFCOM = "clawback.ofcom-missed-appointment"

Responses = Mapping[str, rail.SignedApproval | rail.TimerFired] | None


@dataclass(frozen=True)
class Engine:
    build: Callable[[rail.ClawbackDeps, CheckpointStorage], Workflow]
    storage: Callable[[Path], FileCheckpointStorage]
    start: Callable[[Workflow, Any], Awaitable[rail.RunResult]]
    resume: Callable[[Workflow, CheckpointStorage, Responses], Awaitable[rail.RunResult]]


def _rail_resume(
    w: Workflow, s: CheckpointStorage, r: Responses = None
) -> Awaitable[rail.RunResult]:
    return rail.resume(w, s, r)


ENGINES: dict[str, Engine] = {
    RAIL: Engine(rail.build_clawback_workflow, rail.checkpoint_storage, rail.start, _rail_resume),
    OFCOM: Engine(ofcom.build_ofcom_workflow, ofcom.checkpoint_storage, ofcom.start, ofcom.resume),
}
