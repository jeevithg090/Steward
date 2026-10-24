"""Tempo Profiles (SHIPPING §4.3): who Tempo works for, which skills are on, how it must speak
with the person, and what it may never do. One YAML, shareable as a code, enforced by the Harness.

The checks live here and nowhere else because a profile is a promise about what Tempo will
refuse: a starter file, a pasted share code and the object the guards read must all pass the same
code. Money is Decimal written as a quoted string, the capability words are the Agent Passport's,
and a profile is frozen once loaded so nothing can widen it after the check.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from collections.abc import Iterable, Mapping
from decimal import Decimal
from pathlib import Path
from types import MappingProxyType
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from tempo_core.capabilities import MAX_MANDATE_DAYS, check_capabilities
from tempo_core.errors import TempoError
from tempo_core.skills import (
    ID_PATTERN,
    VERSION_PATTERN,
    Channel,
    SkillManifest,
    SkillStatus,
    _yaml_mapping,
    check_plain,
    check_unique,
    load_manifests,
    plain_reasons,
)
from tempo_core.voice_profile import LANGUAGES

SHARE_PREFIX = "tp1."
MAX_SHARE_BYTES = 4096  # a stranger can paste this in: cap it before anything is decoded
_B64URL = re.compile(r"^[A-Za-z0-9_-]*$")
ProfileStatus = Literal["starter", "community"]


class ProfileInvalid(TempoError):
    """A profile that must not be used, with the reason in plain words."""


class _Part(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


def _quoted_money(value: Any) -> Any:
    """A bare YAML number is a binary float; money is only ever accepted as a string or an int."""
    if isinstance(value, float | bool):
        raise ValueError('write money as a quoted string, like "250.00", not a bare number')
    return value


class Limits(_Part):
    max_gbp_per_claim: Decimal = Field(ge=0)
    max_user_questions: int = Field(ge=1, le=10)
    max_llm_gbp_per_mission: Decimal = Field(ge=0)
    mandate_days: int = Field(ge=1, le=MAX_MANDATE_DAYS)

    @field_validator("max_gbp_per_claim", "max_llm_gbp_per_mission", mode="before")
    @classmethod
    def money_is_quoted(cls, value: Any) -> Any:
        return _quoted_money(value)


class AccessNeeds(_Part):
    """How Tempo speaks with this person. The defaults are everyone's call."""

    language: str = "en"
    pace: Literal["normal", "slower"] = "normal"
    patience: Literal["normal", "high"] = "normal"
    voice: Literal["default", "low"] = "default"
    prefers_text: bool = False
    plain_words: bool = True

    @field_validator("language")
    @classmethod
    def language_has_a_voice_preset(cls, code: str) -> str:
        if code not in LANGUAGES.values():
            codes = ", ".join(sorted(LANGUAGES.values()))
            raise ValueError(f"no voice preset for {code!r}; the codes are {codes}")
        return code


class Share(_Part):
    public: bool
    author: str = Field(min_length=1, max_length=80)


