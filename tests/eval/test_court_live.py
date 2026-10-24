"""Live Consensus Court eval: 15 interpretation cases on three Cortex models (`make evals`)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
import yaml

from tempo_adapters.cortex import CortexJuror, PatTokenProvider, cortex_client, juror_models
from tempo_adapters.settings import Settings
from tempo_core.models import Fact
from tempo_missions.court import ConsensusCourt, CourtOutcome
from tempo_ports.court import CaseQuestion

CASES = yaml.safe_load(
    (Path(__file__).resolve().parents[2] / "evals" / "court" / "cases.yaml").read_text()
)
settings = Settings()
pytestmark = pytest.mark.skipif(
    not (settings.snowflake_account and settings.snowflake_pat),
    reason="needs SNOWFLAKE_ACCOUNT and SNOWFLAKE_PAT",
)


async def test_the_court_agrees_and_is_never_unanimously_wrong(
    record_eval: Callable[..., None],
) -> None:
    assert settings.snowflake_account is not None
    tokens = PatTokenProvider(lambda: settings.snowflake_pat)
    court = ConsensusCourt(
        [
            CortexJuror(cortex_client(m, account=settings.snowflake_account, tokens=tokens), name=m)
            for m in juror_models()
        ]
    )
    unanimous = correct = unanimous_wrong = 0
    for case in CASES:
        decision = await court.decide(
            CaseQuestion(
                mission_id=case["id"],
                question=case["question"],
                rule_id=case["rule_id"],
                rule_text=case["rule_text"],
                facts=tuple(
                    Fact(key=k, value=str(v), source="eval case", confidence=1.0)
                    for k, v in case["facts"].items()
                ),
            )
        )
        right = decision.eligible == case["expected_eligible"]
        correct += right
        if decision.outcome is CourtOutcome.PROCEED and not decision.absent:
            unanimous += 1
            unanimous_wrong += not right

    scores = {"agreement": unanimous / len(CASES), "accuracy": correct / len(CASES)}
    record_eval("consensus_court", scores)
    assert scores["agreement"] >= 0.8
    assert unanimous_wrong == 0
