"""ElevenLabs payloads and calls against a mock transport (S4.1 sync, S4.2 outbound calls)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from tempo_adapters.elevenlabs import (
    ElevenLabsClient,
    load_agent_config,
    load_greetings,
    to_elevenlabs_payload,
)

VOICE = Path(__file__).resolve().parents[2] / "voice"
INBOUND = VOICE / "agents" / "tempo.inbound.yaml"


def payload() -> dict:
    return to_elevenlabs_payload(
        load_agent_config(INBOUND),
        voice_id="voice_123",
        gateway_url="https://tempo.example.test/",
        tool_secret="s3cret",
    )


def test_server_tools_point_at_the_gateway_with_the_secret() -> None:
    tools = payload()["conversation_config"]["agent"]["prompt"]["tools"]
    webhooks = {t["name"]: t for t in tools if t["type"] == "webhook"}

    assert set(webhooks) == {
        "create_mission",
        "get_case_capsule",
        "record_consent",
        "request_human",
        "recall_memories",
        "forget_memory",
        "confirm_memory",
    }
    consent = webhooks["record_consent"]["api_schema"]
    assert consent["url"] == "https://tempo.example.test/voice/tools/record_consent"
    assert consent["request_headers"] == {"X-Tempo-Voice-Secret": "s3cret"}
    assert consent["request_body_schema"]["required"] == [
        "mission_id",
        "approved",
        "conversation_id",
    ]
    assert {t["name"] for t in tools if t["type"] == "system"} == {
        "end_call",
        "language_detection",
        "skip_turn",
    }


def test_turn_taking_is_patient_and_calls_are_capped() -> None:
    config = payload()["conversation_config"]

    assert config["turn"]["turn_timeout"] >= 10
    assert config["conversation"]["max_duration_seconds"] == 20 * 60
    assert config["tts"]["voice_id"] == "voice_123"


async def test_save_agent_creates_then_updates() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"agent_id": "agent_new"})

    client = ElevenLabsClient(
        httpx.AsyncClient(transport=httpx.MockTransport(handle)), api_key="xi"
    )

    created = await client.save_agent(payload())
    updated = await client.save_agent(payload(), "agent_old")

    assert (created, updated) == ("agent_new", "agent_old")
    assert [(r.method, r.url.path) for r in seen] == [
        ("POST", "/v1/convai/agents/create"),
        ("PATCH", "/v1/convai/agents/agent_old"),
    ]
    assert seen[0].headers["xi-api-key"] == "xi"


async def test_outbound_call_payload_shape() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200, json={"success": True, "conversation_id": "conv_42", "callSid": "CA1"}
        )

    client = ElevenLabsClient(
        httpx.AsyncClient(transport=httpx.MockTransport(handle)), api_key="xi"
    )

    conversation = await client.start_outbound_call(
        agent_id="agent_neg",
        phone_number_id="phnum_1",
        to_number="+15550100999",
        variables={"mission_id": "m_1", "display_name": "Margaret"},
    )

    assert conversation == "conv_42"
    [request] = seen
    assert request.url.path == "/v1/convai/twilio/outbound-call"
    assert json.loads(request.content) == {
        "agent_id": "agent_neg",
        "agent_phone_number_id": "phnum_1",
        "to_number": "+15550100999",
        "conversation_initiation_client_data": {
            "dynamic_variables": {"mission_id": "m_1", "display_name": "Margaret"}
        },
    }


def test_the_inbound_agent_asks_the_gateway_how_to_speak_with_each_caller() -> None:
    body = to_elevenlabs_payload(
        load_agent_config(INBOUND), voice_id="voice_123", gateway_url="https://tempo.example.test/",
        tool_secret="s3cret", greetings=load_greetings(VOICE / "greetings.yaml"),
    )  # fmt: skip
    platform = body["platform_settings"]

    assert platform["overrides"]["conversation_config_override"] == {
        "agent": {"language": True, "first_message": True},
        "tts": {"voice_id": True, "speed": True, "stability": True},
        "asr": {"keywords": True},
    }
    assert platform["overrides"]["enable_conversation_initiation_client_data_from_webhook"]
    webhook = platform["workspace_overrides"]["conversation_initiation_client_data_webhook"]
    assert webhook == {
        "url": "https://tempo.example.test/voice/initiation",
        "request_headers": {"X-Tempo-Voice-Secret": "s3cret"},
    }
    config = body["conversation_config"]
    assert (config["turn"]["turn_eagerness"], config["tts"]["model_id"]) == (
        "patient", "eleven_v4_turbo",
    )  # fmt: skip
    presets = config["language_presets"]
    assert sorted(presets) == ["cy", "hi", "pa", "pl", "ur"]
    assert presets["hi"]["overrides"]["agent"]["language"] == "hi"
    assert "Tempo" in presets["hi"]["overrides"]["agent"]["first_message"]
    placeholders = config["agent"]["dynamic_variables"]["dynamic_variable_placeholders"]
    assert placeholders["patience"] == "normal"


def test_agents_that_do_not_ask_have_no_platform_overrides() -> None:
    for name in ("agents/negotiator.outbound.yaml", "arena/staller.yaml"):
        body = to_elevenlabs_payload(
            load_agent_config(VOICE / name), voice_id="v", gateway_url="https://t.test",
            tool_secret="s",
        )  # fmt: skip
        assert "platform_settings" not in body, name
        assert "language_presets" not in body["conversation_config"], name
