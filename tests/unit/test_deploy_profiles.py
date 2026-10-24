"""Deployment profiles and the adapter factory (S8.1)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from tempo_adapters import factory
from tempo_adapters.factory import NotConfigured, build_adapters, chat_client
from tempo_adapters.settings import Settings
from tempo_core.config import DeployMode, UnknownDeployMode, profile

WORKER_ENV = Path(__file__).resolve().parents[2] / "deploy" / "runpod" / "worker.env"


def settings(mode: str, **extra: Any) -> Settings:
    return Settings(_env_file=None, tempo_deploy=mode, **extra)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    ("mode", "model", "voice", "vision", "third_parties"),
    [
        ("local", "ollama", "elevenlabs", "off", {"elevenlabs"}),  # only with the user's own key
        ("cloud-standard", "cortex", "elevenlabs", "gemini", {"cortex", "elevenlabs", "gemini"}),
        ("cloud-private", "runpod-vllm", "off", "off", set()),
        ("cloud-confidential", "tee-vllm", "off", "off", set()),
    ],
)
def test_factory_returns_expected_adapters_per_mode(
    mode: str, model: str, voice: str, vision: str, third_parties: set[str]
) -> None:
    adapters = build_adapters(settings(mode))

    assert (adapters.model.kind, adapters.voice, adapters.vision) == (model, voice, vision)
    assert adapters.profile.third_parties == third_parties


def test_private_mode_has_no_third_party_ai_processors(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_cortex(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Private mode reached the Cortex adapter")

    monkeypatch.setattr(factory, "cortex_client", no_cortex)
    configured = settings(
        "cloud-private", runpod_endpoint_id="ep123", runpod_api_key="rp-key",
        snowflake_account="acct", snowflake_pat="pat",  # Cortex is configured, and still unused
    )  # fmt: skip
    adapters = build_adapters(configured)

    client = chat_client(configured, adapters)

    assert adapters.model.processor == "our own model on RunPod"
    assert str(client.client.base_url).startswith("https://api.runpod.ai/v2/ep123/openai/v1")
    assert client.model == "tempo-private"
    with pytest.raises(NotConfigured):  # no RunPod keys: refuse, never fall back to Cortex
        chat_client(settings("cloud-private", snowflake_account="acct", snowflake_pat="pat"),
                    build_adapters(settings("cloud-private")))  # fmt: skip


def test_each_mode_builds_only_its_own_client() -> None:
    local = settings("local")
    standard = settings("cloud-standard", snowflake_account="acct", snowflake_pat="pat")

    assert chat_client(local, build_adapters(local)).model == "qwen3:8b"
    assert "snowflakecomputing.com" in str(
        chat_client(standard, build_adapters(standard)).client.base_url
    )
    with pytest.raises(NotConfigured):
        chat_client(settings("cloud-standard"), build_adapters(settings("cloud-standard")))
    with pytest.raises(NotConfigured):
        chat_client(settings("cloud-confidential"), build_adapters(settings("cloud-confidential")))


def test_unknown_mode_fails_fast() -> None:
    with pytest.raises(UnknownDeployMode, match="cloud-private"):
        profile("cloud-privat")
    assert profile("cloud-private").mode is DeployMode.PRIVATE


def test_worker_env_disables_request_logging() -> None:
    env = dict(
        line.split("=", 1) for line in WORKER_ENV.read_text().splitlines()
        if line and not line.startswith("#")
    )  # fmt: skip

    assert env["DISABLE_LOG_REQUESTS"] == "true"
    assert env["ENABLE_PREFIX_CACHING"] == "false"  # no cache shared between people
    assert env["OPENAI_SERVED_MODEL_NAME_OVERRIDE"] == "tempo-private"
    assert env["VLLM_NO_USAGE_STATS"] == "1"
