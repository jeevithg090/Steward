"""The Cortex adapter against fixture responses, through MAF's real client (httpx.MockTransport)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from agent_framework import Message
from pydantic import BaseModel, SecretStr

from tempo_adapters.cortex import PatTokenProvider, cortex_client, structured
from tempo_core.errors import ModelAuthExpired, ModelOutputInvalid

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "cortex"
URL = "https://acme-test.snowflakecomputing.com/api/v2/cortex/v1/chat/completions"

Handler = Callable[[httpx.Request], httpx.Response]


def fixture(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text())
    return data


def completion(content: str) -> dict[str, Any]:
    body = fixture("chat_completion_ok.json")
    body["choices"][0]["message"]["content"] = content
    return body


class Tokens:
    """A token provider whose refresh hands out the next token, and counts refreshes."""

    def __init__(self, *tokens: str) -> None:
        self._tokens = list(tokens)
        self.refreshes = 0

    def current(self) -> str:
        return self._tokens[0]

    def refresh(self) -> str:
        self.refreshes += 1
        self._tokens.pop(0)
        return self._tokens[0]


def scripted(*bodies: dict[str, Any]) -> tuple[Handler, list[httpx.Request]]:
    """Answer requests with `bodies` in order (all HTTP 200, like Cortex), recording each one."""
    seen: list[httpx.Request] = []
    queue = list(bodies)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=queue.pop(0))

    return handler, seen


def client(handler: Handler, tokens: Any) -> Any:
    return cortex_client(
        "claude-haiku-5-5",
        account="acme-test",
        tokens=tokens,
        transport=httpx.MockTransport(handler),
    )


async def ask(c: Any) -> str:
    response = await c.get_response([Message("user", ["Say ok"])])
    text: str = response.text
    return text


async def test_chat_completion_happy_path() -> None:
    handler, seen = scripted(fixture("chat_completion_ok.json"))

    assert await ask(client(handler, Tokens("pat-1"))) == "ok"

    [request] = seen
    assert str(request.url) == URL
    assert request.headers["authorization"] == "Bearer pat-1"
    assert request.headers["x-snowflake-authorization-token-type"] == "PROGRAMMATIC_ACCESS_TOKEN"
    assert json.loads(request.content)["model"] == "claude-haiku-5-5"


async def test_token_expiry_390112_refreshes_and_retries_once() -> None:
    handler, seen = scripted(
        fixture("token_expired_390112.json"), fixture("chat_completion_ok.json")
    )
    tokens = Tokens("pat-old", "pat-new")

    assert await ask(client(handler, tokens)) == "ok"

    assert tokens.refreshes == 1
    assert [r.headers["authorization"] for r in seen] == ["Bearer pat-old", "Bearer pat-new"]
    assert seen[0].content == seen[1].content  # the same request, retried


async def test_second_failure_raises_not_loops() -> None:
    handler, seen = scripted(
        fixture("token_expired_390112.json"), fixture("token_expired_390112.json")
    )
    tokens = Tokens("pat-old", "pat-new")

    with pytest.raises(Exception) as err:
        await ask(client(handler, tokens))

    assert len(seen) == 2
    assert tokens.refreshes == 1
    chain = [err.value, err.value.__cause__, err.value.__context__]
    assert any(isinstance(e, ModelAuthExpired) for e in chain)


async def test_the_refreshed_token_is_used_for_later_requests() -> None:
    handler, seen = scripted(
        fixture("token_expired_390112.json"),
        fixture("chat_completion_ok.json"),
        fixture("chat_completion_ok.json"),
    )
    c = client(handler, Tokens("pat-old", "pat-new"))

    await ask(c)
    await ask(c)

    assert seen[-1].headers["authorization"] == "Bearer pat-new"


def test_pat_provider_rereads_the_token_on_refresh() -> None:
    stored = {"pat": SecretStr("pat-1")}
    tokens = PatTokenProvider(lambda: stored["pat"])

    stored["pat"] = SecretStr("pat-2")  # a teammate rotates the PAT in .env

    assert tokens.current() == "pat-1"
    assert tokens.refresh() == "pat-2"


def test_pat_provider_needs_a_token() -> None:
    with pytest.raises(ModelAuthExpired, match="SNOWFLAKE_PAT"):
        PatTokenProvider(lambda: None)


def test_timeout_is_set() -> None:
    handler, _ = scripted()
    c = client(handler, Tokens("pat"))

    timeout = c.client.timeout
    assert timeout.read <= 30
    assert timeout.connect <= 30
    assert c.client.max_retries <= 1


class Verdict(BaseModel):
    eligible: bool
    rule_id: str


async def test_structured_output_parses_json_even_in_a_code_fence() -> None:
    handler, seen = scripted(completion('```json\n{"eligible": true, "rule_id": "dr15"}\n```'))

    verdict = await structured(client(handler, Tokens("pat")), "Is this eligible?", Verdict)

    assert verdict == Verdict(eligible=True, rule_id="dr15")
    body = json.loads(seen[0].content)
    assert body["response_format"]["type"] == "json_schema"
    assert '"rule_id"' in body["messages"][-1]["content"]  # the schema is in the prompt too


async def test_invalid_json_repaired_once() -> None:
    handler, seen = scripted(
        completion('{"eligible": "maybe"}'), completion('{"eligible": false, "rule_id": "dr15"}')
    )

    verdict = await structured(client(handler, Tokens("pat")), "Is this eligible?", Verdict)

    assert verdict.eligible is False
    assert len(seen) == 2
    repair = json.loads(seen[1].content)["messages"][-1]["content"]
    assert repair.startswith("Your last reply was not valid JSON")


async def test_invalid_json_repaired_once_then_raises() -> None:
    handler, seen = scripted(completion("not json"), completion('{"eligible": true}'))

    with pytest.raises(ModelOutputInvalid, match="Verdict still invalid after one repair"):
        await structured(client(handler, Tokens("pat")), "Is this eligible?", Verdict)

    assert len(seen) == 2
