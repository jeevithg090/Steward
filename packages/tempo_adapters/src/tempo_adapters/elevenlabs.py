"""ElevenLabs Agents: voice agent configs as code, and the calls Tempo makes to the API.

Our YAML schema (`AgentConfig`) is ours and stable. `to_elevenlabs_payload` is the only place that
knows ElevenLabs' payload shape, and every field there is marked (check) until it's been tried
against the live API. Each server tool points at a Gateway route under /voice/tools/ and sends
the shared secret the Gateway checks.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
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
# A name is never required: one the caller didn't say would be a name the model made up.
_GIVEN_NAME: dict[str, Any] = {
    "type": "string",
    "description": "Only a name the caller said they want to be called. Leave it out if they "
    "haven't said one: never guess or make one up.",
}
_CALLER: dict[str, Any] = {
    "user_id": {"type": "string", "description": "The caller's id ({{caller_id}})"},
    "phone": {"type": "string", "description": "The caller's number ({{system__caller_id}})"},
}
TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "create_mission": {
        "description": "Start a rail Delay Repay mission once you have all the journey details.",
        "properties": {
            "user_id": {"type": "string", "description": "The caller's id ({{caller_id}})"},
            "display_name": _GIVEN_NAME,
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
    "recall_memories": {
        "description": "What Tempo remembers about the caller: the top 5, with dates and sources.",
        "properties": {**_CALLER},
        "required": ["user_id"],
    },
    "forget_memory": {
        "description": "Delete something Tempo remembers, everywhere, when the caller asks.",
        "properties": {
            **_CALLER,
            "thing": {"type": "string", "description": "What to forget, in their words"},
        },
        "required": ["user_id", "thing"],
    },
    "confirm_memory": {
        "description": "The caller's yes or no to 'Shall I remember this about you?'",
        "properties": {
            **_CALLER,
            "approved": {"type": "boolean", "description": "True only for a clear yes"},
        },
        "required": ["user_id", "approved"],
    },
    "issue_mandate": {
        "description": "After a clear yes from the caller, issue a mandate for this claim only.",
        "properties": {
            **_MISSION,
            "display_name": _GIVEN_NAME,
        },
        "required": ["mission_id"],
    },
    "present_mandate": {
        "description": "When the company asks who authorised you: get your mandate id to read out.",
        "properties": _MISSION,
        "required": ["mission_id"],
    },
    "check_message": {
        "description": "Scam Shield: the caller reads out a text or message they are unsure of. "
        "Pass their words; say back exactly what the tool returns in `say`.",
        "properties": {
            **_CALLER,
            "text": {"type": "string", "description": "The message, as the caller read it out"},
            "sender": {
                "type": "string",
                "description": "Who it says it is from, if they said (a bank, HMRC, a number)",
            },
        },
        "required": ["text"],
    },
    "verify_mandate": {
        "description": "Company line: check the caller's mandate before you do anything it asks.",
        "properties": {
            "mandate_id": {"type": "string", "description": "The id the caller read out (md_...)"},
            "action": {
                "type": "string",
                "description": "What they want: claim, call, accept_cash, accept_voucher, "
                "discuss_other_accounts, change_contract, share_personal_data or escalate",
            },
            "counterparty": {"type": "string", "description": "Your company's name"},
            "amount_gbp": {"type": "string", "description": "The amount, if money is involved"},
        },
        "required": ["mandate_id", "action", "counterparty"],
    },
}


# What a call's conversation-initiation answer may change (the Patience Profile). ElevenLabs only
# accepts an override for a field the agent enables, so each agent lists the ones it allows.
OVERRIDABLE = frozenset(
    {
        "agent.language",
        "agent.first_message",
        "agent.prompt.prompt",
        "tts.voice_id",
        "tts.speed",
        "tts.stability",
        "tts.similarity_boost",
        "asr.keywords",
    }
)
_VARIABLE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")


class Voice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    voice_id_env: str  # the .env variable holding the ElevenLabs voice id
    # ~100 ms and 90+ languages (Hindi, Punjabi, Polish, Urdu, Welsh among them); the default for
    # new ElevenAgents since Sep 2026. eleven_flash_v2_5 has 32 and no Punjabi, Urdu or Welsh.
    model: str = "eleven_v4_turbo"


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn_timeout_s: float = Field(default=12.0, ge=1, le=30)  # long: never rush a caller
    silence_end_call_s: int = Field(default=120, ge=10)
    # Turn-taking can't be changed per call, so a line for everyone is patient for everyone.
    eagerness: Literal["patient", "normal", "eager"] = "normal"
    model: Literal["turn_v2", "turn_v3"] = "turn_v3"


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
    languages: tuple[str, ...] = ()  # more languages it can switch to (voice/greetings.yaml)
    overrides: tuple[str, ...] = ()  # what each call's initiation answer may change
    initiation_webhook: bool = False  # inbound: ask the Gateway how to speak with each caller
    variable_defaults: dict[str, str] = {}  # placeholders for previews and tests

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
        bad_overrides = set(self.overrides) - OVERRIDABLE
        if bad_overrides:
            raise ValueError(f"unknown overrides: {sorted(bad_overrides)}")
        if self.initiation_webhook and self.kind != "inbound":
            raise ValueError("only an inbound agent asks the Gateway how to speak with a caller")
        if any(not re.fullmatch(r"[a-z]{2}", c) or c == self.language for c in self.languages):
            raise ValueError("languages are two-letter codes other than the agent's own")
        used = set(_VARIABLE.findall(self.prompt + self.first_message))
        undeclared = {v for v in used if not v.startswith("system__")} - set(self.dynamic_variables)
        if undeclared:
            raise ValueError(f"declare the dynamic variables you use: {sorted(undeclared)}")
        return self


def load_agent_config(path: Path) -> AgentConfig:
    return AgentConfig.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def load_greetings(path: Path) -> dict[str, str]:
    """The inbound agent's first message by language code (voice/greetings.yaml), or {}."""
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {str(code): str(text) for code, text in (data.get("greetings") or {}).items()}


