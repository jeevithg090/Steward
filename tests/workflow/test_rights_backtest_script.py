"""R3: the Rights Decay backtest fits curves, scores them on later months and writes its reports,
labelled as a stand-in (run here on a small made-up file; `make rights-backtest` uses .data/)."""

from __future__ import annotations

import csv
import importlib.util
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from tempo_core.hazard import load_hazards

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "rights_backtest.py"
COLUMNS = ["created_date", "closed_date", "complaint_type", "descriptor", "borough", "status",
           "open_data_channel_type"]  # fmt: skip


def made_up_requests(path: Path, n: int = 3000) -> None:
    rng = random.Random(26)  # noqa: S311  (test data, not security)
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(COLUMNS)
        for i in range(n):
            created = datetime(2025, 1, 1) + timedelta(hours=rng.randrange(0, 364 * 24))
            kind = ("PLUMBING", "PAINT/PLASTER")[i % 2]
            closes = rng.random() < 0.9
            closed = created + timedelta(days=rng.expovariate(1 / (8 if i % 2 else 20)))
            writer.writerow([
                created.isoformat(timespec="milliseconds"),
                closed.isoformat(timespec="milliseconds") if closes else "",
                kind, ("LEAK", "BATH", "WALL")[i % 3], "BRONX",
                "Closed" if closes else "Open", "PHONE",
            ])  # fmt: skip


def test_the_backtest_fits_scores_and_labels_itself(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "data_nyc").mkdir()
    made_up_requests(tmp_path / "data_nyc" / "hpd_2025.csv")
    spec = importlib.util.spec_from_file_location("rights_backtest", SCRIPT)
    assert spec is not None and spec.loader is not None
    backtest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backtest)
    monkeypatch.setattr(backtest, "MIN_KIND_N", 100)  # a small file still writes per-kind curves
    argv = [
        "rb",
        "--data",
        str(tmp_path),
        "--hazards",
        str(tmp_path / "h"),
        "--docs",
        str(tmp_path),
    ]
    monkeypatch.setattr(sys, "argv", argv)

    backtest.main()

    curves = load_hazards(tmp_path / "h")
    assert set(curves) == {"nyc311.hpd.all", "nyc311.hpd.plumbing", "nyc311.hpd.paint-plaster"}
    assert all(h.demo_values and h.pays_share == 1 for h in curves.values())  # no FCA file here
    calibration = (tmp_path / "rights_calibration.md").read_text()
    assert "STAND-IN" in calibration and "| closed within 14 days |" in calibration
    report = (tmp_path / "rights_backtest.md").read_text()
    for policy in ("Never chase", "Act at once", "Remind at 14 days", "Rights Decay"):
        assert f"| {policy} |" in report
    assert "Planner vs best rule" in report and "STAND-IN" in report
    assert (tmp_path / "rights_calibration.png").read_bytes()[:4] == b"\x89PNG"
