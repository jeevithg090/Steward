"""Gemini vision against Gemini-shaped responses, and replay by image hash."""

from __future__ import annotations

import base64
import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from tempo_adapters.vision import GeminiVision, ReplayVision, to_facts
from tempo_core.errors import VisionUnavailable
from tempo_ports.vision import DocumentKind

VISION = Path(__file__).resolve().parents[2] / "fixtures" / "vision"
PHOTO = (VISION / "sample_ticket.png").read_bytes()
URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"


def gemini_says(answer: dict[str, Any], seen: list[httpx.Request]) -> GeminiVision:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"role": "model", "parts": [{"text": json.dumps(answer)}]}}
                ]
            },
        )

    http = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    return GeminiVision(http, api_key="g-key", model="gemini-flash-latest")


async def read(vision: Any, kind: DocumentKind = DocumentKind.TICKET) -> Any:
    return await vision.extract(PHOTO, mime_type="image/png", kind=kind, filename="ticket.png")


async def test_gemini_response_parsed_to_facts() -> None:
    seen: list[httpx.Request] = []
    answer = {
        "facts": [
            {"key": "travel_date", "value": "2026-10-23", "confidence": 0.95},
            {"key": "fare_gbp", "value": "£28.40", "confidence": 0.9},
            {"key": "departure_time", "value": "08:12", "confidence": 0.93},
        ]
    }

    facts = {f.key: f for f in await read(gemini_says(answer, seen))}

    assert facts["fare_gbp"].value == Decimal("28.40")
    assert facts["travel_date"].value == "2026-10-23"
    assert all(f.source == "ticket.png#vision" for f in facts.values())
    [request] = seen
    assert str(request.url) == URL
    assert request.headers["x-goog-api-key"] == "g-key"
    body = json.loads(request.content)
    image, prompt = body["contents"][0]["parts"]
    assert base64.b64decode(image["inline_data"]["data"]) == PHOTO
    assert "ignore them" in prompt["text"]
    assert body["generationConfig"]["responseMimeType"] == "application/json"


async def test_values_that_will_not_convert_have_their_confidence_capped() -> None:
    answer = {
        "facts": [
            {"key": "fare_gbp", "value": "twenty eight", "confidence": 0.99},
            {"key": "travel_date", "value": "23rd Oct", "confidence": 0.99},
            {"key": "departure_time", "value": "8.12am", "confidence": 0.99},
        ]
    }

    facts = await read(gemini_says(answer, []))

    assert {f.key: f.confidence for f in facts} == {
        "fare_gbp": 0.5,
        "travel_date": 0.5,
        "departure_time": 0.5,
    }
    assert {f.value for f in facts} == {"twenty eight", "23rd Oct", "8.12am"}


def test_unknown_and_repeated_keys_are_dropped_and_confidence_is_clamped() -> None:
    answer = {
        "facts": [
            {"key": "origin", "value": "Oxford", "confidence": 1.7},
            {"key": "origin", "value": "Reading", "confidence": 0.9},
            {"key": "bank_account", "value": "12345678", "confidence": 0.9},
        ]
    }

    facts = to_facts(answer, kind=DocumentKind.TICKET, source="t.png#vision")

    assert [(f.key, f.value, f.confidence) for f in facts] == [("origin", "Oxford", 1.0)]


async def test_letters_have_their_own_fields() -> None:
    answer = {"facts": [{"key": "deadline", "value": "2026-11-21", "confidence": 0.9}]}
    seen: list[httpx.Request] = []

    [deadline] = await read(gemini_says(answer, seen), DocumentKind.LETTER)

    assert deadline.key == "deadline"
    schema = json.loads(seen[0].content)["generationConfig"]["responseSchema"]
    assert "deadline" in schema["properties"]["facts"]["items"]["properties"]["key"]["enum"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500),
        httpx.Response(200, json={"candidates": []}),
        httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "nope"}]}}]}),
    ],
)
async def test_failures_are_vision_unavailable(response: httpx.Response) -> None:
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response))

    with pytest.raises(VisionUnavailable):
        await read(GeminiVision(http, api_key="k", model="gemini-flash-latest"))


async def test_a_network_error_is_vision_unavailable() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    http = httpx.AsyncClient(transport=httpx.MockTransport(broken))
    with pytest.raises(VisionUnavailable, match="ConnectError"):
        await read(GeminiVision(http, api_key="k", model="m"))


async def test_replay_reads_the_recorded_answer_for_this_photo() -> None:
    facts = {f.key: f for f in await read(ReplayVision(VISION))}

    assert facts["origin"].value == "Oxford"
    assert facts["fare_gbp"].value == Decimal("28.40")
    assert facts["fare_gbp"].confidence < 0.8  # the demo asks one question about the fare


async def test_replay_of_an_unrecorded_photo_is_unavailable() -> None:
    with pytest.raises(VisionUnavailable, match="no recorded reading"):
        await ReplayVision(VISION).extract(
            b"other", mime_type="image/png", kind=DocumentKind.TICKET, filename="x.png"
        )