def render_prompt(config: AgentConfig, variables: dict[str, str]) -> str:
    """Fill the {{dynamic_variables}} the way ElevenLabs does, for text-mode runs and evals."""
    prompt = config.prompt
    for name, value in variables.items():
        prompt = prompt.replace("{{" + name + "}}", value)
    return prompt


def _nested_flags(paths: tuple[str, ...]) -> dict[str, Any]:
    """("agent.prompt.prompt", "tts.speed") -> {"agent": {"prompt": {"prompt": True}}, ...}."""
    flags: dict[str, Any] = {}
    for path in paths:
        *parents, leaf = path.split(".")
        node = flags
        for key in parents:
            node = node.setdefault(key, {})
        node[leaf] = True
    return flags


def to_elevenlabs_payload(
    config: AgentConfig,
    *,
    voice_id: str,
    gateway_url: str,
    tool_secret: str,
    greetings: Mapping[str, str] | None = None,
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
    agent: dict[str, Any] = {
        "first_message": config.first_message,
        "language": config.language,
        "prompt": {"prompt": config.prompt, "llm": config.llm, "tools": tools},
    }
    if config.variable_defaults:  # (check) where the placeholders live in the agent schema
        agent["dynamic_variables"] = {"dynamic_variable_placeholders": config.variable_defaults}
    conversation_config: dict[str, Any] = {
        "agent": agent,
        "tts": {"voice_id": voice_id, "model_id": config.voice.model},
        "turn": {
            "turn_timeout": config.turn.turn_timeout_s,
            "silence_end_call_timeout": config.turn.silence_end_call_s,
            "turn_eagerness": config.turn.eagerness,
            "turn_model": config.turn.model,
        },
        "conversation": {"max_duration_seconds": config.max_call_minutes * 60},
    }
    if config.languages:
        greetings = greetings or {}
        conversation_config["language_presets"] = {
            code: {
                "overrides": {
                    "agent": {"language": code}
                    | ({"first_message": greetings[code]} if code in greetings else {})
                }
            }
            for code in config.languages
        }
    payload: dict[str, Any] = {"name": config.name, "conversation_config": conversation_config}
    if config.overrides or config.initiation_webhook:
        webhook_on = config.initiation_webhook
        settings: dict[str, Any] = {
            "overrides": {
                "conversation_config_override": _nested_flags(config.overrides),
                "enable_conversation_initiation_client_data_from_webhook": webhook_on,
            }
        }
        if config.initiation_webhook:
            settings["workspace_overrides"] = {
                "conversation_initiation_client_data_webhook": {
                    "url": f"{gateway_url.rstrip('/')}/voice/initiation",
                    "request_headers": {"X-Tempo-Voice-Secret": tool_secret},  # (check)
                }
            }
        payload["platform_settings"] = settings
    return payload


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
