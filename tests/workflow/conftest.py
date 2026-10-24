"""A scripted model: MAF's real OpenAI client and tool loop, with answers served from a script."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI


def tool_call(name: str, **args: Any) -> dict[str, Any]:
    return {"tool": name, "args": args}


def say(text: str) -> dict[str, Any]:
    return {"text": text}


def _completion(step: dict[str, Any], n: int) -> dict[str, Any]:
    if "tool" in step:
        message: dict[str, Any] = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": f"call_{n}",
                    "type": "function",
                    "function": {"name": step["tool"], "arguments": json.dumps(step["args"])},
                }
            ],
        }
        finish = "tool_calls"
    else:
        message, finish = {"role": "assistant", "content": step["text"]}, "stop"
    return {
        "id": f"cmpl_{n}",
        "object": "chat.completion",
        "created": 1,
        "model": "scripted",
        "choices": [{"index": 0, "finish_reason": finish, "message": message}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


@dataclass
class ScriptedModel:
    steps: list[dict[str, Any]]
    requests: list[dict[str, Any]] = field(default_factory=list)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        step = self.steps[min(len(self.requests), len(self.steps)) - 1]
        return httpx.Response(200, json=_completion(step, len(self.requests)))

    def client(self) -> OpenAIChatCompletionClient:
        http = httpx.AsyncClient(transport=httpx.MockTransport(self.handle))
        openai = AsyncOpenAI(api_key="test", base_url="https://model.test/v1", http_client=http)
        return OpenAIChatCompletionClient("scripted", async_client=openai)

    def tool_messages(self) -> list[str]:
        """Every tool result the model was shown, in order (the last request holds them all)."""
        if not self.requests:
            return []
        return [
            str(m.get("content")) for m in self.requests[-1]["messages"] if m.get("role") == "tool"
        ]


@pytest.fixture
def scripted() -> Callable[..., ScriptedModel]:
    return lambda *steps: ScriptedModel(list(steps))
