"""Connectors and the sweep (plan.md §14) on a Gateway built by `build()` in replay mode, against
the real connector servers (`mcp-servers/{mail,calendar,bank}`) over stdio and their fixtures.

The hub is mounted the way the lead mounts it: `create_app(..., connectors=hub)` with the hub
from `build_connectors`. Until app.py takes that keyword, the fixture mounts the same router and
hands the same hub to the chat router, from inside `create_app`.
"""

from __future__ import annotations

import inspect
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

import tempo_gateway.app as gateway_app
from tempo_adapters.rail import ReplayRail
from tempo_adapters.settings import Settings
from tempo_core.intent import Intent, classify
from tempo_core.rules import RulePackRegistry
from tempo_gateway.chat import chat_router
from tempo_gateway.connectors import (
    ConnectorHub,
    ConnectorsConfig,
    ToolRefused,
    build_connectors,
    connectors_router,
)
from tempo_gateway.events import EventBus
from tempo_gateway.main import REPO, build

TOKEN = "connectors-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
USER = "u_margaret"
KINDS = ["late_train", "engineer_visit", "scam", "money_arrived"]
ASK = "check my email for anything I'm owed"


@pytest.fixture
def gateway(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.chdir(tmp_path)  # no .env, no checkpoints in the repo
    if "connectors" not in inspect.signature(gateway_app.create_app).parameters:

        def chat_and_connectors(service: Any, web_caller: Any, **kw: Any) -> APIRouter:
            hub = build_connectors(REPO, service, kw["shield"], kw["bus"], mode="replay")
            assert hub is not None
            router = APIRouter()
            router.include_router(chat_router(service, web_caller, connectors=hub, **kw))
            router.include_router(connectors_router(hub, web_caller))
            return router

        monkeypatch.setattr(gateway_app, "chat_router", chat_and_connectors)
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True, tempo_api_token=TOKEN,
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"),
        payment_check_after_s=0,
    )  # fmt: skip
    with TestClient(build(settings)) as client:
        yield client


def sweep(client: TestClient) -> dict[str, Any]:
    r = client.post("/connectors/sweep", json={"user_id": USER}, headers=AUTH)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def chat(client: TestClient, text: str) -> dict[str, Any]:
    r = client.post("/chat", headers=AUTH, json={"user_id": USER, "display_name": "Margaret",
                                                 "text": text})  # fmt: skip
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def test_the_four_connectors_are_listed_and_connected_for_the_demo(gateway: TestClient) -> None:
    r = gateway.get("/connectors", params={"user_id": USER}, headers=AUTH)

    assert r.status_code == 200, r.text
    listing = r.json()
    assert listing["simulated"] is True
    assert [c["id"] for c in listing["connectors"]] == ["mail", "calendar", "bank", "rail"]
    for c in listing["connectors"]:
        assert set(c) == {"id", "name", "kind", "connected", "scopes", "tools", "last_read_at",
                          "items_read"}  # fmt: skip
        assert c["connected"] is True and c["scopes"] and c["tools"]
        assert (c["items_read"], c["last_read_at"]) == (0, None)
    assert listing["connectors"][0]["tools"] == ["search_messages", "get_message"]
    assert gateway.get("/connectors", params={"user_id": USER}).status_code == 401


def test_a_sweep_finds_the_four_things_in_order_with_exact_amounts(gateway: TestClient) -> None:
    swept = sweep(gateway)

    findings = swept["findings"]
    assert [f["kind"] for f in findings] == KINDS
    late, visit, scam, money = findings
    assert late["amount_gbp"] == "14.20"  # GWR's rule on the recorded 38 minutes, half of £28.40
    assert classify(late["say"]) is Intent.RAIL_DELAY
    assert late["action"]["label"] == "Claim £14.20"
    assert late["action"]["href"].startswith("#/chat?say=")
    assert visit["title"] == "Did they come? Broadbandly had an engineer booked for 19 October."
    assert classify(visit["say"]) is Intent.MISSED_VISIT
    assert "HMRC" in scam["title"] and classify(scam["say"]) is Intent.SCAM_CHECK
    assert money["amount_gbp"] == "23.40" and "Thames Water" in money["title"]
    assert {f["source"]["connector"] for f in findings} == {"mail", "calendar", "bank"}
    assert set(swept["read"]) == {"mail", "calendar", "bank", "rail"}
    assert swept["read"]["rail"] == 1 and all(n > 0 for n in swept["read"].values())
    assert isinstance(swept["took_ms"], int)

    shield = gateway.get("/scam/shield", params={"user_id": USER}, headers=AUTH).json()
    [alert] = [a for a in shield["recent"] if a["source"] == "connector"]
    assert (alert["zone"], alert["level"]) == ("warn", "likely_scam")  # Scam Shield's own verdict
    assert "248.20" not in str(shield)  # the Shield log keeps no text

    listing = gateway.get("/connectors", params={"user_id": USER}, headers=AUTH).json()
    read = {c["id"]: c for c in listing["connectors"]}
    assert read["mail"]["items_read"] == swept["read"]["mail"]
    assert read["mail"]["last_read_at"] is not None


