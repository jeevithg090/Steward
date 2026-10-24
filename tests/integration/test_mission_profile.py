"""A mission can run under a Tempo Profile: the Gateway checks the profile exists before anything
starts, and the mission view says which profile it runs under (SHIPPING.md §4.5)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_core.profiles import ProfileCatalog
from tempo_gateway.app import create_app
from tempo_gateway.main import build_services

REPO = Path(__file__).resolve().parents[2]
TOKEN = "mc-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
MISSION = {
    "user_id": "u_margaret", "display_name": "Margaret", "origin_crs": "OXF",
    "destination_crs": "PAD", "travel_date": "2026-10-23", "departure": "08:12",
    "fare_gbp": "28.40",
}  # fmt: skip


@pytest.fixture
def gateway(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN,
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=0,
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    catalog = ProfileCatalog.load(REPO / "profiles", REPO / "skills")
    with TestClient(create_app(service, settings, bus, memory=memory, profiles=catalog)) as client:
        yield client


def test_a_mission_remembers_the_profile_it_runs_under(gateway: TestClient) -> None:
    r = gateway.post("/missions", json={**MISSION, "profile_id": "commuter"}, headers=AUTH)
    assert r.status_code == 201, r.text
    assert r.json()["profile_id"] == "commuter"
    again = gateway.get(f"/missions/{r.json()['id']}", headers=AUTH)
    assert again.json()["profile_id"] == "commuter"


def test_no_profile_is_still_fine(gateway: TestClient) -> None:
    r = gateway.post("/missions", json=MISSION, headers=AUTH)
    assert r.status_code == 201, r.text
    assert r.json()["profile_id"] is None


def test_an_unknown_profile_is_refused_before_anything_starts(gateway: TestClient) -> None:
    r = gateway.post("/missions", json={**MISSION, "profile_id": "nope"}, headers=AUTH)
    assert r.status_code == 422
    assert "nope" in r.json()["detail"]
    assert gateway.get("/missions", headers=AUTH).json() == []


def test_a_malformed_profile_id_is_refused_by_the_schema(gateway: TestClient) -> None:
    r = gateway.post("/missions", json={**MISSION, "profile_id": "Not A Profile"}, headers=AUTH)
    assert r.status_code == 422


def test_the_catalogue_is_served_alongside_missions(gateway: TestClient) -> None:
    ids = [p["id"] for p in gateway.get("/profiles", headers=AUTH).json()["profiles"]]
    assert "commuter" in ids and "read-it-to-me" in ids
