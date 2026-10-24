import pytest
from hypothesis import given
from hypothesis import strategies as st

from tempo_adapters.cortex.router import (
    CAREFUL_MODEL,
    FAST_MODEL,
    Engine,
    EngineSetting,
    Task,
    juror_models,
    route,
    supports_tools,
)

CORTEX_MODELS = [
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "openai-gpt-5-mini",
    "llama4-maverick",
    "mistral-large2",
    "deepseek-v4-flash",
]


def test_auto_routes_letters_fast_and_money_carefully() -> None:
    assert route(Task.LETTER) == FAST_MODEL
    assert route(Task.MONEY_JUDGEMENT) == CAREFUL_MODEL
    assert route(Task.TOOL_LOOP) == CAREFUL_MODEL


def test_the_persons_engine_setting_is_respected() -> None:
    assert route(Task.MONEY_JUDGEMENT, EngineSetting(Engine.FAST)) == FAST_MODEL
    assert route(Task.LETTER, EngineSetting(Engine.CAREFUL)) == CAREFUL_MODEL
    picked = EngineSetting(Engine.PICK, "mistral-large2")
    assert route(Task.LETTER, picked) == "mistral-large2"


@given(
    engine=st.sampled_from(list(Engine)),
    picked=st.one_of(st.sampled_from(CORTEX_MODELS), st.text(min_size=1, max_size=20)),
)
def test_router_never_uses_non_tool_model_for_tool_loop(engine: Engine, picked: str) -> None:
    setting = EngineSetting(engine, picked if engine is Engine.PICK else None)

    assert supports_tools(route(Task.TOOL_LOOP, setting))


def test_pick_needs_a_model() -> None:
    with pytest.raises(ValueError, match="picked_model"):
        EngineSetting(Engine.PICK)


def test_jurors_come_from_three_different_providers() -> None:
    providers = {model.split("-")[0] for model in juror_models()}
    assert len(juror_models()) == 3
    assert len(providers) == 3
