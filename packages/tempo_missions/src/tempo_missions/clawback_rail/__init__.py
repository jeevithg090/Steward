"""Clawback Rail: find a late train, claim Delay Repay with consent, and survive restarts.

    intake -> rights -> court -> arbiter -> consent (request_info) -> action -> ledger

How the Gateway runs it (spec §16.5):
1. `start(workflow, request)`; a `ConsentRequest` comes back as pending, with its request id.
2. Route it to the person's best device. The process may restart meanwhile: the pending request
   lives in the checkpoint and is re-emitted on restore.
3. `resume(workflow, storage, {request_id: SignedApproval(...)})` with a fresh workflow instance.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agent_framework import CheckpointStorage, FileCheckpointStorage, Workflow, WorkflowBuilder

from tempo_missions.clawback_rail.act import Action, Consent, Ledger
from tempo_missions.clawback_rail.assess import Appraise, Court, Intake, Rights
from tempo_missions.clawback_rail.base import ClawbackDeps
from tempo_missions.clawback_rail.messages import (
    CHECKPOINT_TYPES,
    ClaimRequest,
    ConsentRequest,
    MissionOutcome,
    RailCase,
    SignedApproval,
)

WORKFLOW_NAME = "clawback-rail"  # stable, or checkpoints can't be found after a restart

__all__ = [
    "WORKFLOW_NAME",
    "ClaimRequest",
    "ClawbackDeps",
    "ConsentRequest",
    "MissionOutcome",
    "RailCase",
    "RunResult",
    "SignedApproval",
    "build_clawback_workflow",
    "checkpoint_storage",
    "resume",
    "start",
]


def checkpoint_storage(directory: Path) -> FileCheckpointStorage:
    """Checkpoints are a trust boundary: only the mission's own message types may be restored."""
    return FileCheckpointStorage(str(directory), allowed_checkpoint_types=CHECKPOINT_TYPES)


def build_clawback_workflow(deps: ClawbackDeps, storage: CheckpointStorage) -> Workflow:
    steps = [
        Intake(deps),
        Rights(deps),
        Court(deps),
        Appraise(deps),
        Consent(deps),
        Action(deps),
        Ledger(deps),
    ]
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


@dataclass(frozen=True)
class RunResult:
    outcomes: tuple[MissionOutcome, ...]
    pending: tuple[tuple[str, ConsentRequest], ...]  # (request id, what the person is asked)

    @property
    def outcome(self) -> MissionOutcome | None:
        return self.outcomes[-1] if self.outcomes else None


async def _collect(events: Any) -> RunResult:
    outcomes, pending = [], []
    async for event in events:
        if event.type == "output" and isinstance(event.data, MissionOutcome):
            outcomes.append(event.data)
        elif event.type == "request_info" and isinstance(event.data, ConsentRequest):
            pending.append((event.request_id, event.data))
    return RunResult(tuple(outcomes), tuple(pending))


async def start(workflow: Workflow, request: ClaimRequest) -> RunResult:
    return await _collect(workflow.run(request, stream=True))


async def resume(
    workflow: Workflow,
    storage: CheckpointStorage,
    responses: Mapping[str, SignedApproval] | None = None,
    *,
    checkpoint_id: str | None = None,
) -> RunResult:
    """Continue from the latest checkpoint (or `checkpoint_id`). Without responses, the pending
    request is re-emitted."""
    if checkpoint_id is None:
        latest = await storage.get_latest(workflow_name=WORKFLOW_NAME)
        if latest is None:
            raise LookupError("no checkpoint to resume from")
        checkpoint_id = latest.checkpoint_id
    return await _collect(
        workflow.run(
            checkpoint_id=checkpoint_id,
            checkpoint_storage=storage,
            responses=dict(responses) if responses else None,
            stream=True,
        )
    )
