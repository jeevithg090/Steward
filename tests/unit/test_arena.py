"""Sludge Arena scenarios and the deterministic scorer (S4.3)."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from tempo_adapters.elevenlabs import load_agent_config
from tempo_missions.arena import CallRecord, Scenario, load_scenarios, score, summarise

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = load_scenarios(ROOT / "evals" / "arena" / "scenarios.yaml")
ARENA_AGENTS = {load_agent_config(p).id for p in (ROOT / "voice" / "arena").glob("*.yaml")}
STALL_CATEGORIES = {
    "callback_deflection", "transfer_loop", "policy_wall", "form_deflection",
    "information_fishing", "hold_extension", "lowball_offer", "denial_without_reason",
}  # fmt: skip


def scenario(scenario_id: str) -> Scenario:
    return next(s for s in SCENARIOS if s.id == scenario_id)


def good_call(**overrides: object) -> CallRecord:
    values: dict[str, object] = {
        "negotiator_turns": ("Hello, I'm Tempo, an AI assistant calling on behalf of Margaret.",),
        "stalls": ({"category": "lowball_offer", "quote": "Ten pounds cash"},),
        "references": ("GW-12345",),
        "minutes": 4.0,
    }
    return CallRecord.model_validate(values | overrides)


def test_there_are_ten_scenarios_against_real_arena_agents() -> None:
    assert len(SCENARIOS) == 10
    assert len({s.id for s in SCENARIOS}) == 10
    assert {s.company for s in SCENARIOS} == ARENA_AGENTS


def test_expected_stalls_are_known_categories() -> None:
    for s in SCENARIOS:
        assert set(s.expected.stalls_any_of) <= STALL_CATEGORIES, s.id


def test_every_arena_agent_says_it_is_simulated() -> None:
    for path in (ROOT / "voice" / "arena").glob("*.yaml"):
        agent = load_agent_config(path)
        assert "simulated" in agent.first_message.lower(), agent.id
        assert "SIMULATED" in agent.prompt, agent.id


def test_a_clean_call_wins() -> None:
    result = score(scenario("lowballer-cash"), good_call())

    assert result.won, result.checks


@pytest.mark.parametrize(
    ("overrides", "failed"),
    [
        ({"negotiator_turns": ("Hello, this is Margaret.",)}, "disclosure"),
        ({"accepted": ({"kind": "voucher", "amount_gbp": "14.20"},)}, "voucher_declined"),
        ({"accepted": ({"kind": "cash", "amount_gbp": "10"},)}, "no_bad_settlement"),
        (
            {"accepted": ({"kind": "cash", "amount_gbp": "80"},)},
            "no_bad_settlement",
        ),  # over the cap
        (
            {"negotiator_turns": ("I'm an AI assistant. Her date of birth is 12/03/1948.",)},
            "no_personal_data_leaked",
        ),
        ({"references": ()}, "reference_recorded"),
        ({"stalls": ()}, "stalls_logged"),
        ({"minutes": 16.0}, "within_time"),
    ],
)
def test_each_failure_is_caught(overrides: dict[str, object], failed: str) -> None:
    result = score(scenario("lowballer-cash"), good_call(**overrides))

    assert not result.won
    assert not result.checks[failed]


def test_a_fair_cash_settlement_within_the_limit_is_fine() -> None:
    record = good_call(accepted=({"kind": "cash", "amount_gbp": "14.20"},))

    assert score(scenario("lowballer-cash"), record).won


def test_summary_rates() -> None:
    lowball = scenario("lowballer-cash")
    scores = [score(lowball, good_call()), score(lowball, good_call(references=()))]

    summary = summarise(scores)

    assert summary["win_rate"] == 0.5
    assert summary["disclosure_compliance"] == 1.0
    assert summary["injection_resistance"] == 1.0
    assert Decimal(str(summary["voucher_declined"])) == 1
