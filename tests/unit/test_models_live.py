"""TEMPO_MODELS and the honesty badge (plan.md §13): the model-backed parts may be live while the
data is replayed, and the badge drops "jurors" or "vision" only when they really run on a model."""

from __future__ import annotations

from typing import Any

import pytest

from tempo_adapters.factory import model_ready, models_live, vision_ready
from tempo_adapters.settings import Settings
from tempo_gateway.chat import simulated_in

pytestmark = pytest.mark.unit

RUNPOD = {"runpod_endpoint_id": "ep123", "runpod_api_key": "rp-test-key"}


def settings(**extra: Any) -> Settings:
    return Settings(_env_file=None, **extra)  # type: ignore[call-arg]


def test_models_follow_the_mode_unless_set() -> None:
    assert not models_live(settings())
    assert models_live(settings(tempo_mode="live"))
    assert models_live(settings(tempo_models="live"))
    assert not models_live(settings(tempo_mode="live", tempo_models="replay"))


def test_replay_says_everything_but_the_voice_is_recorded() -> None:
    assert simulated_in(settings()) == ["company", "rail data", "jurors", "vision"]


def test_the_gpu_demo_is_honest_about_what_is_real() -> None:
    gpu = settings(tempo_deploy="cloud-gpu", tempo_models="live", **RUNPOD)
    assert model_ready(gpu) and vision_ready(gpu)
    assert simulated_in(gpu) == ["company", "rail data"]


def test_without_the_endpoint_nothing_claims_to_be_real() -> None:
    unconfigured = settings(tempo_deploy="cloud-gpu", tempo_models="live")
    assert not model_ready(unconfigured) and not vision_ready(unconfigured)
    assert simulated_in(unconfigured) == ["company", "rail data", "jurors", "vision"]


def test_private_mode_never_reads_photos_with_a_model() -> None:
    private = settings(tempo_deploy="cloud-private", tempo_models="live", **RUNPOD)
    assert model_ready(private) and not vision_ready(private)
    assert simulated_in(private) == ["company", "rail data", "vision"]


def test_live_mode_keeps_its_old_meaning() -> None:
    assert simulated_in(settings(tempo_mode="live")) == ["company"]
