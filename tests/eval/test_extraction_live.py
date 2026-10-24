"""Live extraction eval: 20 synthetic tickets and letters through Gemini (`make evals`)."""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
import yaml

from tempo_adapters.settings import Settings
from tempo_adapters.vision import GeminiVision
from tempo_ports.vision import DocumentKind

SET = Path(__file__).resolve().parents[2] / "evals" / "extraction"
EXPECTED = yaml.safe_load((SET / "expected.yaml").read_text())
EXACT = {
    "travel_date",
    "deadline",
    "fare_gbp",
    "amount_gbp",
    "departure_time",
}  # dates, times, money
settings = Settings()
pytestmark = pytest.mark.skipif(settings.gemini_api_key is None, reason="needs GEMINI_API_KEY")


def same(key: str, got: object, want: str) -> bool:
    if key.endswith("_gbp"):
        return isinstance(got, Decimal) and got == Decimal(want)
    if key in EXACT:
        return str(got) == want
    return str(got).casefold().strip() == want.casefold()


async def test_dates_and_amounts_are_read_right(record_eval: Callable[..., None]) -> None:
    assert settings.gemini_api_key is not None
    async with httpx.AsyncClient() as http:
        vision = GeminiVision(
            http, api_key=settings.gemini_api_key.get_secret_value(), model=settings.gemini_model
        )
        exact_hits = exact_total = other_hits = other_total = 0
        for item in EXPECTED:
            image = (SET / "images" / item["file"]).read_bytes()
            facts = {
                f.key: f.value
                for f in await vision.extract(
                    image,
                    mime_type="image/png",
                    kind=DocumentKind(item["kind"]),
                    filename=item["file"],
                )
            }
            for key, want in item["facts"].items():
                hit = same(key, facts.get(key), str(want))
                if key in EXACT:
                    exact_total, exact_hits = exact_total + 1, exact_hits + hit
                else:
                    other_total, other_hits = other_total + 1, other_hits + hit

    scores = {"dates_amounts": exact_hits / exact_total, "other_fields": other_hits / other_total}
    record_eval("extraction", scores)
    assert scores["dates_amounts"] >= 0.95
