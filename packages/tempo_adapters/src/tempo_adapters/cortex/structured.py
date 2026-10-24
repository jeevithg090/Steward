"""Structured model output: a Pydantic schema in, a validated object out, or a typed error.

One repair attempt, then ModelOutputInvalid. Models only ever read and plan here; nothing they
return can set an amount (docs/adr/0003).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from agent_framework import Message
from pydantic import BaseModel, ValidationError

from tempo_core.errors import ModelOutputInvalid

_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)

REPAIR = (
    "Your last reply was not valid JSON for the schema. The error was: {error}\n"
    "Reply again with only the corrected JSON object, nothing else."
)


class _Response(Protocol):
    @property
    def text(self) -> str: ...


class ChatClient(Protocol):
    async def get_response(
        self, messages: Sequence[Message], *, options: Mapping[str, Any] | None = None
    ) -> _Response: ...


async def structured[T: BaseModel](
    client: ChatClient, prompt: str, schema: type[T], *, use_response_format: bool = True
) -> T:
    """Ask for JSON matching `schema`. The schema is also in the prompt, so this still works where
    a provider ignores `response_format` (check Cortex's support for JSON-schema outputs)."""
    options: dict[str, Any] = {"response_format": schema} if use_response_format else {}
    messages = [Message("user", [_with_schema(prompt, schema)])]
    reply = (await client.get_response(messages, options=options)).text
    try:
        return _parse(reply, schema)
    except ValidationError as first:
        messages += [
            Message("assistant", [reply]),
            Message("user", [REPAIR.format(error=_short(first))]),
        ]
        repaired = (await client.get_response(messages, options=options)).text
        try:
            return _parse(repaired, schema)
        except ValidationError as second:
            raise ModelOutputInvalid(
                f"{schema.__name__} still invalid after one repair: {_short(second)}"
            ) from second


def _with_schema(prompt: str, schema: type[BaseModel]) -> str:
    return (
        f"{prompt}\n\nReply with only a JSON object matching this JSON schema:\n"
        f"{json.dumps(schema.model_json_schema(), separators=(',', ':'))}"
    )


def _parse[T: BaseModel](text: str, schema: type[T]) -> T:
    match = _FENCE.match(text)
    return schema.model_validate_json(match.group(1) if match else text)


def _short(error: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(map(str, e['loc'])) or 'body'}: {e['msg']}" for e in error.errors()
    )[:300]
