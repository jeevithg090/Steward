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
NVIDIA = "https://integrate.api.nvidia.com/v1"
PROVIDER_NAMES = {"nvidia": "NVIDIA", "openrouter": "OpenRouter"}


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
            who = ["Google Gemini", *(PROVIDER_NAMES[p] for p in sorted(court_providers(settings)))]
            return ModelEndpoint("apis", GEMINI_OPENAI, first, " and ".join(who))
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


@dataclass(frozen=True)
class Seat:
    juror: str  # the name the Court shows
    provider: str  # gemini, nvidia or openrouter
    model: str  # the provider's model id


def court_seats(settings: Settings) -> list[Seat]:
    """cloud-apis' three jurors: Gemini models, with outside models (NVIDIA's first, then
    OpenRouter's) taking every other seat, so each provider's rate limit carries less."""
    gemini = [Seat(m, "gemini", m) for m in _names(settings.gemini_juror_models)]
    outside: list[Seat] = []
    if settings.nvidia_api_key is not None:
        outside += [Seat(m.split("/")[-1], "nvidia", m) for m in _names(settings.nvidia_models)]
    if settings.openrouter_api_key is not None:
        outside += [Seat(m.split("/")[-1].removesuffix(":free"), "openrouter", m)
                    for m in _names(settings.openrouter_models)]  # fmt: skip
    mixed = [s for pair in zip(gemini, outside, strict=False) for s in pair]
    mixed += gemini[len(outside) :] + outside[len(gemini) :]
    return mixed[:3]


def court_providers(settings: Settings) -> frozenset[str]:
    """The outside AI companies, beyond Gemini, that really sit on the Court (a key alone seats
    nobody): the Privacy Proof names them."""
    if profile(settings.tempo_deploy).model != "apis":
        return frozenset()
    return frozenset(s.provider for s in court_seats(settings)) - {"gemini"}


def brain_provider(settings: Settings) -> str | None:
    """Who runs the chat's brain (plan.md §16), or None when the rules alone answer."""
    if settings.chat_brain == "off" or settings.nvidia_api_key is None:
        return None
    return "nvidia" if settings.chat_brain == "nvidia" or models_live(settings) else None


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
    own three). cloud-apis seats `court_seats`; elsewhere three jurors share the mode's one
    model."""
    adapters = build_adapters(settings)
    if adapters.model.kind != "apis":
        client = chat_client(settings, adapters)
        return [(f"{adapters.model.kind}-{i}", client) for i in (1, 2, 3)]
    if settings.gemini_api_key is None:
        raise NotConfigured("cloud-apis needs GEMINI_API_KEY")
    keys = {"gemini": settings.gemini_api_key, "nvidia": settings.nvidia_api_key,
            "openrouter": settings.openrouter_api_key}  # fmt: skip
    routes = {"gemini": (GEMINI_OPENAI, None), "nvidia": (NVIDIA, None),
              "openrouter": (OPENROUTER, OPENROUTER_HEADERS)}  # fmt: skip
    jurors = []
    for seat in court_seats(settings):
        key, (url, headers) = keys[seat.provider], routes[seat.provider]
        assert key is not None  # noqa: S101 (court_seats seats a provider only with its key)
        client = openai_compat_client(url, key.get_secret_value(), seat.model, headers=headers)
        jurors.append((seat.juror, client))
    return jurors
