"""Skill manifests (SHIPPING §4.2): what a skill does for a person, and what it needs to do it.

A manifest is informational for people and binding for profiles: a profile that turns a skill on
must allow every capability in its `needs`. Loading is strict on purpose, so a newcomer finds out
at `make validate-skills` and not in a demo: a folder with rules but no manifest is an error, the
id must equal the folder name, and the summary must read plainly (Flesch 60 or more).
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from tempo_core.capabilities import check_capabilities
from tempo_core.errors import TempoError
from tempo_core.readability import flesch_reading_ease

PLAIN_WORDS = 60  # the Flesch bar every sentence Tempo says must clear (test_plain_language.py)
GENERATED = "generated"  # Skill Forge's drafts: proposals, never skills
ID_PATTERN = r"^[a-z0-9-]{2,40}$"
VERSION_PATTERN = r"^\d+\.\d+\.\d+$"
Channel = Literal["web", "sms", "voice"]
SkillStatus = Literal["ready", "demo-values", "experimental"]


class SkillInvalid(TempoError):
    """A skill folder or manifest that cannot be loaded, with the reason in plain words."""


def plain_reasons(error: ValidationError) -> str:
    """One "field: why" per problem, so a newcomer can fix the YAML without reading the code."""
    lines = []
    for problem in error.errors():
        where = ".".join(str(part) for part in problem["loc"]) or "document"
        lines.append(f"{where}: {problem['msg'].removeprefix('Value error, ')}")
    return "; ".join(lines)


def check_plain(text: str) -> str:
    """Pydantic-style check: the words Tempo shows a person must clear the Flesch bar."""
    score = flesch_reading_ease(text)
    if score < PLAIN_WORDS:
        raise ValueError(
            f"reads at Flesch {score:.0f}; plain words score {PLAIN_WORDS} or more. "
            "Shorter sentences and shorter words help"
        )
    return text


def check_unique(values: tuple[str, ...]) -> tuple[str, ...]:
    if len(set(values)) != len(values):
        raise ValueError("each one may appear once")
    return values


class SkillManifest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=80)
    version: str = Field(pattern=VERSION_PATTERN)
    status: SkillStatus
    summary: str = Field(min_length=1)
    jobs: tuple[str, ...] = Field(min_length=1, max_length=6)
    needs: tuple[str, ...] = ()
    channels: tuple[Channel, ...] = Field(min_length=1)
    mission: str | None = None
    operators: tuple[str, ...] = ()
    docs: str | None = None
    notes: str | None = None
    maintainers: tuple[str, ...] = Field(min_length=1)

    @field_validator("summary")
    @classmethod
    def summary_is_plain(cls, value: str) -> str:
        return check_plain(value)

    @field_validator("jobs")
    @classmethod
    def jobs_are_sentences(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not job.strip() for job in value):
            raise ValueError("each job is one plain sentence; none may be blank")
        return value

    @field_validator("needs")
    @classmethod
    def needs_are_capabilities(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return check_capabilities(value)

    @field_validator("channels", "operators", "maintainers")
    @classmethod
    def no_repeats(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return check_unique(value)

    @field_validator("docs")
    @classmethod
    def docs_is_a_path_or_https(cls, value: str | None) -> str | None:
        if value is not None and "://" in value and not value.startswith("https://"):
            raise ValueError("a docs link is a path in this repo or an https:// URL")
        return value


def _yaml_mapping(path: Path, what: str) -> dict[str, object]:
    """Read one YAML document as a mapping, or say plainly why it is not one."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise SkillInvalid(f"{path}: not valid YAML ({' '.join(str(exc).split())})") from exc
    if not isinstance(data, dict):
        raise SkillInvalid(f"{path}: {what} is a mapping of fields, not a list or a bare value")
    return data


def load_manifest(path: Path) -> SkillManifest:
    """One skill.yaml. Its id must equal the folder, so the catalog and the tree never disagree."""
    data = _yaml_mapping(path, "a manifest")
    try:
        manifest = SkillManifest.model_validate(data)
    except ValidationError as exc:
        raise SkillInvalid(f"{path}: {plain_reasons(exc)}") from exc
    folder = path.parent.name
    if manifest.id != folder:
        raise SkillInvalid(f"{path}: id {manifest.id!r} must equal the folder name {folder!r}")
    return manifest


def load_manifests(skills_root: Path) -> dict[str, SkillManifest]:
    """Every skills/*/skill.yaml by id, in folder order.

    A folder that holds rules or other YAML but no manifest is an error rather than a skip, so
    nobody can add a rule pack and forget to say what it does. Hidden folders and Skill Forge's
    `generated` drafts are ignored.
    """
    if not skills_root.is_dir():
        raise SkillInvalid(f"no skills folder at {skills_root}")
    found: dict[str, SkillManifest] = {}
    for folder in sorted(p for p in skills_root.iterdir() if p.is_dir()):
        if folder.name == GENERATED or folder.name.startswith((".", "_")):
            continue
        manifest_path = folder / "skill.yaml"
        if not manifest_path.is_file():
            if any(folder.rglob("*.yaml")):
                raise SkillInvalid(
                    f"{folder} has rules or data but no skill.yaml; add a manifest "
                    "(scripts/new_skill.py shows the shape)"
                )
            continue
        found[folder.name] = load_manifest(manifest_path)
    return found
