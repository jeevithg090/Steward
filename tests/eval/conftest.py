"""Eval helpers: every eval appends its scores to the trend table in evals/report.md."""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import pytest

REPORT = Path(__file__).resolve().parents[2] / "evals" / "report.md"
HEADER = "# Eval trend\n\n| When (UTC) | Commit | Eval | Scores |\n|---|---|---|---|\n"


def _commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],  # noqa: S607 - git from PATH is fine here
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "?"
    return out.stdout.strip()


@pytest.fixture
def record_eval() -> Callable[[str, dict[str, float]], None]:
    def record(name: str, scores: dict[str, float]) -> None:
        if not REPORT.exists():
            REPORT.write_text(HEADER)
        summary = ", ".join(f"{k} {v:.0%}" for k, v in scores.items())
        with REPORT.open("a") as report:
            report.write(
                f"| {datetime.now(tz=UTC):%Y-%m-%d %H:%M} | {_commit()} | {name} | {summary} |\n"
            )

    return record
