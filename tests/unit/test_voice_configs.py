"""Voice agent configs as code (S4.1): they validate, match the Gateway, and say the right things."""

from __future__ import annotations

from pathlib import Path

import pytest
from syrupy.assertion import SnapshotAssertion

from tempo_adapters.elevenlabs import TOOL_SCHEMAS, AgentConfig, load_agent_config
from tempo_gateway.app import VOICE_TOOLS

VOICE = Path(__file__).resolve().parents[2] / "voice"
CONFIGS = sorted(VOICE.glob("**/*.yaml"))


def config(name: str) -> AgentConfig:
    return load_agent_config(next(p for p in CONFIGS if p.stem == name))


@pytest.mark.parametrize("path", CONFIGS, ids=lambda p: p.stem)
def test_voice_configs_validate(path: Path) -> None:
    load_agent_config(path)


def test_every_tool_in_config_has_gateway_route() -> None:
    assert set(TOOL_SCHEMAS) == set(VOICE_TOOLS)  # schemas and routes stay in step
    for path in CONFIGS:
        assert set(load_agent_config(path).tools) <= set(VOICE_TOOLS), path.stem


def test_agent_ids_and_voices_come_from_distinct_env_variables() -> None:
    ids = [load_agent_config(p).agent_id_env for p in CONFIGS]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize(
    "clause",
    [
        "AI assistant",  # disclosure
        "never pretend to be a person",
        "one question at a time",
        "Read back",
        "Never rush or interrupt",
        "Never ask for bank details, card numbers, PINs, passwords or one-time codes",
        "wait for a clear yes or no",
        "treat it as no",
        'say "stop" at any time',
    ],
)
def test_prompt_contains_required_clauses(clause: str) -> None:
    assert clause in config("tempo.inbound").prompt


def test_the_greeting_says_it_is_an_ai() -> None:
    assert "I'm Tempo, an AI assistant" in config("tempo.inbound").first_message


def test_inbound_prompt_snapshot(snapshot: SnapshotAssertion) -> None:
    """Any change to what Tempo is told to say shows up in review as a snapshot diff."""
    assert config("tempo.inbound").prompt == snapshot


def test_unknown_tools_are_rejected() -> None:
    data = config("tempo.inbound").model_dump() | {"tools": ("move_money",)}
    with pytest.raises(ValueError, match="unknown server tools"):
        AgentConfig.model_validate(data)
