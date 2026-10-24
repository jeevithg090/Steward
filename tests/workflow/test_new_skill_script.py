"""The scaffolder and the validator (SHIPPING §9): a newcomer's first skill passes validation
before they have edited a word, the script never overwrites, and a broken tree fails plainly."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

from tempo_core.readability import flesch_reading_ease
from tempo_core.rules import DelayRepayPack, FixedAmountPack, RulePackRegistry
from tempo_core.skills import load_manifests

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def script(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def root(tmp_path: Path) -> Path:
    (tmp_path / "profiles").mkdir()
    return tmp_path


def test_a_scaffolded_skill_validates_and_is_never_overwritten(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    new_skill, validate = script("new_skill"), script("validate_skills")
    argv = ["--root", str(root), "--id", "water-refund", "--name", "Water supply refunds",
            "--needs", "claim,accept_cash", "--rules", "fixed_amount"]  # fmt: skip

    assert new_skill.main(argv) == 0

    out = capsys.readouterr().out
    assert "skills/water-refund/skill.yaml" in out and "rules/water-refund.yaml" in out
    assert "scripts/validate_skills.py" in out and "make check" in out
    manifest = load_manifests(root / "skills")["water-refund"]
    assert manifest.status == "experimental" and manifest.needs == ("claim", "accept_cash")
    assert manifest.name == "Water supply refunds"
    assert flesch_reading_ease(manifest.summary) >= 60 and "TODO" in manifest.summary
    (pack,) = RulePackRegistry.from_directory(root / "skills")
    assert isinstance(pack, FixedAmountPack) and pack.demo_values is True
    rules_text = (root / "skills" / "water-refund" / "rules" / "water-refund.yaml").read_text()
    assert rules_text.count("# (check)") >= 6 and "citation_url: https://" in rules_text

    assert validate.main(["--root", str(root)]) == 0
    assert "water-refund  experimental  water-refund.fixed-amount" in capsys.readouterr().out

    manifest_text = (root / "skills" / "water-refund" / "skill.yaml").read_text()
    assert new_skill.main(["--root", str(root), "--id", "water-refund", "--name", "Again"]) == 1
    assert "already exists" in capsys.readouterr().err
    assert (root / "skills" / "water-refund" / "skill.yaml").read_text() == manifest_text


def test_the_delay_repay_template_and_a_skill_with_no_rules(root: Path) -> None:
    new_skill = script("new_skill")

    assert new_skill.main(["--root", str(root), "--id", "late-trains", "--name", "Late trains",
                           "--rules", "delay_repay"]) == 0  # fmt: skip
    assert new_skill.main(["--root", str(root), "--id", "read-bills", "--name", "Bills"]) == 0

    (pack,) = RulePackRegistry.from_directory(root / "skills")
    assert isinstance(pack, DelayRepayPack) and pack.id == "late-trains.delay-repay"
    assert len(pack.bands) == 5 and pack.demo_values is True
    assert sorted(load_manifests(root / "skills")) == ["late-trains", "read-bills"]
    assert not (root / "skills" / "read-bills" / "rules").exists()
    assert load_manifests(root / "skills")["read-bills"].needs == ()


def test_bad_input_is_refused_before_anything_is_written(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    new_skill = script("new_skill")

    assert new_skill.main(["--root", str(root), "--id", "Bad Id", "--name", "x"]) == 1
    assert "--id must match" in capsys.readouterr().err
    assert (
        new_skill.main(["--root", str(root), "--id", "ok-id", "--name", "x", "--needs", "fly"]) == 1
    )
    assert "unknown capability fly" in capsys.readouterr().err
    assert not (root / "skills").exists()


def test_the_validator_fails_plainly_on_a_broken_tree(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    validate = script("validate_skills")
    forgotten = root / "skills" / "forgotten" / "rules"
    forgotten.mkdir(parents=True)
    (forgotten / "x.yaml").write_text("kind: fixed_amount\nid: x\n")

    assert validate.main(["--root", str(root)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("error: ") and "forgotten/rules/x.yaml" in err

    (forgotten / "x.yaml").unlink()
    (forgotten.parent / "notes.yaml").write_text("todo: true\n")
    assert validate.main(["--root", str(root)]) == 1
    assert "no skill.yaml" in capsys.readouterr().err
