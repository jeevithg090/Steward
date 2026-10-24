"""Skill manifests (SHIPPING §4.2): the starters load, and every way a newcomer can get one wrong
is refused with a reason they can act on, naming the file."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from tempo_core.readability import flesch_reading_ease
from tempo_core.skills import SkillInvalid, SkillManifest, load_manifests, plain_reasons

SKILLS = Path(__file__).resolve().parents[2] / "skills"
STARTERS = [
    "clawback-ofcom", "clawback-uk-flights", "clawback-uk-rail", "entitlement-check",
    "letter-explainer", "rights-decay", "scam-shield",
]  # fmt: skip
JARGON = (
    "Remuneration eligibility determination necessitates comprehensive documentation verification."
)


def manifest(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": "water-refund",
        "name": "Water supply refunds",
        "version": "0.1.0",
        "status": "experimental",
        "summary": "Your water went off. Tempo checks what the firm owes you and claims it.",
        "jobs": ["Check the firm's own compensation table", "Claim it once you say yes"],
        "needs": ["claim", "accept_cash"],
        "channels": ["web", "sms"],
        "maintainers": ["tempo-team"],
    }
    return data | overrides


def test_every_starter_manifest_loads_and_matches_its_folder() -> None:
    found = load_manifests(SKILLS)

    assert list(found) == STARTERS
    assert all(found[folder].id == folder for folder in found)
    assert found["clawback-uk-rail"].needs == ("claim", "accept_cash")
    assert found["letter-explainer"].needs == ()
    assert all(flesch_reading_ease(m.summary) >= 60 for m in found.values())
    assert all(isinstance(job, str) for m in found.values() for job in m.jobs)


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"id": "Water Refund"}, "id: String should match pattern"),
        ({"version": "0.1"}, "version: String should match pattern"),
        ({"status": "beta"}, "status: Input should be"),
        ({"summary": JARGON}, "summary: reads at Flesch"),
        ({"needs": ["claim", "fly"]}, "needs: unknown capability fly"),
        ({"needs": ["claim", "claim"]}, "needs: each capability may appear once"),
        ({"jobs": []}, "jobs: Tuple should have at least 1 item"),
        ({"jobs": ["a job"] * 7}, "jobs: Tuple should have at most 6 items"),
        ({"jobs": ["a job", "  "]}, "jobs: each job is one plain sentence"),
        ({"jobs": [{"Spot signs": "urgency"}]}, "jobs.0: Input should be a valid string"),
        ({"channels": ["fax"]}, "channels.0: Input should be"),
        ({"channels": ["web", "web"]}, "channels: each one may appear once"),
        ({"docs": "http://example.org/x"}, "docs: a docs link is a path in this repo or an https"),
        ({"maintainers": []}, "maintainers: Tuple should have at least 1 item"),
        ({"colour": "blue"}, "colour: Extra inputs are not permitted"),
    ],
)
def test_a_bad_manifest_says_what_is_wrong(change: dict[str, Any], reason: str) -> None:
    with pytest.raises(ValidationError) as err:
        SkillManifest.model_validate(manifest(**change))

    assert reason in plain_reasons(err.value), plain_reasons(err.value)


def test_a_manifest_is_frozen() -> None:
    loaded = SkillManifest.model_validate(manifest())
    with pytest.raises(ValidationError):
        loaded.needs = ()  # type: ignore[misc]


def write(folder: Path, text: str, name: str = "skill.yaml") -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(text, encoding="utf-8")


def test_a_folder_with_rules_but_no_manifest_is_an_error(tmp_path: Path) -> None:
    write(tmp_path / "forgotten" / "rules", "kind: fixed_amount\n", "x.yaml")

    with pytest.raises(SkillInvalid, match=r"forgotten has rules or data but no skill\.yaml"):
        load_manifests(tmp_path)


def test_drafts_hidden_and_empty_folders_are_ignored(tmp_path: Path) -> None:
    write(tmp_path / "generated" / "rules", "kind: fixed_amount\n", "draft.yaml")
    write(tmp_path / ".cache", "x: 1\n", "x.yaml")
    (tmp_path / "empty").mkdir()
    (tmp_path / "README.md").write_text("not a folder")

    assert load_manifests(tmp_path) == {}


def test_the_id_must_equal_the_folder_name(tmp_path: Path) -> None:
    import yaml

    write(tmp_path / "one", yaml.safe_dump(manifest(id="two")))

    with pytest.raises(SkillInvalid, match="id 'two' must equal the folder name 'one'"):
        load_manifests(tmp_path)


def test_bad_yaml_and_non_mappings_are_reported_with_the_file(tmp_path: Path) -> None:
    write(tmp_path / "broken", "name: Rights Decay: when to act\n")
    with pytest.raises(SkillInvalid, match=r"broken/skill.yaml: not valid YAML"):
        load_manifests(tmp_path)

    write(tmp_path / "broken", "- a list\n")
    with pytest.raises(SkillInvalid, match="a manifest is a mapping of fields"):
        load_manifests(tmp_path)


def test_a_schema_problem_names_the_file_and_the_field(tmp_path: Path) -> None:
    import yaml

    write(tmp_path / "water-refund", yaml.safe_dump(manifest(summary=JARGON)))

    with pytest.raises(SkillInvalid, match=r"water-refund/skill.yaml: summary: reads at Flesch"):
        load_manifests(tmp_path)


def test_a_missing_skills_folder_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(SkillInvalid, match="no skills folder"):
        load_manifests(tmp_path / "nowhere")
