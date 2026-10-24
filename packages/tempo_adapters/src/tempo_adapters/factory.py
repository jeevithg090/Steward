"""What sits behind each port for the chosen TEMPO_DEPLOY mode (build plan S8.1).

Only the chosen mode's model client can be built, so in Private mode there is no code path to
Cortex, and voice and vision (outside AI companies) are switched off.
"""

from __future__ import annotations

from dataclasses import dataclass

from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI

from tempo_adapters.cortex import PatTokenProvider, cortex_client
from tempo_adapters.runpod_llm import PRIVATE_MODEL, runpod_base_url, runpod_client
from tempo_adapters.settings import Settings
from tempo_core.config import Profile, profile


class NotConfigured(RuntimeError):
    """The mode needs settings that aren't there; nothing falls back to another provider."""


@dataclass(frozen=True)
class ModelEndpoint:
    kind: str  # the profile's model: ollama, cortex, runpod-vllm, tee-vllm
    base_url: str | None
    model: str
    processor: str  # who runs the model, in plain words


@dataclass(frozen=True)
class Adapters:
    profile: Profile
    model: ModelEndpoint
    voice: str
    vision: str
    memory: str
    vault: str


def model_endpoint(settings: Settings, chosen: Profile) -> ModelEndpoint:
    match chosen.model:
        case "cortex":
            return ModelEndpoint("cortex", settings.cortex_base_url, settings.cortex_fast_model,
                                 "Snowflake (Cortex)")  # fmt: skip
        case "ollama":
            return ModelEndpoint("ollama", settings.ollama_base_url, settings.ollama_model,
                                 "this machine (Ollama)")  # fmt: skip
        case "runpod-vllm":
            url = (
                runpod_base_url(settings.runpod_endpoint_id)
                if settings.runpod_endpoint_id
                else None
            )
            return ModelEndpoint("runpod-vllm", url, PRIVATE_MODEL, "our own model on RunPod")
        case _:
            return ModelEndpoint("tee-vllm", settings.confidential_base_url, "tempo-confidential",
                                 "our own model inside a TEE")  # fmt: skip


def build_adapters(settings: Settings) -> Adapters:
    chosen = profile(settings.tempo_deploy)
    return Adapters(
        profile=chosen, model=model_endpoint(settings, chosen), voice=chosen.voice,
        vision=chosen.vision, memory=chosen.memory, vault=chosen.vault,
    )  # fmt: skip


def chat_client(settings: Settings, adapters: Adapters) -> OpenAIChatCompletionClient:
    """The one model client this mode may use."""
    endpoint = adapters.model
    if endpoint.kind == "cortex":
        if not (settings.snowflake_account and settings.snowflake_pat):
            raise NotConfigured("cloud-standard needs SNOWFLAKE_ACCOUNT and SNOWFLAKE_PAT")
        tokens = PatTokenProvider(lambda: settings.snowflake_pat)
        return cortex_client(endpoint.model, account=settings.snowflake_account, tokens=tokens)
    if endpoint.kind == "runpod-vllm":
        if not (settings.runpod_endpoint_id and settings.runpod_api_key):
            raise NotConfigured("cloud-private needs RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY")
        key = settings.runpod_api_key.get_secret_value()
        return runpod_client(settings.runpod_endpoint_id, key)
    if endpoint.base_url is None:
        raise NotConfigured(f"{adapters.profile.mode} needs a model URL")
    openai = AsyncOpenAI(api_key="local", base_url=endpoint.base_url)  # Ollama or the TEE
    return OpenAIChatCompletionClient(endpoint.model, async_client=openai)
