"""Our own open-weight model on RunPod Serverless vLLM: Private mode (build plan S8.2).

The worker serves an OpenAI-compatible API under one model name, "tempo-private", whatever
model is behind it (OPENAI_SERVED_MODEL_NAME_OVERRIDE, deploy/runpod/worker.env). The RunPod key
is held by the control plane only; it never reaches a device.
"""

from __future__ import annotations

import httpx
from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI

PRIVATE_MODEL = "tempo-private"
TIMEOUT = httpx.Timeout(60.0, connect=10.0)  # a cold start can take a while; scale-to-zero


def runpod_base_url(endpoint_id: str) -> str:
    """(check) RunPod's OpenAI-compatible route for a Serverless vLLM endpoint."""
    return f"https://api.runpod.ai/v2/{endpoint_id}/openai/v1"


def openai_compat_client(
    base_url: str,
    api_key: str,
    model: str,
    *,
    headers: dict[str, str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> OpenAIChatCompletionClient:
    """A MAF chat client for any OpenAI-compatible route (RunPod vLLM, Gemini, OpenRouter).
    Always over our own httpx client, so the timeout is ours and tests can intercept it."""
    http = httpx.AsyncClient(transport=transport, timeout=TIMEOUT, headers=headers)
    openai = AsyncOpenAI(api_key=api_key, base_url=base_url, http_client=http, timeout=TIMEOUT)
    return OpenAIChatCompletionClient(model, async_client=openai)


def runpod_client(
    endpoint_id: str,
    api_key: str,
    *,
    model: str = PRIVATE_MODEL,
    transport: httpx.AsyncBaseTransport | None = None,
) -> OpenAIChatCompletionClient:
    """A MAF chat client for the private endpoint; `transport` is for tests."""
    return openai_compat_client(runpod_base_url(endpoint_id), api_key, model, transport=transport)
