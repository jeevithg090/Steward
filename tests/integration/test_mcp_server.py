"""Tempo as an MCP server (plan.md §14), driven with the MCP SDK's own client over the Gateway that
`build()` makes in replay mode, with `/mcp` mounted the way `create_app` mounts it (`mount_mcp`).

An assistant may list the eight tools, check the HMRC text (warn), start Margaret's claim once per
journey, see its status and the ledger, read the rules and the profiles, and use the two prompts.
No tool approves: the claim still waits for her yes. A profile that may not claim refuses here in
the words `/missions` uses. Without the bearer, `/mcp` and `/mcp/info` answer 401.

`gateway_with_mcp` is also a uvicorn factory, for a live try from a scratch folder:
`uvicorn --app-dir <repo>/tests/integration test_mcp_server:gateway_with_mcp --factory`.
"""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi import FastAPI
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent, TextResourceContents
from pydantic import SecretStr

import tempo_gateway.main as gateway_main
from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.events import EventBus
from tempo_gateway.letters import bearer_caller
from tempo_gateway.mcp_server import TOOLS, mount_mcp

ROOT = Path(__file__).resolve().parents[2]
TOKEN = "mission-control-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
BASE = "http://127.0.0.1:8040"
HMRC = (
    "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim"
)
MARGARET = {
    "user_id": "u_margaret", "display_name": "Margaret", "origin_crs": "OXF",
    "destination_crs": "PAD", "travel_date": "2026-10-23", "departure": "08:12",
    "fare_gbp": "28.40",
}  # fmt: skip
VISIT = {
    "user_id": "u_margaret", "display_name": "Margaret", "provider": "Broadbandly",
    "visit_date": "2026-10-19",
}  # fmt: skip
READ_ONLY = {
    "check_message": True, "read_letter": True, "start_rail_claim": False,
    "start_missed_visit_claim": False, "claim_status": True, "money_returned": True,
    "screen_entitlements": True, "verify_mandate": True,
}  # fmt: skip
READ_IT_TO_ME = (
    "Your profile, Read It To Me, doesn't let me file a claim or accept cash, so I haven't "
    "started. Choose another profile if you want me to file a claim."
)
HOW_TO_APPROVE = (
    "Margaret approves on their own device: the Tempo web app or Face ID. An assistant cannot "
    "approve."
)


def with_mcp(create: Callable[..., FastAPI], seen: dict[str, Any] | None = None) -> Any:
    """`create_app`, then the one call the lead adds inside it, with the same objects."""

    def create_app_with_mcp(service: Any, settings: Settings, bus: EventBus, **options: Any) -> Any:
        app = create(service, settings, bus, **options)
        token = settings.tempo_api_token
        mount_mcp(
            app, web_caller=bearer_caller(token.get_secret_value() if token else None),
            public_url=settings.public_url, service=service, bus=bus,
            shield=options.get("shield"), profiles=options.get("profiles"),
            mandates=options.get("mandates"), vision=options.get("vision"),
            holidays=options.get("holidays", frozenset()), entitlement=options.get("entitlement"),
        )  # fmt: skip
        if seen is not None:
            seen.update(bus=bus, service=service)
        return app

    return create_app_with_mcp


def gateway_with_mcp() -> FastAPI:
    """A uvicorn factory: `build()` from the environment, with `/mcp` mounted."""
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(gateway_main, "create_app", with_mcp(create_app))
        return gateway_main.build(scheduler_interval_s=30.0)


@dataclass
class Tempo:
    session: ClientSession
    http: httpx2.AsyncClient  # the same app, with the bearer
    app: FastAPI
    bus: EventBus

    async def call(self, tool: str, **arguments: Any) -> CallToolResult:
        result = await self.session.call_tool(tool, arguments)
        assert isinstance(result, CallToolResult)
        return result

    async def ok(self, tool: str, **arguments: Any) -> dict[str, Any]:
        result = await self.call(tool, **arguments)
        assert not result.is_error, text_of(result)
        assert isinstance(result.structured_content, dict)
        return result.structured_content


