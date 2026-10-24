"""The private model on RunPod vLLM (S8.2), against recorded OpenAI-compatible responses."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
from agent_framework import Agent, tool

from tempo_adapters.runpod_llm import runpod_client

RUNPOD = Path(__file__).resolve().parents[2] / "fixtures" / "runpod"


def recorded(*names: str) -> tuple[list[httpx.Request], httpx.MockTransport]:
    seen: list[httpx.Request] = []
    replies = [json.loads((RUNPOD / name).read_text()) for name in names]

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=replies[min(len(seen), len(replies)) - 1])

    return seen, httpx.MockTransport(handle)


async def test_runpod_chat_completion_parsed() -> None:
    seen, transport = recorded("chat_completion.json")
    agent = Agent(
        client=runpod_client("ep123", "rp-key", transport=transport), name="tempo.private"
    )

    reply = await agent.run("Was my 08:12 late?")

    assert reply.text == "Your 08:12 arrived 38 minutes late. You can claim £14.20."
    assert seen[0].headers["authorization"] == "Bearer rp-key"


async def test_runpod_tool_call_parsed() -> None:
    seen, transport = recorded("tool_call.json", "chat_completion.json")
    calls: list[dict[str, Any]] = []

    @tool
    def get_service_delay(
        origin_crs: str, destination_crs: str, travel_date: str, departure: str
    ) -> str:
        """How late a train was."""
        calls.append({"origin_crs": origin_crs, "destination_crs": destination_crs,
                      "travel_date": travel_date, "departure": departure})  # fmt: skip
        return json.dumps({"delay_minutes": 38})

    agent = Agent(
        client=runpod_client("ep123", "rp-key", transport=transport), tools=[get_service_delay]
    )
    reply = await agent.run("Was my 08:12 from Oxford to Paddington late yesterday?")

    assert calls == [
        {
            "origin_crs": "OXF",
            "destination_crs": "PAD",
            "travel_date": "2026-10-23",
            "departure": "08:12",
        }
    ]
    assert "38 minutes" in reply.text
    assert len(seen) == 2  # the tool result went back to the model


async def test_model_name_override_used() -> None:
    seen, transport = recorded("chat_completion.json")

    await Agent(client=runpod_client("ep123", "rp-key", transport=transport)).run("hi")

    assert seen[0].url.path == "/v2/ep123/openai/v1/chat/completions"
    assert json.loads(seen[0].content)["model"] == "tempo-private"
