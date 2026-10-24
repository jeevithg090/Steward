"""Tool calling on the standard and private models (S8.2, `make evals`): the same 20 cases.

Private mode is shown in the demo only if the private model matches >= 90%.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml
from agent_framework import Agent, tool

from tempo_adapters.factory import build_adapters, chat_client
from tempo_adapters.settings import Settings

CASES: list[dict[str, Any]] = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "evals" / "tool_calling" / "cases.yaml").read_text()
)
INSTRUCTIONS = (
    "You are Tempo, an AI assistant that wins back money companies owe people. Today is "
    "24 October 2026. The caller is Margaret; her user id is u_margaret. Use three-letter "
    "station codes (Oxford is OXF, London Paddington is PAD), dates as YYYY-MM-DD and times as "
    "HH:MM. Call a tool only when you have everything it needs; otherwise ask one question. "
    "Never ask for bank details or move money."
)
settings = Settings()


def endpoints() -> list[tuple[str, Settings]]:
    found = []
    if settings.snowflake_account and settings.snowflake_pat:
        found.append(("cortex", settings.model_copy(update={"tempo_deploy": "cloud-standard"})))
    if settings.runpod_endpoint_id and settings.runpod_api_key:
        found.append(("runpod", settings.model_copy(update={"tempo_deploy": "cloud-private"})))
    return found


def recording_tools(calls: list[tuple[str, dict[str, Any]]]) -> list[Any]:
    def note(name: str, **arguments: Any) -> str:
        calls.append((name, arguments))
        return json.dumps({"ok": True})

    @tool
    def create_mission(user_id: str, display_name: str, origin_crs: str, destination_crs: str,
                       travel_date: str, departure: str, fare_gbp: str) -> str:  # fmt: skip
        """Start a rail Delay Repay mission once you have all the journey details."""
        return note("create_mission", user_id=user_id, display_name=display_name,
                    origin_crs=origin_crs, destination_crs=destination_crs,
                    travel_date=travel_date, departure=departure, fare_gbp=fare_gbp)  # fmt: skip

    @tool
    def get_service_delay(
        origin_crs: str, destination_crs: str, travel_date: str, departure: str
    ) -> str:
        """How late a train was (official rail data)."""
        return note("get_service_delay", origin_crs=origin_crs, destination_crs=destination_crs,
                    travel_date=travel_date, departure=departure)  # fmt: skip

    @tool
    def get_case_capsule(mission_id: str) -> str:
        """Where a mission is, and what to say about it."""
        return note("get_case_capsule", mission_id=mission_id)

    @tool
    def record_consent(mission_id: str, approved: bool) -> str:
        """Record the caller's clear yes or no."""
        return note("record_consent", mission_id=mission_id, approved=approved)

    @tool
    def request_human(mission_id: str, reason: str) -> str:
        """Ask for a person to decide something you can't."""
        return note("request_human", mission_id=mission_id, reason=reason)

    @tool
    def recall_memories(user_id: str) -> str:
        """What Tempo remembers about the caller."""
        return note("recall_memories", user_id=user_id)

    @tool
    def forget_memory(user_id: str, thing: str) -> str:
        """Delete something Tempo remembers, when the caller asks."""
        return note("forget_memory", user_id=user_id, thing=thing)

    return [create_mission, get_service_delay, get_case_capsule, record_consent, request_human,
            recall_memories, forget_memory]  # fmt: skip


def matches(case: dict[str, Any], calls: list[tuple[str, dict[str, Any]]]) -> bool:
    if case["tool"] is None:
        return not calls
    if not calls or calls[0][0] != case["tool"]:
        return False
    args = calls[0][1]
    return all(str(args.get(k)).lower() == str(v).lower() for k, v in case.get("args", {}).items())


@pytest.mark.skipif(not endpoints(), reason="needs Cortex or RunPod keys")
@pytest.mark.parametrize("name", [n for n, _ in endpoints()] or ["none"])
async def test_tool_calling_matches(name: str, record_eval: Callable[..., None]) -> None:
    configured = dict(endpoints())[name]
    client = chat_client(configured, build_adapters(configured))
    passed = 0
    for case in CASES:
        calls: list[tuple[str, dict[str, Any]]] = []
        agent = Agent(client=client, instructions=INSTRUCTIONS, tools=recording_tools(calls))
        await agent.run(case["say"])
        passed += matches(case, calls)
    rate = passed / len(CASES)
    record_eval(f"tool calling ({name})", {"match": rate})
    assert rate >= 0.9, f"{name} matched {rate:.0%} of {len(CASES)} cases"
