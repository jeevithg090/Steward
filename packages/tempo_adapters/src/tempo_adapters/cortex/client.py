"""Snowflake Cortex through its OpenAI-compatible Chat Completions API (docs/adr/0002).

Cortex quirk: an expired token comes back as HTTP 200 with error code 390112, a body the OpenAI
SDK cannot parse. CortexTransport catches it at the HTTP layer, refreshes the token once and
retries; a second expiry raises ModelAuthExpired instead of looping.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Protocol

import httpx
from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI
from pydantic import SecretStr

from tempo_core.errors import ModelAuthExpired

SESSION_EXPIRED_CODE = "390112"
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
MAX_RETRIES = 1  # at most 2 attempts in total (CONTRIBUTING rule 4)
# (check) Snowflake documents this header for programmatic access tokens.
TOKEN_TYPE_HEADERS = {"X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN"}


class TokenProvider(Protocol):
    def current(self) -> str: ...

    def refresh(self) -> str: ...


class PatTokenProvider:
    """A programmatic access token. Refreshing re-reads it, so a rotated PAT needs no restart."""

    def __init__(self, load: Callable[[], SecretStr | None]) -> None:
        self._load = load
        self._token = self._read()

    def current(self) -> str:
        return self._token

    def refresh(self) -> str:
        self._token = self._read()
        return self._token

    def _read(self) -> str:
        secret = self._load()
        if secret is None:
            raise ModelAuthExpired("SNOWFLAKE_PAT is not set")
        return secret.get_secret_value()


class CortexTransport(httpx.AsyncBaseTransport):
    """Owns the Authorization header and turns Cortex's HTTP 200 token-expired body into a retry."""

    def __init__(
        self, tokens: TokenProvider, inner: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._tokens = tokens
        self._inner = inner or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._inner.handle_async_request(
            self._authorised(request, self._tokens.current())
        )
        if not await _token_expired(response):
            return response
        await response.aclose()
        retry = self._authorised(request, self._tokens.refresh())
        response = await self._inner.handle_async_request(retry)
        if await _token_expired(response):
            await response.aclose()
            raise ModelAuthExpired("Snowflake token expired (390112) again after a refresh")
        return response

    async def aclose(self) -> None:
        await self._inner.aclose()

    @staticmethod
    def _authorised(request: httpx.Request, token: str) -> httpx.Request:
        headers = httpx.Headers(request.headers)
        headers["Authorization"] = f"Bearer {token}"
        return httpx.Request(
            request.method,
            request.url,
            headers=headers,
            content=request.content,
            extensions=request.extensions,
        )


async def _token_expired(response: httpx.Response) -> bool:
    # Only small JSON bodies can carry the error; streamed answers pass straight through.
    if response.status_code != 200 or "json" not in response.headers.get("content-type", ""):
        return False
    await response.aread()
    try:
        body = json.loads(response.content)
    except ValueError:
        return False
    return isinstance(body, dict) and str(body.get("code", "")) == SESSION_EXPIRED_CODE


def cortex_base_url(account: str) -> str:
    return f"https://{account}.snowflakecomputing.com/api/v2/cortex/v1"


def cortex_client(
    model: str,
    *,
    account: str,
    tokens: TokenProvider,
    transport: httpx.AsyncBaseTransport | None = None,
) -> OpenAIChatCompletionClient:
    """A MAF chat client for one Cortex model. `transport` is for tests (httpx.MockTransport)."""
    http = httpx.AsyncClient(transport=CortexTransport(tokens, transport), timeout=TIMEOUT)
    openai = AsyncOpenAI(
        api_key=tokens.current(),  # replaced per request by CortexTransport
        base_url=cortex_base_url(account),
        http_client=http,
        timeout=TIMEOUT,
        max_retries=MAX_RETRIES,
        default_headers=TOKEN_TYPE_HEADERS,
    )
    return OpenAIChatCompletionClient(model, async_client=openai)
