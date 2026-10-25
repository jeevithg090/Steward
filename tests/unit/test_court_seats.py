"""cloud-apis seats (plan.md §13.5): which models sit on the Court, and which outside AI companies
the Privacy Proof must then name. Nothing here calls a model."""

from __future__ import annotations

from typing import Any

import pytest

from tempo_adapters.factory import court_providers, court_seats, model_endpoint
from tempo_adapters.settings import Settings
from tempo_core.config import profile

pytestmark = pytest.mark.unit


def settings(**extra: Any) -> Settings:
    return Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_deploy="cloud-apis", gemini_api_key="g", **extra
    )


def seats(s: Settings) -> list[tuple[str, str]]:
    return [(seat.juror, seat.provider) for seat in court_seats(s)]


def test_gemini_alone_seats_three_gemini_checkpoints() -> None:
    s = settings()
    assert [p for _, p in seats(s)] == ["gemini", "gemini", "gemini"]
    assert court_providers(s) == frozenset()


def test_nvidias_key_seats_its_model_second() -> None:
    s = settings(nvidia_api_key="n")
    assert seats(s) == [
        ("gemini-3.5-flash-lite", "gemini"),
        ("nemotron-3.5-bolt-e4b", "nvidia"),
        ("gemini-3.1-flash-lite-preview", "gemini"),
    ]
    assert court_providers(s) == {"nvidia"}
    assert model_endpoint(s, profile("cloud-apis")).processor == "Google Gemini and NVIDIA"


def test_the_live_demos_seating_one_gemini_and_two_nvidia() -> None:
    """Gemini 3.1 Flash-Lite left to photos: its free bucket is 15 a minute (25 Oct 2026)."""
    s = settings(
        nvidia_api_key="n",
        gemini_juror_models="gemini-3.5-flash-lite",
        nvidia_models="nvidia/nemotron-3.5-bolt-e4b,minimaxai/minimax-m3.1-flash",
    )
    assert seats(s) == [
        ("gemini-3.5-flash-lite", "gemini"),
        ("nemotron-3.5-bolt-e4b", "nvidia"),
        ("minimax-m3.1-flash", "nvidia"),
    ]


def test_a_provider_without_a_seat_is_not_named() -> None:
    """NVIDIA's model goes first, so OpenRouter's has no seat left and the proof leaves it out."""
    s = settings(
        nvidia_api_key="n", openrouter_api_key="o",
        openrouter_models="dots-studio/dots-3-note-preview:free",
    )  # fmt: skip
    assert "openrouter" not in {p for _, p in seats(s)}
    assert court_providers(s) == {"nvidia"}


def test_the_gpu_names_no_outside_juror() -> None:
    s = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_deploy="cloud-gpu", nvidia_api_key="n", gemini_api_key="g"
    )
    assert court_providers(s) == frozenset()
