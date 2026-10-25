"""A mission can run under a Tempo Profile: the Gateway checks the profile exists before anything
starts, and the mission view says which profile it runs under (SHIPPING.md §4.5).

Phase 2 (plan.md §12.2): a profile that lacks a skill's needs is refused before anything starts,
and which profile a mission runs under survives a restart, so the claim guard still holds."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.rail import ReplayRail
from tempo_adapters.settings import Settings
from tempo_core.profiles import ProfileCatalog
from tempo_core.rules import RulePackRegistry
from tempo_gateway.app import create_app
from tempo_gateway.events import EventBus
from tempo_gateway.main import build_services
from tempo_gateway.missions import MISSIONS_FILE, MissionService, StartMission
from tempo_missions.clawback_rail import ClawbackDeps, SignedApproval
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo

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


# --- a profile is enforced before anything starts (plan.md §12.2) ---------------------------------

VISIT = {
    "user_id": "u_margaret", "display_name": "Margaret", "operator": "Broadbandly",
    "event_date": "2026-10-19",
}  # fmt: skip


def test_a_profile_that_cannot_claim_is_refused_with_a_plain_reason(gateway: TestClient) -> None:
    r = gateway.post("/missions", json={**MISSION, "profile_id": "read-it-to-me"}, headers=AUTH)

    assert r.status_code == 422
    assert r.json() == {
        "detail": "Your profile, Read It To Me, doesn't let me file a claim or accept cash, so I "
        "haven't started. Choose another profile if you want me to file a claim."
    }
    assert gateway.get("/missions", headers=AUTH).json() == []  # nothing started


def test_a_broadband_claim_needs_a_profile_that_may_phone_the_company(gateway: TestClient) -> None:
    refused = gateway.post(
        "/missions/ofcom", json={**VISIT, "profile_id": "commuter"}, headers=AUTH
    )
    allowed = gateway.post("/missions/ofcom", json={**VISIT, "profile_id": "carer"}, headers=AUTH)

    assert refused.status_code == 422
    assert refused.json()["detail"].startswith(
        "Your profile, The Commuter, doesn't let me phone the company, so I haven't started."
    )
    assert allowed.status_code == 201 and allowed.json()["profile_id"] == "carer"
    assert [m["id"] for m in gateway.get("/missions", headers=AUTH).json()] == [
        allowed.json()["id"]
    ]


def test_the_phone_line_refuses_and_dedupes_the_same_way(tmp_path: Path) -> None:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN, voice_tool_secret="voice",
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=0,
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    catalog = ProfileCatalog.load(REPO / "profiles", REPO / "skills")
    voice = {"X-Tempo-Voice-Secret": "voice"}
    with TestClient(create_app(service, settings, bus, memory=memory, profiles=catalog)) as client:
        refused = client.post(
            "/voice/tools/create_mission", json={**MISSION, "profile_id": "read-it-to-me"},
            headers=voice,
        ).json()  # fmt: skip
        started = client.post(
            "/voice/tools/create_mission", json={**MISSION, "profile_id": "commuter"},
            headers=voice,
        ).json()  # fmt: skip
        again = client.post(
            "/voice/tools/create_mission", json={**MISSION, "profile_id": "commuter"},
            headers=voice,
        ).json()  # fmt: skip
        listed = client.get("/missions", headers=AUTH).json()

    assert refused["mission_id"] is None
    assert refused["say"].startswith("Your profile, Read It To Me, doesn't let me file a claim")
    assert started["mission_id"] and started["state"] == "awaiting_consent"
    assert again["mission_id"] == started["mission_id"]  # the same journey: never a second claim
    assert [m["id"] for m in listed] == [started["mission_id"]]


# --- the profile survives a restart (memory lost, checkpoints and store kept) ---------------------

NOW = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
YES = SignedApproval(approved=True, scopes=("file_claim",), device_sig="passkey:iphone")


def mission_service(tmp: Path, repo: InMemoryRepo, claims: SimulatedClaims) -> MissionService:
    """A fresh process: nothing in memory but what the store and the checkpoint folder hold."""
    deps = ClawbackDeps(
        repo=repo, rail=ReplayRail.from_directory(REPO / "fixtures" / "rail" / "replay"),
        rules=RulePackRegistry.from_directory(REPO / "skills" / "clawback-uk-rail"),
        claims=claims, clock=lambda: NOW,
    )  # fmt: skip
    catalog = ProfileCatalog.load(REPO / "profiles", REPO / "skills")
    return MissionService(deps, tmp / "checkpoints", EventBus(), profiles=catalog)


def start(profile_id: str, fare: str = "28.40") -> StartMission:
    return StartMission.model_validate({**MISSION, "fare_gbp": fare, "profile_id": profile_id})


async def test_after_a_restart_read_it_to_me_is_still_denied_at_the_claim_tool(
    tmp_path: Path,
) -> None:
    repo, claims = InMemoryRepo(), SimulatedClaims(clock=lambda: NOW)
    view = await mission_service(tmp_path, repo, claims).start(start("read-it-to-me"))
    assert view.ask is not None  # started directly: no route refused it

    restarted = mission_service(tmp_path, repo, claims)
    assert await restarted.recover() == [view.id]
    assert (await restarted.view(view.id)).profile_id == "read-it-to-me"
    answered = await restarted.answer(view.ask.request_id, YES)

    assert claims.calls == 0  # nothing reached the company
    assert answered.state.value == "failed_safe"
    assert answered.message == "This profile doesn't let me file a claim, so I stopped."


async def test_after_a_restart_an_ask_above_the_limit_still_says_so_and_yes_files(
    tmp_path: Path,
) -> None:
    repo, claims = InMemoryRepo(), SimulatedClaims(clock=lambda: NOW)
    view = await mission_service(tmp_path, repo, claims).start(start("commuter", fare="600.00"))
    assert view.ask is not None

    restarted = mission_service(tmp_path, repo, claims)
    await restarted.recover()
    again = restarted.ask_for(view.ask.request_id)
    answered = await restarted.answer(view.ask.request_id, YES)

    assert again is not None and again.summary == view.ask.summary
    assert again.summary.endswith(
        "This is above your profile's limit of £250.00, so I'm asking you first."
    )
    assert claims.calls == 1 and answered.state.value == "waiting"


async def test_an_unreadable_profiles_file_refuses_the_claim_rather_than_drop_the_guard(
    tmp_path: Path,
) -> None:
    repo, claims = InMemoryRepo(), SimulatedClaims(clock=lambda: NOW)
    view = await mission_service(tmp_path, repo, claims).start(start("read-it-to-me"))
    assert view.ask is not None
    (tmp_path / "checkpoints" / MISSIONS_FILE).write_text("{not json", encoding="utf-8")

    restarted = mission_service(tmp_path, repo, claims)
    await restarted.recover()
    answered = await restarted.answer(view.ask.request_id, YES)

    assert claims.calls == 0 and answered.state.value == "failed_safe"
    assert answered.message == "I can't find the profile this claim runs under, so I stopped."


async def test_a_mission_with_no_profile_is_saved_without_one_and_recovers_as_before(
    tmp_path: Path,
) -> None:
    repo, claims = InMemoryRepo(), SimulatedClaims(clock=lambda: NOW)
    plain = StartMission.model_validate(MISSION)
    view = await mission_service(tmp_path, repo, claims).start(plain)
    assert view.ask is not None
    saved = json.loads((tmp_path / "checkpoints" / MISSIONS_FILE).read_text(encoding="utf-8"))
    assert saved == {
        view.id: {"key": "clawback.uk-rail-delay-repay|OXF|PAD|2026-10-23|0812",
                  "profile_id": None, "limit_named": False}
    }  # fmt: skip

    restarted = mission_service(tmp_path, repo, claims)
    assert await restarted.recover() == [view.id]
    answered = await restarted.answer(view.ask.request_id, YES)

    assert claims.calls == 1 and answered.state.value == "waiting"


async def test_after_a_restart_the_same_journey_is_still_the_same_mission(tmp_path: Path) -> None:
    repo, claims = InMemoryRepo(), SimulatedClaims(clock=lambda: NOW)
    view = await mission_service(tmp_path, repo, claims).start(StartMission.model_validate(MISSION))

    restarted = mission_service(tmp_path, repo, claims)
    await restarted.recover()
    again = StartMission.model_validate({**MISSION, "departure": "0812", "origin_crs": "oxf"})
    other_day = StartMission.model_validate({**MISSION, "travel_date": "2026-10-22"})
    someone_else = StartMission.model_validate({**MISSION, "user_id": "u_amir"})

    found = await restarted.duplicate_of(again)
    assert found is not None and found.id == view.id
    assert await restarted.duplicate_of(other_day) is None
    assert await restarted.duplicate_of(someone_else) is None
