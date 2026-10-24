"""Rights Decay through the Gateway (R5): a missed engineer visit waits, then acts, on the demo
clock, and the plan Mission Control shows is always the one that is running."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.main import build_service, build_vision

TOKEN = "mission-control-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SIX_DAYS_AGO = (datetime.now(UTC) - timedelta(days=6)).date().isoformat()
VISIT = {
    "user_id": "u_margaret", "display_name": "Margaret", "operator": "Broadbandly",
    "event_date": SIX_DAYS_AGO, "time_value_gbp_h": "18",
}  # fmt: skip


def gateway(tmp_path: Path, *, demo: bool) -> TestClient:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN, tempo_demo=demo,
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=0,
    )  # fmt: skip
    service, bus = build_service(settings)
    return TestClient(create_app(service, settings, bus, vision=build_vision(settings)))


@pytest.fixture
def demo(tmp_path: Path) -> Any:
    with gateway(tmp_path, demo=True) as client:
        yield client


def approve(client: TestClient, view: dict[str, Any]) -> dict[str, Any]:
    r = client.post(
        f"/approvals/{view['ask']['request_id']}", json={"approved": True}, headers=AUTH
    )
    assert r.status_code == 200, r.text
    result: dict[str, Any] = r.json()
    return result


def test_a_missed_visit_is_planned_and_the_plan_is_shown(demo: TestClient) -> None:
    r = demo.post("/missions/ofcom", json=VISIT, headers=AUTH)

    assert r.status_code == 201, r.text
    view = r.json()
    assert view["skill_id"] == "clawback.ofcom-missed-appointment"
    assert view["state"] == "awaiting_consent"
    assert view["plan"]["action_today"] == "wait"
    assert [x["status"] for x in view["plan"]["rights"]] == ["opens_later", "locked"]
    assert "Shall I handle this for you?" in view["ask"]["summary"]
    assert view["court"]["outcome"] == "proceed"  # the replay jurors sat on the Ofcom rule
    assert "of closures pay" in view["plan"]["why"][0]  # the UK upheld share is applied


def test_yes_waits_then_the_demo_clock_makes_it_act_and_get_paid(demo: TestClient) -> None:
    waiting = approve(demo, demo.post("/missions/ofcom", json=VISIT, headers=AUTH).json())
    assert waiting["state"] == "waiting"
    assert waiting["message"].startswith("I'll wait for now.")
    assert "Next check:" in waiting["message"]

    moved = demo.post("/demo/clock", json={"advance_days": 31}, headers=AUTH).json()
    acted = demo.get(f"/missions/{waiting['id']}", headers=AUTH).json()
    demo.post("/scheduler/tick", headers=AUTH)  # the payment check is due at once in this test
    paid = demo.get(f"/missions/{waiting['id']}", headers=AUTH).json()

    assert moved["offset_days"] == 31 and moved["fired"] == [waiting["id"]]
    assert acted["plan"]["action_today"] == "ofcom.complaint"
    assert acted["message"].startswith("Complaint made. I'll check the money has arrived")
    assert paid["state"] == "verified"
    assert "has paid you £32.31" in paid["message"]
    assert demo.get("/health").json()["clock_offset_days"] == 31


def test_if_the_credit_arrives_nobody_calls(demo: TestClient) -> None:
    waiting = approve(demo, demo.post("/missions/ofcom", json=VISIT, headers=AUTH).json())

    assert demo.post(f"/demo/credit/{waiting['id']}", headers=AUTH).json() == {"credited": True}
    demo.post("/demo/clock", json={"advance_days": 31}, headers=AUTH)
    done = demo.get(f"/missions/{waiting['id']}", headers=AUTH).json()

    assert done["state"] == "verified"
    assert done["message"].startswith("Broadbandly paid the £32.31 on its own")


def test_stop_while_waiting_ends_the_wait(demo: TestClient) -> None:
    waiting = approve(demo, demo.post("/missions/ofcom", json=VISIT, headers=AUTH).json())

    stopped = demo.post(f"/missions/{waiting['id']}/stop", headers=AUTH).json()
    moved = demo.post("/demo/clock", json={"advance_days": 31}, headers=AUTH).json()

    assert stopped["state"] == "failed_safe"
    assert moved["fired"] == []


def test_the_demo_routes_only_work_in_demo_mode(tmp_path: Path) -> None:
    with gateway(tmp_path, demo=False) as client:
        view = client.post("/missions/ofcom", json=VISIT, headers=AUTH).json()

        assert client.post("/demo/clock", json={"advance_days": 1}, headers=AUTH).status_code == 404
        assert client.post(f"/demo/credit/{view['id']}", headers=AUTH).status_code == 404
        assert client.get("/health").json()["clock_offset_days"] == 0


def test_the_clock_never_goes_back(demo: TestClient) -> None:
    assert demo.post("/demo/clock", json={"advance_days": -1}, headers=AUTH).status_code == 422
    assert demo.post("/demo/clock", json={"advance_days": 1}).status_code == 401


CARD = Path(__file__).resolve().parents[2] / "fixtures" / "vision" / "missed_visit_card.png"


def photo(raw: bytes) -> dict[str, str]:
    import base64

    return {
        "image_b64": base64.b64encode(raw).decode(), "filename": "missed_visit_card.png",
        "user_id": "u_margaret", "display_name": "Margaret",
    }  # fmt: skip


def test_the_agent_reads_the_card_and_asks_once_about_the_smudged_date(demo: TestClient) -> None:
    r = demo.post("/missions/ofcom/read", json=photo(CARD.read_bytes()), headers=AUTH)

    assert r.status_code == 200, r.text
    read = r.json()
    assert (
        read["question"] == "I read the date of the missed visit as 19 October 2026. Is that right?"
    )
    assert read["fact_key"] == "event_date"
    assert {f["key"]: f["confidence"] for f in read["facts"]}["event_date"] < 0.8
    visit = read["visit"]
    assert (visit["operator"], visit["event_date"], visit["account_ref"]) == (
        "Broadbandly", "2026-10-19", "BB-4417",
    )  # fmt: skip
    assert visit["source"] == "missed_visit_card.png#vision"

    confirmed = visit | {"source": "missed_visit_card.png#vision, confirmed by Margaret"}
    started = demo.post("/missions/ofcom", json=confirmed, headers=AUTH).json()

    assert started["skill_id"] == "clawback.ofcom-missed-appointment"
    assert started["plan"]["rights"][0]["label"] == "Complain to Broadbandly"


def test_a_photo_it_cannot_read_is_said_plainly(demo: TestClient) -> None:
    r = demo.post("/missions/ofcom/read", json=photo(b"not the demo card"), headers=AUTH)
    bad = demo.post("/missions/ofcom/read", json=photo(b"") | {"image_b64": "@@@"}, headers=AUTH)

    assert r.status_code == 503 and "Tell me the date" in r.json()["detail"]
    assert bad.status_code == 503
