"""Skill Forge API: REST endpoints for skill generation and management."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from .generator import GenerationConfig, SkillForgeGenerator
from .models import GenerationStage, SkillForgeState

router = APIRouter(prefix="/skill-forge", tags=["Skill Forge"])

# In-memory state store (replace with Redis/DB in production)
_forge_states: dict[str, SkillForgeState] = {}


class GenerateSkillRequest(BaseModel):
    narration: str = Field(
        ..., min_length=10, max_length=2000, description="Natural language description of the skill"
    )
    user_id: str = Field(..., description="User ID creating the skill")
    tier: str = Field(
        default="community", description="Trust tier: verified|community|experimental"
    )


class GenerateSkillResponse(BaseModel):
    skill_id: str
    stage: GenerationStage
    status_url: str
    artifacts: list[dict[str, Any]] = []


class SkillStatusResponse(BaseModel):
    skill_id: str
    stage: GenerationStage
    spec: dict[str, Any] | None = None
    artifacts: list[dict[str, Any]] = []
    eval_results: dict[str, Any] | None = None
    error: str | None = None
    updated_at: datetime


@router.post("/generate", response_model=GenerateSkillResponse)
async def generate_skill(request: GenerateSkillRequest, background_tasks: BackgroundTasks):
    """Start generating a skill from narration."""
    from tempo_adapters.cortex import CortexModel
    from tempo_adapters.db import PostgresRepo

    model = CortexModel()
    repo = PostgresRepo()
    config = GenerationConfig()
    generator = SkillForgeGenerator(model, repo, config)

    # Run generation in background
    background_tasks.add_task(_run_generation, request.narration, request.user_id, generator)

    # Return immediately with skill_id
    import uuid

    skill_id = f"skill-{uuid.uuid4().hex[:8]}"

    return GenerateSkillResponse(
        skill_id=skill_id,
        stage=GenerationStage.PENDING,
        status_url=f"/skill-forge/status/{skill_id}",
    )


async def _run_generation(narration: str, user_id: str, generator: SkillForgeGenerator):
    """Background task to run skill generation."""
    import uuid

    skill_id = f"skill-{uuid.uuid4().hex[:8]}"

    state = await generator.generate_skill(narration, user_id)
    _forge_states[skill_id] = state


@router.get("/status/{skill_id}", response_model=SkillStatusResponse)
async def get_skill_status(skill_id: str):
    """Get the status of a skill generation."""
    if skill_id not in _forge_states:
        raise HTTPException(status_code=404, detail="Skill not found")

    state = _forge_states[skill_id]
    return SkillStatusResponse(
        skill_id=state.skill_id,
        stage=state.stage,
        spec=state.spec.model_dump() if state.spec else None,
        artifacts=[
            {
                "id": a.id,
                "type": a.artifact_type,
                "file_path": a.file_path,
                "generated_at": a.generated_at.isoformat(),
            }
            for a in state.artifacts
        ],
        eval_results=state.eval_results,
        error=state.error,
        updated_at=state.updated_at,
    )


@router.get("/list")
async def list_skills():
    """List all generated skills."""
    return {
        "skills": [
            {
                "skill_id": sid,
                "stage": state.stage.value,
                "name": state.spec.name if state.spec else "unknown",
                "updated_at": state.updated_at.isoformat(),
            }
            for sid, state in _forge_states.items()
        ]
    }


@router.post("/publish/{skill_id}")
async def publish_skill(skill_id: str):
    """Publish a generated skill to the registry (creates GitLab MR)."""
    if skill_id not in _forge_states:
        raise HTTPException(status_code=404, detail="Skill not found")

    state = _forge_states[skill_id]
    if state.stage != GenerationStage.EVAL_PASSED:
        raise HTTPException(status_code=400, detail="Skill has not passed eval gate")

    # Create GitLab MR with the skill
    mr_url = await _create_gitlab_mr(state)

    state.stage = GenerationStage.PUBLISHED
    _forge_states[skill_id] = state

    return {"skill_id": skill_id, "merge_request_url": mr_url, "status": "published"}


async def _create_gitlab_mr(state: SkillForgeState) -> str:
    """Create a GitLab merge request for the skill."""
    # This would use GitLab API to create MR
    # For demo, return a mock URL
    return f"https://gitlab.com/tempo/skills/-/merge_requests/{state.skill_id}"


@router.get("/artifact/{skill_id}/{artifact_id}")
async def get_artifact(skill_id: str, artifact_id: str):
    """Get a specific artifact's content."""
    if skill_id not in _forge_states:
        raise HTTPException(status_code=404, detail="Skill not found")

    state = _forge_states[skill_id]
    artifact = next((a for a in state.artifacts if a.id == artifact_id), None)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    return {
        "id": artifact.id,
        "type": artifact.artifact_type,
        "content": artifact.content,
        "file_path": artifact.file_path,
    }


# Demo endpoint for the hackathon
@router.post("/demo")
async def demo_skill_forge(request: GenerateSkillRequest):
    """Run the full skill generation pipeline synchronously for demo."""
    from tempo_adapters.cortex import CortexModel
    from tempo_adapters.db import PostgresRepo

    model = CortexModel()
    repo = PostgresRepo()
    config = GenerationConfig()
    generator = SkillForgeGenerator(model, repo, config)

    state = await generator.generate_skill(request.narration, request.user_id)

    return {
        "skill_id": state.skill_id,
        "stage": state.stage.value,
        "spec": state.spec.model_dump() if state.spec else None,
        "artifacts": [
            {
                "id": a.id,
                "type": a.artifact_type,
                "file_path": a.file_path,
                "preview": artifact_preview(a.content),
            }
            for a in state.artifacts
        ],
        "eval_results": state.eval_results,
        "error": state.error,
    }


def artifact_preview(content: str | bytes, max_len: int = 500) -> str:
    """Generate a preview of artifact content."""
    if isinstance(content, bytes):
        content = content.decode("utf-8", errors="replace")
    if len(content) <= max_len:
        return content
    return content[:max_len] + "\n... [truncated]"