class Profile(_Part):
    id: str = Field(pattern=ID_PATTERN)
    name: str = Field(min_length=1, max_length=80)
    version: str = Field(pattern=VERSION_PATTERN)
    status: ProfileStatus
    summary: str = Field(min_length=1)
    for_whom: str = Field(min_length=1)
    skills: tuple[str, ...] = Field(min_length=1)
    may: tuple[str, ...]
    may_not: tuple[str, ...]
    limits: Limits
    access: AccessNeeds
    channels: tuple[Channel, ...] = Field(min_length=1)
    time_value_gbp_h: Decimal = Field(gt=0)
    share: Share

    @field_validator("summary")
    @classmethod
    def summary_is_plain(cls, value: str) -> str:
        return check_plain(value)

    @field_validator("may", "may_not")
    @classmethod
    def capability_words(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return check_capabilities(value)

    @field_validator("skills", "channels")
    @classmethod
    def no_repeats(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return check_unique(value)

    @field_validator("time_value_gbp_h", mode="before")
    @classmethod
    def money_is_quoted(cls, value: Any) -> Any:
        return _quoted_money(value)

    @model_validator(mode="after")
    def may_and_may_not_agree(self) -> Self:
        both = sorted(set(self.may) & set(self.may_not))
        if both:
            raise ValueError(f"{', '.join(both)} can't be both allowed and refused")
        return self


class SkillBrief(_Part):
    id: str
    name: str
    status: SkillStatus
    jobs: tuple[str, ...]


class ProfileView(_Part):
    """What the Gateway and the web show: the profile plus what its skills do, in plain words."""

    id: str
    name: str
    version: str
    status: ProfileStatus
    summary: str
    for_whom: str
    skills: tuple[SkillBrief, ...]
    jobs: tuple[str, ...]  # the union of the skills' jobs, in skill order, each said once
    may: tuple[str, ...]
    may_not: tuple[str, ...]
    limits: Limits
    access: AccessNeeds
    channels: tuple[Channel, ...]
    time_value_gbp_h: Decimal
    share: Share


def check_against_skills(profile: Profile, skills: Mapping[str, SkillManifest]) -> None:
    """The cross-checks (every skill exists, needs ⊆ may, may ∩ may_not = ∅, mandate ≤ 7 days).

    The last two already hold for any Profile that validated; they are re-run here so a share code
    and a starter file go through one list, and a future schema change cannot drop one quietly.
    """
    for skill_id in profile.skills:
        manifest = skills.get(skill_id)
        if manifest is None:
            raise ProfileInvalid(
                f"profile {profile.id!r} turns on {skill_id!r}, but no skill has that manifest"
            )
        missing = [need for need in manifest.needs if need not in profile.may]
        if missing:
            raise ProfileInvalid(
                f"skill {skill_id!r} needs {', '.join(missing)}, which profile "
                f"{profile.id!r} does not allow in `may`"
            )
    both = sorted(set(profile.may) & set(profile.may_not))
    if both:
        raise ProfileInvalid(f"{', '.join(both)} can't be both allowed and refused")
    if profile.limits.mandate_days > MAX_MANDATE_DAYS:
        raise ProfileInvalid(f"a mandate can last at most {MAX_MANDATE_DAYS} days")


def view_of(profile: Profile, skills: Mapping[str, SkillManifest]) -> ProfileView:
    briefs = tuple(
        SkillBrief(id=m.id, name=m.name, status=m.status, jobs=m.jobs)
        for m in (skills[skill_id] for skill_id in profile.skills)
    )
    jobs = tuple(dict.fromkeys(job for brief in briefs for job in brief.jobs))
    return ProfileView(**profile.model_dump(exclude={"skills"}), skills=briefs, jobs=jobs)


def load_profile(path: Path) -> Profile:
    """One profiles/<id>.yaml; the id must equal the file name, so a link and a file agree."""
    data = _yaml_mapping(path, "a profile")
    try:
        profile = Profile.model_validate(data)
    except ValidationError as exc:
        raise ProfileInvalid(f"{path}: {plain_reasons(exc)}") from exc
    if profile.id != path.stem:
        raise ProfileInvalid(f"{path}: id {profile.id!r} must equal the file name {path.stem!r}")
    return profile


class ProfileCatalog:
    """The profiles Tempo offers, checked against the skill manifests once, at start-up."""

    def __init__(self, profiles: Iterable[Profile], skills: Mapping[str, SkillManifest]) -> None:
        self._skills: dict[str, SkillManifest] = dict(skills)
        by_id: dict[str, Profile] = {}
        for profile in profiles:
            if profile.id in by_id:
                raise ProfileInvalid(f"two profiles share the id {profile.id!r}")
            check_against_skills(profile, self._skills)
            by_id[profile.id] = profile
        self._profiles = tuple(by_id[key] for key in sorted(by_id))

    @classmethod
    def load(cls, profiles_dir: Path, skills_root: Path) -> ProfileCatalog:
        skills = load_manifests(skills_root)
        if not profiles_dir.is_dir():
            raise ProfileInvalid(f"no profiles folder at {profiles_dir}")
        paths = sorted(profiles_dir.glob("*.yaml"))
        return cls((load_profile(path) for path in paths), skills)

    @property
    def profiles(self) -> tuple[Profile, ...]:
        return self._profiles

    @property
    def skills(self) -> Mapping[str, SkillManifest]:
        return MappingProxyType(self._skills)

    def get(self, profile_id: str) -> Profile | None:
        return next((p for p in self._profiles if p.id == profile_id), None)

    def public(self) -> tuple[Profile, ...]:
        return tuple(p for p in self._profiles if p.share.public)

    def view(self, profile: Profile) -> ProfileView:
        """Works for an imported profile too: `from_share_code` checked it against these skills."""
        return view_of(profile, self._skills)


def canonical_json(profile: Profile) -> bytes:
    """Sorted keys, no spaces, UTF-8, money as strings: the same bytes for the same profile."""
    body = profile.model_dump(mode="json")
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def share_code(profile: Profile) -> str:
    return SHARE_PREFIX + base64.urlsafe_b64encode(canonical_json(profile)).rstrip(b"=").decode()


def from_share_code(code: str, skills: Mapping[str, SkillManifest]) -> Profile:
    """A pasted code becomes a Profile only by passing every check a starter file passes.

    Raises ProfileInvalid, and nothing else, whatever the text: the size is checked before any
    decoding, and each decoding step says plainly what was wrong.
    """
    if len(code.encode("utf-8", "surrogatepass")) > MAX_SHARE_BYTES:
        raise ProfileInvalid(f"this share code is too long: over {MAX_SHARE_BYTES} bytes")
    if not code.startswith(SHARE_PREFIX):
        raise ProfileInvalid(
            f"this is not a Tempo profile code: it should start with {SHARE_PREFIX}"
        )
    data = _decode(code[len(SHARE_PREFIX) :])
    try:
        profile = Profile.model_validate(data)
    except ValidationError as exc:
        raise ProfileInvalid(plain_reasons(exc)) from exc
    check_against_skills(profile, skills)
    return profile


def _decode(body: str) -> dict[str, Any]:
    if not _B64URL.match(body):
        raise ProfileInvalid("the share code has characters that don't belong in it; copy it again")
    try:
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        data = json.loads(raw.decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ProfileInvalid("the share code is damaged and can't be read; copy it again") from exc
    except (ValueError, RecursionError) as exc:  # not JSON, or nested too deep to be a profile
        raise ProfileInvalid("the share code doesn't hold a profile; copy it again") from exc
    if not isinstance(data, dict):
        raise ProfileInvalid("a profile is a set of named fields; this code holds something else")
    return data
