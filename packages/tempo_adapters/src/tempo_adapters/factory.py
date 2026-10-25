"""What sits behind each port for the chosen TEMPO_DEPLOY mode (build plan S8.1).

Only the chosen mode's model client can be built, so in Private mode there is no code path to
Cortex, and voice and vision (outside AI companies) are switched off.
"""

from __future__ import annotations

from dataclasses import dataclass

from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI

from tempo_adapters.cortex import PatTokenProvider, cortex_client
from tempo_adapters.runpod_llm import (
    PRIVATE_MODEL,
    openai_compat_client,
    runpod_base_url,
    runpod_client,
)
from tempo_adapters.settings import Settings
from tempo_core.config import Profile, profile

GEMINI_OPENAI = "https://generativelanguage.googleapis.com/v1beta/openai/"
OPENROUTER = "https://openrouter.ai/api/v1"
OPENROUTER_HEADERS = {"HTTP-Referer": "https://github.com/jeevithg090/Tempo", "X-Title": "Tempo"}


def _names(csv: str) -> list[str]:
    return [n.strip() for n in csv.split(",") if n.strip()]


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
        case "apis":
            first = (_names(settings.gemini_juror_models) or ["gemini-3.1-flash-lite"])[0]
            return ModelEndpoint("apis", GEMINI_OPENAI, first, "Google Gemini and OpenRouter")
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
    if endpoint.kind == "apis":
        if settings.gemini_api_key is None:
            raise NotConfigured("cloud-apis needs GEMINI_API_KEY (OPENROUTER_API_KEY is optional)")
        return openai_compat_client(
            GEMINI_OPENAI, settings.gemini_api_key.get_secret_value(), endpoint.model
        )
    if endpoint.kind == "runpod-vllm":
        if not (settings.runpod_endpoint_id and settings.runpod_api_key):
            raise NotConfigured("cloud-private needs RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY")
        key = settings.runpod_api_key.get_secret_value()
        return runpod_client(settings.runpod_endpoint_id, key)
    if endpoint.base_url is None:
        raise NotConfigured(f"{adapters.profile.mode} needs a model URL")
    openai = AsyncOpenAI(api_key="local", base_url=endpoint.base_url)  # Ollama or the TEE
    return OpenAIChatCompletionClient(endpoint.model, async_client=openai)


def models_live(settings: Settings) -> bool:
    """The model-backed parts run on a real model: TEMPO_MODELS, else TEMPO_MODE."""
    return (settings.tempo_models or settings.tempo_mode) == "live"


def model_ready(settings: Settings) -> bool:
    """The deployment's model can be called now (its settings are there). No network."""
    try:
        chat_client(settings, build_adapters(settings))
    except NotConfigured:
        return False
    return True


def vision_ready(settings: Settings) -> bool:
    """Photos are read by a real model now: our own vLLM (cloud-gpu) or Gemini with its key."""
    chosen = profile(settings.tempo_deploy)
    if chosen.vision == "runpod-vllm":
        return bool(settings.runpod_endpoint_id and settings.runpod_api_key)
    return settings.gemini_api_key is not None


def juror_clients(settings: Settings) -> list[tuple[str, OpenAIChatCompletionClient]]:
    """The Consensus Court's three jurors on this mode's own model (not Cortex, which names its
    own three). cloud-apis mixes providers, Gemini and OpenRouter in turn, so no single
    company's model decides alone; elsewhere three jurors share the mode's one model."""
    adapters = build_adapters(settings)
    if adapters.model.kind != "apis":
        client = chat_client(settings, adapters)
        return [(f"{adapters.model.kind}-{i}", client) for i in (1, 2, 3)]
    if settings.gemini_api_key is None:
        raise NotConfigured("cloud-apis needs GEMINI_API_KEY")
    gemini_key = settings.gemini_api_key.get_secret_value()
    gemini = [(m, openai_compat_client(GEMINI_OPENAI, gemini_key, m))
              for m in _names(settings.gemini_juror_models)]  # fmt: skip
    hosted: list[tuple[str, OpenAIChatCompletionClient]] = []
    if settings.openrouter_api_key is not None:
        key = settings.openrouter_api_key.get_secret_value()
        hosted = [
            (m.split("/")[-1].removesuffix(":free"),
             openai_compat_client(OPENROUTER, key, m, headers=OPENROUTER_HEADERS))
            for m in _names(settings.openrouter_models)
        ]  # fmt: skip
    mixed = [j for pair in zip(gemini, hosted, strict=False) for j in pair]
    mixed += gemini[len(hosted) :] + hosted[len(gemini) :]
    return mixed[:3]