def test_disconnecting_mail_removes_what_was_found_in_mail(gateway: TestClient) -> None:
    off = gateway.post("/connectors/mail/disconnect", json={"user_id": USER}, headers=AUTH)

    assert off.status_code == 200 and off.json()["connected"] is False
    swept = sweep(gateway)
    assert [f["kind"] for f in swept["findings"]] == ["engineer_visit", "money_arrived"]
    assert "mail" not in swept["read"]
    assert "looks like a refund" in swept["findings"][1]["why"]  # no email to match it to now
    on = gateway.post("/connectors/mail/connect", json={"user_id": USER}, headers=AUTH)
    assert on.json()["connected"] is True
    other = gateway.get("/connectors", params={"user_id": "u_other"}, headers=AUTH).json()
    assert all(c["connected"] for c in other["connectors"])  # per person
    assert gateway.post(
        "/connectors/nope/connect", json={"user_id": USER}, headers=AUTH
    ).status_code == 404  # fmt: skip


def test_the_chat_sweeps_and_each_chip_leads_to_its_door(gateway: TestClient) -> None:
    reply = chat(gateway, ASK)

    assert reply["intent"] == "sweep"
    assert reply["reply"] == (
        "I found four things worth a look in your email, calendar and bank. "
        "I kept none of what I read."
    )
    assert [f["kind"] for f in reply["findings"]] == KINDS
    assert reply["suggestions"] == [f["say"] for f in reply["findings"]]
    assert reply["actions"] == [{"label": "Open Connectors", "href": "#/connectors"}]
    assert gateway.get("/missions", headers=AUTH).json() == []  # a sweep starts nothing

    late, _, scam, _ = reply["findings"]
    claim = chat(gateway, late["say"])
    assert claim["intent"] == "rail_delay" and claim["ask"]["amount_gbp"] == "14.20"
    checked = chat(gateway, scam["say"])
    assert checked["intent"] == "scam_check" and checked["verdict"]["zone"] == "warn"

    again = sweep(gateway)["findings"][0]  # the claim is under way now: say so, don't re-offer it
    assert again["kind"] == "late_train" and again["action"]["href"] == "#/missions"


def test_without_a_config_there_is_no_hub_and_a_typo_never_loads(tmp_path: Path) -> None:
    missing = tmp_path / "connectors.yaml"

    assert build_connectors(REPO, None, None, EventBus(), config_path=missing) is None  # type: ignore[arg-type]
    (tmp_path / "bad.yaml").write_text("connectors:\n  - id: mail\n    surprise: true\n")
    with pytest.raises(ValueError, match="surprise"):  # extra="forbid": a typo never passes
        ConnectorsConfig.load(tmp_path / "bad.yaml")


async def test_only_allowlisted_tools_run_and_events_carry_counts_not_contents() -> None:
    bus = EventBus()
    hub = ConnectorHub(
        ConnectorsConfig.load(REPO / "connectors" / "connectors.yaml"), repo=REPO, shield=None,
        rail_port=ReplayRail.from_directory(REPO / "fixtures" / "rail" / "replay"),
        rules=RulePackRegistry.from_directory(REPO / "skills"), clock=lambda: datetime.now(UTC),
        bus=bus,
    )  # fmt: skip

    with pytest.raises(ToolRefused):
        await hub.call("mail", "delete_message", {"id": "trainline-eticket-2026-10-21"})
    with pytest.raises(ToolRefused):
        await hub.call("mail", "list_events", {})  # another connector's tool
    async with bus.subscribe() as queue:
        rows = await hub.call("mail", "search_messages", {"query": "Trainline"}, user_id=USER)
        swept = await hub.sweep(USER)
        events = [queue.get_nowait() for _ in range(queue.qsize())]

    assert [r["id"] for r in rows] == ["trainline-eticket-2026-10-21"]
    no_shield = ["late_train", "engineer_visit", "money_arrived"]  # no Shield, so no scam finding
    assert [f["kind"] for f in swept["findings"]] == no_shield
    mine = [e for e in events if e["type"] in ("connector_read", "sweep_done")]
    assert {e["type"] for e in mine} == {"connector_read", "sweep_done"}
    for event in mine:
        assert set(event) <= {"type", "connector", "items", "findings", "user_id"}
    assert mine[-1] == {"type": "sweep_done", "findings": 3, "user_id": USER}
    assert hub.view(USER, "mail")["items_read"] >= 1 + swept["read"]["mail"]
