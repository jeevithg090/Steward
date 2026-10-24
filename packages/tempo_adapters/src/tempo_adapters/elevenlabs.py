"""ElevenLabs Agents: voice agent configs as code, and the calls Tempo makes to the API.

Our YAML schema (`AgentConfig`) is ours and stable. `to_elevenlabs_payload` is the only place that
knows ElevenLabs' payload shape, and every field there is marked (check) until it's been tried
against the live API. Each server tool points at a Gateway route under /voice/tools/ and sends
the shared secret the Gateway checks.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import httpx
import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

API = "https://api.elevenlabs.io/v1"
TIMEOUT = httpx.Timeout(20.0, connect=5.0)

SYSTEM_TOOLS = frozenset(
    {
        "end_call",
        "language_detection",
        "skip_turn",
        "transfer_to_number",
        "play_keypad_touch_tone",
        "voicemail_detection",
    }
)

_MISSION = {"mission_id": {"type": "string", "description": "The mission this is about"}}

# What each Gateway voice tool expects (apps/gateway: POST /voice/tools/{name}).
TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "create_mission": {
        "description": "Start a rail Delay Repay mission once you have all the journey details.",
        "properties": {
            "user_id": {"type": "string", "description": "The caller's id ({{caller_id}})"},
            "display_name": {"type": "string", "description": "What the caller likes to be called"},
            "phone": {
                "type": "string",
                "description": "The caller's number ({{system__caller_id}})",
            },
            "origin_crs": {
                "type": "string",
                "description": "3-letter code of the station left from",
            },
            "destination_crs": {
                "type": "string",
                "description": "3-letter code of the destination",
            },
            "travel_date": {"type": "string", "description": "YYYY-MM-DD"},
            "departure": {"type": "string", "description": "Timetabled departure, HH:MM"},
            "fare_gbp": {"type": "string", "description": "What the ticket cost, in pounds"},
        },
        "required": [
            "user_id",
            "display_name",
            "origin_crs",
            "destination_crs",
            "travel_date",
            "departure",
            "fare_gbp",
        ],
    },
    "get_case_capsule": {
        "description": "Where a mission is, and what to say about it.",
        "properties": _MISSION,
        "required": ["mission_id"],
    },
    "record_consent": {
        "description": "Record the caller's clear yes or no to the question you just read back.",
        "properties": {
            **_MISSION,
            "approved": {"type": "boolean", "description": "True only for a clear yes"},
            "conversation_id": {"type": "string", "description": "{{system__conversation_id}}"},
        },
        "required": ["mission_id", "approved", "conversation_id"],
    },
    "log_stall": {
        "description": "Log a stalling tactic the company used, the moment you hear it.",
        "properties": {
            **_MISSION,
            "category": {"type": "string", "description": "A Stall Radar category"},
            "quote": {"type": "string", "description": "What they said, word for word"},
        },
        "required": ["mission_id", "category", "quote"],
    },
    "record_reference": {
        "description": "Record the case or reference number the company gave.",
        "properties": {**_MISSION, "reference": {"type": "string"}},
        "required": ["mission_id", "reference"],
    },
    "request_human": {
        "description": "Ask for the person (or their helper) to decide something you can't.",
        "properties": {**_MISSION, "reason": {"type": "string"}},
        "required": ["mission_id", "reason"],
    },
}


class Voice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    voice_id_env: str  # the .env variable holding the ElevenLabs voice id
    model: str = "eleven_flash_v2_5"  # (check) low-latency TTS model id


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn_timeout_s: float = Field(default=12.0, ge=1, le=30)  # long: never rush a caller
    silence_end_call_s: int = Field(default=120, ge=10)


class AgentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["inbound", "outbound", "arena"]
    name: str
    agent_id_env: str  # the .env variable that holds this agent's ElevenLabs id once created
    language: str = "en"
    detect_language: bool = True
    voice: Voice
    llm: str = "gemini-2.5-flash"  # (check) an LLM ElevenLabs Agents offers
    first_message: str
    prompt: str = Field(min_length=200)
    turn: Turn = Turn()
    max_call_minutes: int = Field(default=20, ge=1, le=60)
    tools: tuple[str, ...] = ()
    system_tools: tuple[str, ...] = ()
    dynamic_variables: tuple[str, ...] = ()
    evil_level: int | None = Field(default=None, ge=1, le=10)  # arena agents only

    @model_validator(mode="after")
    def tools_are_known(self) -> AgentConfig:
        unknown = set(self.tools) - set(TOOL_SCHEMAS)
        if unknown:
            raise ValueError(f"unknown server tools: {sorted(unknown)}")
        bad_system = set(self.system_tools) - SYSTEM_TOOLS
        if bad_system:
            raise ValueError(f"unknown system tools: {sorted(bad_system)}")
        if (self.kind == "arena") != (self.evil_level is not None):
            raise ValueError("arena agents (and only they) set evil_level")
        return self


def load_agent_config(path: Path) -> AgentConfig:
    return AgentConfig.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def to_elevenlabs_payload(
    config: AgentConfig, *, voice_id: str, gateway_url: str, tool_secret: str
) -> dict[str, Any]:
    """(check) The ElevenLabs Agents create/update body for one of our configs."""
    tools: list[dict[str, Any]] = [
        {
            "type": "webhook",
            "name": name,
            "description": TOOL_SCHEMAS[name]["description"],
            "api_schema": {
                "url": f"{gateway_url.rstrip('/')}/voice/tools/{name}",
                "method": "POST",
                "request_headers": {"X-Tempo-Voice-Secret": tool_secret},
                "request_body_schema": {
                    "type": "object",
                    "properties": TOOL_SCHEMAS[name]["properties"],
                    "required": TOOL_SCHEMAS[name]["required"],
                },
            },
        }
        for name in config.tools
    ]
    tools += [{"type": "system", "name": name} for name in config.system_tools]
    return {
        "name": config.name,
        "conversation_config": {
            "agent": {
                "first_message": config.first_message,
                "language": config.language,
                "prompt": {"prompt": config.prompt, "llm": config.llm, "tools": tools},
            },
            "tts": {"voice_id": voice_id, "model_id": config.voice.model},
            "turn": {
                "turn_timeout": config.turn.turn_timeout_s,
                "silence_end_call_timeout": config.turn.silence_end_call_s,
            },
            "conversation": {"max_duration_seconds": config.max_call_minutes * 60},
        },
    }


class ElevenLabsClient:
    def __init__(self, http: httpx.AsyncClient, *, api_key: str) -> None:
        self._http = http
        self._headers = {"xi-api-key": api_key}

    async def save_agent(self, payload: dict[str, Any], agent_id: str | None = None) -> str:
        """Create the agent, or update it in place when it already has an id."""
        if agent_id:
            url, method = f"{API}/convai/agents/{agent_id}", "PATCH"
        else:
            url, method = f"{API}/convai/agents/create", "POST"
        response = await self._http.request(
            method, url, json=payload, headers=self._headers, timeout=TIMEOUT
        )
        response.raise_for_status()
        return agent_id or str(response.json()["agent_id"])

    async def start_outbound_call(
        self, *, agent_id: str, phone_number_id: str, to_number: str, variables: dict[str, str]
    ) -> str:
        """(check) Ring `to_number` from our Twilio number; returns the conversation id."""
        response = await self._http.post(
            f"{API}/convai/twilio/outbound-call",
            json={
                "agent_id": agent_id,
                "agent_phone_number_id": phone_number_id,
                "to_number": to_number,
                "conversation_initiation_client_data": {"dynamic_variables": variables},
            },
            headers=self._headers,
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        return str(response.json()["conversation_id"])
