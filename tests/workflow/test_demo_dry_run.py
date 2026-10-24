"""Milestone M1: the scripted text demo passes in replay mode (scripts/demo_dry_run.py)."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "demo_dry_run.py"


def test_the_demo_dry_run_passes(capsys: pytest.CaptureFixture[str]) -> None:
    spec = importlib.util.spec_from_file_location("demo_dry_run", SCRIPT)
    assert spec is not None and spec.loader is not None
    demo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(demo)

    assert demo.run() == 0
    out = capsys.readouterr().out
    assert "❌" not in out
    assert "has paid you £14.20" in out