def text_of(result: CallToolResult) -> str:
    return " ".join(c.text for c in result.content if isinstance(c, TextContent))


def refusal(result: CallToolResult, tool: str) -> str:
    """The plain sentence a tool refused with. The SDK puts its own prefix before a ToolError's
    words, and the words follow unchanged."""
    assert result.is_error
    prefix = f"Error executing tool {tool}: "
    assert text_of(result).startswith(prefix), text_of(result)
    return text_of(result).removeprefix(prefix)


@asynccontextmanager
async def tempo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Tempo]:
    """The Gateway, its lifespan run in this event loop, and an SDK client session to `/mcp`
    over an httpx2 client bound to the app (no socket)."""
    monkeypatch.chdir(tmp_path)  # no .env, no checkpoints in the repo
    seen: dict[str, Any] = {}
    monkeypatch.setattr(gateway_main, "create_app", with_mcp(create_app, seen))
    settings = Settings(
        _env_file=None, tempo_mode="replay", tempo_demo=True, tempo_api_token=SecretStr(TOKEN),
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"),
        payment_check_after_s=0, public_url=BASE,
    )  # fmt: skip
    app = gateway_main.build(settings)
    async with (
        app.router.lifespan_context(app),
        httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url=BASE, headers=AUTH
        ) as http,
        streamable_http_client(f"{BASE}/mcp", http_client=http) as (read, write),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        yield Tempo(session=session, http=http, app=app, bus=seen["bus"])


def drain(queue: Any) -> list[dict[str, Any]]:
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    return events


