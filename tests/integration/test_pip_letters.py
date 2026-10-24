"""Letter Explainer + Decision Challenger through the Gateway (S7.2)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build


def test_a_pip_decision_is_explained_with_its_deadline_and_a_draft(tmp_path: Path) -> None:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token="t",
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"),
    )  # fmt: skip
    client = TestClient(build(settings))

    r = client.post("/letters/pip", headers={"Authorization": "Bearer t"}, json={
        "decision_date": "2026-11-28", "daily_living_points": 6, "mobility_points": 10,
        "reference": "PIP-55021",
        "evidence": [{"activity": "Preparing food", "what_happens": "I can't stand long enough to cook."}],
    }).json()  # fmt: skip

    assert (r["deadline"], r["post_by"]) == ("2026-12-28", "2026-12-23")  # gov.uk bank holidays
    assert "post it by 23 December 2026" in r["explanation"]
    assert "- Preparing food: I can't stand long enough to cook." in r["draft"]
    assert r["unsupported"] == []
