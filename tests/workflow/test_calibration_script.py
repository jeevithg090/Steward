"""S6.3: the calibration script fits, holds out the last week and writes its report."""

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "calibrate_delay_model.py"


def test_calibration_writes_a_labelled_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    spec = importlib.util.spec_from_file_location("calibrate_delay_model", SCRIPT)
    assert spec is not None and spec.loader is not None
    calibrate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(calibrate)
    monkeypatch.setattr(sys, "argv", ["calibrate", "--out", str(tmp_path)])

    calibrate.main()

    report = (tmp_path / "backtest.md").read_text()
    assert "SYNTHETIC" in report  # made-up data never passes for real
    assert "| 15 min |" in report and "| With Tempo |" in report
    assert (tmp_path / "calibration.png").read_bytes()[:4] == b"\x89PNG"
