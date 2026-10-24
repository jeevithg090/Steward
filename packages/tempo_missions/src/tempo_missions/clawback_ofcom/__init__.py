"""Clawback Ofcom: a missed engineer visit, with Rights Decay deciding when to act (build plan R4).

    intake -> rights -> court -> plan -> consent -> decide (wait / re-plan, durable timers)
        -> action -> watchdog (until paid) -> ledger

Run by the Gateway like the rail mission: `start`, then `resume` with an answer or a timer.
Checkpoints carry everything, so a restart mid-wait asks nothing again and loses nothing.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from agent_framework import CheckpointStorage, FileCheckpointStorage, Workflow, WorkflowBuilder

from tempo_missions.clawback_ofcom.act import Action, Consent, Decide
from tempo_missions.clawback_ofcom.assess import Appraise, Court, Intake, Rights
from tempo_missions.clawback_ofcom.messages import CHECKPOINT_TYPES, OfcomCase, OfcomRequest
from tempo_missions.clawback_ofcom.watchdog import Ledger, PaymentWatchdog
from tempo_missions.clawback_rail import RunResult
from tempo_missions.clawback_rail import _collect as collect
from tempo_missions.clawback_rail.base import ClawbackDeps
from tempo_missions.clawback_rail.messages import SignedApproval, TimerFired

WORKFLOW_NAME = "clawback-ofcom"  # stable, or checkpoints can't be found after a restart

__all__ = [
    "WORKFLOW_NAME",
    "OfcomCase",
    "OfcomRequest",
    "build_ofcom_workflow",
    "checkpoint_storage",
    "resume",
    "start",
]


def checkpoint_storage(directory: Path) -> FileCheckpointStorage:
    """Checkpoints are a trust boundary: only the mission's own message types may be restored."""
    return FileCheckpointStorage(str(directory), allowed_checkpoint_types=CHECKPOINT_TYPES)


def build_ofcom_workflow(deps: ClawbackDeps, storage: CheckpointStorage) -> Workflow:
    steps = [
        Intake(deps), Rights(deps), Court(deps), Appraise(deps), Consent(deps), Decide(deps),
        Action(deps), PaymentWatchdog(deps), Ledger(deps),
    ]  # fmt: skip
    return (
        WorkflowBuilder(
            name=WORKFLOW_NAME,
            start_executor=steps[0],
            checkpoint_storage=storage,
            output_from="all",
        )
        .add_chain(steps)
        .build()
    )


async def start(workflow: Workflow, request: OfcomRequest) -> RunResult:
    return await collect(workflow.run(request, stream=True))


async def resume(
    workflow: Workflow,
    storage: CheckpointStorage,
    responses: Mapping[str, SignedApproval | TimerFired] | None = None,
) -> RunResult:
    """Continue from the latest checkpoint; without responses, re-emit what it waits on."""
    latest = await storage.get_latest(workflow_name=WORKFLOW_NAME)
    if latest is None:
        raise LookupError("no checkpoint to resume from")
    return await collect(
        workflow.run(
            checkpoint_id=latest.checkpoint_id, checkpoint_storage=storage,
            responses=dict(responses) if responses else None, stream=True,
        )
    )  # fmt: skip
