"""Which Cortex model handles which job, respecting the person's "AI engine" setting (spec §11).

Only Claude and OpenAI models can call tools on Cortex, so a tool loop never goes anywhere else,
whatever the person picked.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

FAST_MODEL = "claude-haiku-5-5"  # letters, summaries
CAREFUL_MODEL = "claude-sonnet-5-5"  # money and eligibility; tool loops
# Three providers, so one model's blind spot can't decide a case alone.
JUROR_MODELS: tuple[str, str, str] = ("claude-sonnet-5-5", "openai-gpt-5-mini", "llama4-maverick")
TOOL_CALLING_PREFIXES = ("claude-", "openai-")


class Task(StrEnum):
    LETTER = "letter"
    MONEY_JUDGEMENT = "money_judgement"
    TOOL_LOOP = "tool_loop"


class Engine(StrEnum):
    AUTO = "auto"
    FAST = "fast"
    CAREFUL = "careful"
    PICK = "pick"


@dataclass(frozen=True)
class EngineSetting:
    engine: Engine = Engine.AUTO
    picked_model: str | None = None  # only for Engine.PICK

    def __post_init__(self) -> None:
        if self.engine is Engine.PICK and not self.picked_model:
            raise ValueError("Engine.PICK needs a picked_model")


AUTO_ROUTES = {
    Task.LETTER: FAST_MODEL,
    Task.MONEY_JUDGEMENT: CAREFUL_MODEL,
    Task.TOOL_LOOP: CAREFUL_MODEL,
}


def supports_tools(model: str) -> bool:
    return model.startswith(TOOL_CALLING_PREFIXES)


def route(task: Task, setting: EngineSetting | None = None) -> str:
    setting = setting or EngineSetting()
    if setting.engine is Engine.PICK and setting.picked_model:
        model = setting.picked_model
    elif setting.engine is Engine.FAST:
        model = FAST_MODEL
    elif setting.engine is Engine.CAREFUL:
        model = CAREFUL_MODEL
    else:
        model = AUTO_ROUTES[task]
    if task is Task.TOOL_LOOP and not supports_tools(model):
        return CAREFUL_MODEL
    return model


def juror_models() -> tuple[str, str, str]:
    return JUROR_MODELS
