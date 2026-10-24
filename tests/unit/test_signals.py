"""On-device signal filters (S5.3): the reference rules, against the shared vectors."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tempo_core.signals import extract, load_signals, only_declared

ROOT = Path(__file__).resolve().parents[2]
(RAIL,) = load_signals(ROOT / "skills" / "clawback-uk-rail" / "signals.yaml")
VECTORS = json.loads((ROOT / "fixtures" / "signals" / "notifications.json").read_text())


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["text"][:30] for c in VECTORS["cases"]])
def test_filter_matches_the_shared_vectors(case: dict[str, Any]) -> None:
    assert extract(RAIL, case["sender"], case["text"]) == case["expected"]


def test_non_matching_notification_never_leaves_device() -> None:
    assert extract(RAIL, "Evri", "Your parcel is delayed by 2 days.") is None
    assert extract(RAIL, "Mum", "Train delayed, see you at 18:30") is None  # the sender decides


def test_only_declared_fields_may_leave() -> None:
    assert only_declared(RAIL, {"service_time": "08:12", "delay_minutes": "34"})
    assert not only_declared(RAIL, {"service_time": "08:12", "full_text": "Your 08:12 ..."})
    assert VECTORS["signal"] == RAIL.id and RAIL.retention_days == 30