async def test_eight_tools_with_honest_annotations_and_none_approves(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with tempo(tmp_path, monkeypatch) as t:
        tools = (await t.session.list_tools()).tools

    assert sorted(tool.name for tool in tools) == sorted(TOOLS) == sorted(READ_ONLY)
    for tool in tools:
        assert tool.annotations is not None
        assert tool.annotations.read_only_hint is READ_ONLY[tool.name], tool.name
        assert "approve" not in tool.name and "consent" not in tool.name
    starts = [tool for tool in tools if not READ_ONLY[tool.name]]
    assert all(tool.annotations and tool.annotations.destructive_hint is False for tool in starts)


async def test_the_hmrc_text_warns_and_the_bus_hears_the_call_without_its_words(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with tempo(tmp_path, monkeypatch) as t, t.bus.subscribe() as queue:
        verdict = await t.ok("check_message", text=HMRC)
        refused = await t.call("claim_status", mission_id="m_nope")
        events = [e for e in drain(queue) if e["type"] == "mcp_call"]

    assert verdict["zone"] == "warn" and verdict["level"] == "likely_scam"
    assert verdict["say"].startswith("Do not touch that message.")
    assert verdict["reasons"]
    assert refusal(refused, "claim_status") == "No claim has that id."
    assert events == [
        {"type": "mcp_call", "tool": "check_message", "ok": True},
        {"type": "mcp_call", "tool": "claim_status", "ok": False},
    ]  # the tool and the outcome only: never the text, never the mission id


async def test_margarets_claim_starts_once_and_waits_for_her_own_yes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with tempo(tmp_path, monkeypatch) as t:
        first = await t.ok("start_rail_claim", **MARGARET)
        again = await t.ok("start_rail_claim", **MARGARET)
        status = await t.ok("claim_status", mission_id=first["mission_id"])
        ledger = await t.ok("money_returned")
        approve = await t.call("approve_claim", mission_id=first["mission_id"])
        missions = (await t.http.get("/missions")).json()

    assert first["amount_gbp"] == "14.20"
    assert first["state"] == "awaiting_consent" and first["started"] is True
    assert first["needs_consent_from"] == "the person, on their own device"
    assert first["how_to_approve"] == HOW_TO_APPROVE
    assert first["proof"]["steps"][0]["rule_id"] == "uk-rail.gwr.delay-repay"
    assert first["court"] is not None
    assert first["message"].endswith("Shall I claim £14.20 for you?")
    assert again["mission_id"] == first["mission_id"] and again["started"] is False  # one claim
    assert [m["id"] for m in missions] == [first["mission_id"]]
    assert status["state"] == "awaiting_consent" and status["amount_gbp"] == "14.20"
    assert status["message"] == first["message"] and status["timeline"]
    assert status["needs_consent_from"] == "the person, on their own device"
    assert set(ledger) == {"minutes_returned", "hours_returned", "gbp_recovered"}
    assert ledger["gbp_recovered"] == "0.00"  # nothing is counted until the money arrives
    assert approve.is_error and "approve_claim" in text_of(approve)  # there is no such tool


async def test_texting_yes_is_offered_only_when_the_claim_knows_her_number(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with tempo(tmp_path, monkeypatch) as t:
        claim = await t.ok("start_rail_claim", **MARGARET, phone="+447700900123")
        visit = await t.ok("start_missed_visit_claim", **VISIT)
        visit_again = await t.ok("start_missed_visit_claim", **VISIT)

    assert claim["how_to_approve"] == (
        "Margaret approves on their own device: the Tempo web app, Face ID, or by texting YES. "
        "An assistant cannot approve."
    )
    assert visit["state"] == "awaiting_consent" and visit["how_to_approve"] == HOW_TO_APPROVE
    assert visit_again["mission_id"] == visit["mission_id"] and visit_again["started"] is False


async def test_a_claim_needs_no_name_and_tempo_never_makes_one_up(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    nameless = {k: v for k, v in MARGARET.items() if k != "display_name"} | {"user_id": "u_jo"}
    async with tempo(tmp_path, monkeypatch) as t:
        tools = {tool.name: tool for tool in (await t.session.list_tools()).tools}
        claim = await t.ok("start_rail_claim", **nameless)

    for name in ("start_rail_claim", "start_missed_visit_claim"):
        schema = tools[name].input_schema
        assert "display_name" not in schema.get("required", []), name
        assert "never guess" in schema["properties"]["display_name"]["description"]
    assert claim["state"] == "awaiting_consent"
    assert claim["how_to_approve"] == (
        "The person approves on their own device: the Tempo web app or Face ID. An assistant "
        "cannot approve."
    )


async def test_a_profile_that_may_not_claim_refuses_in_the_words_missions_uses(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with tempo(tmp_path, monkeypatch) as t:
        refused = await t.call("start_rail_claim", **MARGARET, profile_id="read-it-to-me")
        unknown = await t.call("start_rail_claim", **MARGARET, profile_id="nope")
        http = await t.http.post("/missions", json={**MARGARET, "profile_id": "read-it-to-me"})
        http_unknown = await t.http.post("/missions", json={**MARGARET, "profile_id": "nope"})
        missions = (await t.http.get("/missions")).json()

    assert refusal(refused, "start_rail_claim") == http.json()["detail"] == READ_IT_TO_ME
    assert refusal(unknown, "start_rail_claim") == http_unknown.json()["detail"]
    assert missions == []  # nothing started


async def test_the_read_only_tools_answer_as_their_routes_do(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    letter = (ROOT / "fixtures" / "vision" / "council_tax_reminder.png").read_bytes()
    answers = {"age": 79, "weekly_income_gbp": "190", "savings_gbp": "4000"}
    async with tempo(tmp_path, monkeypatch) as t:
        reading = await t.ok("read_letter", image_base64=base64.b64encode(letter).decode())
        routed = await t.http.post(
            "/letters/read",
            json={"image_b64": base64.b64encode(letter).decode(), "user_id": "u_margaret"},
        )
        screened = await t.ok("screen_entitlements", **answers)
        screened_http = (await t.http.post("/entitlement/screen", json=answers)).json()
        forged = await t.ok(
            "verify_mandate", envelope={"mandate": {"mandate_id": "md_forged"}},
            counterparty="GWR", action="claim", amount_gbp="14.20",
        )  # fmt: skip

    assert reading == routed.json()
    assert reading["kind"] and reading["reading_text"]
    assert screened["flags"] == screened_http["flags"] and screened["flags"]
    assert screened["disclaimer"] == screened_http["disclaimer"]
    assert forged["ok"] is False and forged["message"]  # a mandate Tempo never issued: refused


async def test_rules_and_profiles_read_as_resources_and_both_prompts_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with tempo(tmp_path, monkeypatch) as t:
        templates = (await t.session.list_resource_templates()).resource_templates
        rule = (await t.session.read_resource("tempo://rules/uk-rail.gwr.delay-repay")).contents
        clock = await t.session.read_resource("tempo://rules/uk-rail.delay-repay.claim-window")
        profile = (await t.session.read_resource("tempo://profiles/commuter")).contents
        prompts = (await t.session.list_prompts()).prompts
        late = await t.session.get_prompt("claim-a-late-train")
        scam = await t.session.get_prompt("is-this-a-scam", {"message": HMRC})

    assert {r.uri_template for r in templates} == {
        "tempo://rules/{rule_id}", "tempo://profiles/{profile_id}",
    }  # fmt: skip
    assert isinstance(rule[0], TextResourceContents)
    assert rule[0].text.startswith("GWR Delay Repay (DR15).")
    assert "id: uk-rail.gwr.delay-repay" in rule[0].text and "```yaml" in rule[0].text
    assert isinstance(clock.contents[0], TextResourceContents)
    assert clock.contents[0].text.startswith("You have 28 days from the journey")
    assert isinstance(profile[0], TextResourceContents)
    assert json.loads(profile[0].text)["id"] == "commuter"
    assert {p.name for p in prompts} == {"claim-a-late-train", "is-this-a-scam"}
    late_text = late.messages[0].content
    scam_text = scam.messages[0].content
    assert isinstance(late_text, TextContent) and "start_rail_claim" in late_text.text
    assert isinstance(scam_text, TextContent) and "check_message" in scam_text.text
    assert HMRC in scam_text.text


async def test_no_bearer_no_mcp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    initialize = {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                   "clientInfo": {"name": "t", "version": "0"}},
    }  # fmt: skip
    accept = {"Accept": "application/json, text/event-stream"}
    async with tempo(tmp_path, monkeypatch) as t:
        transport = httpx2.ASGITransport(app=t.app)
        async with httpx2.AsyncClient(transport=transport, base_url=BASE) as anonymous:
            bare = await anonymous.post("/mcp", json=initialize, headers=accept)
            wrong = await anonymous.post(
                "/mcp", json=initialize, headers={**accept, "Authorization": "Bearer nope"}
            )
            info = await anonymous.get("/mcp/info")
        allowed = await t.http.post("/mcp", json=initialize, headers=accept)

    assert bare.status_code == wrong.status_code == info.status_code == 401
    assert bare.json() == {"detail": "a valid bearer token is required"}
    assert bare.headers["www-authenticate"] == "Bearer"
    assert allowed.status_code == 200 and allowed.json()["result"]["serverInfo"]["name"] == "tempo"


async def test_mcp_info_lists_the_tools_for_the_web(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with tempo(tmp_path, monkeypatch) as t:
        info = (await t.http.get("/mcp/info")).json()

    assert info["url"] == f"{BASE}/mcp" and info["transport"] == "streamable-http"
    assert {tool["name"]: tool["read_only"] for tool in info["tools"]} == READ_ONLY
    assert all(tool["description"] for tool in info["tools"])
    assert info["resources"] == ["tempo://rules/{rule_id}", "tempo://profiles/{profile_id}"]
    assert info["prompts"] == ["claim-a-late-train", "is-this-a-scam"]
