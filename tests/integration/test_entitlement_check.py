"""Entitlement Check through the Gateway (S7.1)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build


def test_margaret_is_screened_and_given_a_pack(tmp_path: Path) -> None:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token="t",
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"),
    )  # fmt: skip
    client = TestClient(build(settings))

    r = client.post("/entitlement/screen", headers={"Authorization": "Bearer t"}, json={
        "age": 78, "weekly_income_gbp": "190", "savings_gbp": "4000", "needs_care_day": True, "care_months": 12,
    }).json()  # fmt: skip

    assert [(f["benefit"], f["likelihood"]) for f in r["flags"]] == [
        ("Pension Credit", "likely"), ("Attendance Allowance", "likely"),
        ("Cheaper broadband or phone (social tariff)", "worth_checking"),
    ]  # fmt: skip
    assert "not a decision" in r["disclaimer"] and r["disclaimer"] in r["pack"]
    assert r["figures"] == {"tax_year": "2025/26", "demo_values": True}
