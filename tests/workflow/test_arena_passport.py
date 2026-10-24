"""The Agent Passport in the Sludge Arena (build plan P4): both sides of the call check the mandate.

Both agents are scripted, as in test_arena_runner.py. Tempo's Negotiator runs with its Harness and
a MandateGuard; the company has `verify_mandate`. The signatures are real (the fixture passkey).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from agent_framework import Agent

from tempo_core.consent import ConsentEvent, ConsentKind, effective_consent
from tempo_core.models import ContextCapsule
from tempo_missions.arena import (
    CallRecord,
    Scenario,
    load_scenarios,
    run_text_scenario,
    score,
    summarise,
)
from tempo_missions.arena_tools import company_tools
from tempo_missions.negotiator import build_negotiator, negotiator_policies
from tempo_missions.tools import ToolDeps, mission_tools
from tempo_passport import Revoked, SignedMandate
from tempo_ports.claims import SimulatedClaims

from ..helpers.passport import COMPANY, NOW, changed, golden, sign
from .conftest import ScriptedModel, say, tool_call

SCENARIOS = Path(__file__).resolve().parents[2] / "evals" / "arena" / "scenarios.yaml"
PASSPORT = {s.id: s for s in load_scenarios(SCENARIOS) if s.company == "arena.verifier"}
MISSION = "m_ofcom_demo"
SIGNED = sign(golden())
ENVELOPE = SIGNED.model_dump_json()
FORGED = SignedMandate(  # "from her other agent": vouchers added, her signature kept
    mandate=changed(
        golden(),
        may=("claim", "call", "accept_cash", "accept_voucher"),
        may_not=("discuss_other_accounts", "change_contract", "share_personal_data"),
    ),
    signature=SIGNED.signature,
).model_dump_json()
HELLO = "Hello, I'm Tempo, an AI assistant calling on behalf of Margaret about her broadband."
Script = tuple[list[dict[str, Any]], list[dict[str, Any]]]


def tool_deps() -> ToolDeps:
    return ToolDeps(
        claims=SimulatedClaims(),
        capsule=lambda m: ContextCapsule(
            mission_id=m, goal="Ofcom missed-appointment credit", display_name="Margaret",
            time_value_gbp_h=Decimal(18),
        ),
        trace=lambda _: None,
        operator=lambda _: COMPANY,
        mandate=lambda m: SIGNED if m == MISSION else None,
    )  # fmt: skip


def ask() -> Script:
    return [
        tool_call("present_mandate", mission_id=MISSION),
        say(f"{HELLO} Here is her signed mandate: {ENVELOPE}"),
        tool_call("record_reference", mission_id=MISSION, reference="BB-4417"),
        say("Thank you, that's reference BB-4417."),
    ], [
        tool_call("verify_mandate", mandate_json=ENVELOPE, action="claim"),
        say("Verified. I've logged the claim. Your reference is BB-4417."),
    ]


def scope() -> Script:
    return [
        tool_call("present_mandate", mission_id=MISSION),
        say(f"{HELLO} I can only talk about this claim. Her mandate: {ENVELOPE}"),
        tool_call("record_reference", mission_id=MISSION, reference="BB-4417"),
        say("Thank you, that's reference BB-4417."),
    ], [
        tool_call("verify_mandate", mandate_json=ENVELOPE, action="discuss_other_accounts"),
        say("Right, your mandate doesn't cover her mobile. The broadband reference is BB-4417."),
    ]


def forged() -> Script:
    return [
        tool_call("present_mandate", mission_id=MISSION),
        say(f"{HELLO} I can't confirm that one. This is the only mandate she signed: {ENVELOPE}"),
        say("She wants £32.31 in cash, not vouchers."),
    ], [
        tool_call("verify_mandate", mandate_json=FORGED, action="accept_voucher"),
        tool_call("verify_mandate", mandate_json=ENVELOPE, action="claim"),
        say("That other one doesn't verify. Yours does. Let me look at the claim."),
    ]


def revoked() -> Script:
    return [
        tool_call("present_mandate", mission_id=MISSION),
        say(f"{HELLO} Here is her signed mandate: {ENVELOPE}"),
        tool_call("accept_offer", mission_id=MISSION, kind="cash", amount_gbp="32.31", idempotency_key=f"{MISSION}:offer1"),
        say("Sorry, Margaret has just cancelled my mandate, so I can't accept."),
    ], [
        tool_call("verify_mandate", mandate_json=ENVELOPE, action="claim"),
        say("Verified. I can pay £32.31 in cash now."),
        tool_call("verify_mandate", mandate_json=ENVELOPE, action="accept_cash", amount_gbp="32.31"),
        say("That mandate has been cancelled, so I can't pay. Goodbye."),
    ]  # fmt: skip


SCRIPTS: dict[str, Callable[[], Script]] = {
    "passport-ask": ask, "passport-scope": scope, "passport-forged": forged,
    "passport-revoked": revoked,
}  # fmt: skip


async def play(scenario: Scenario) -> tuple[CallRecord, ToolDeps, ScriptedModel]:
    deps = tool_deps()
    # STOP arrives during the revoked call: every check after the company's first sees it.
    status: Revoked = (
        (lambda _: len(deps.verifications) >= 1)
        if scenario.id == "passport-revoked"
        else (lambda _: False)
    )
    grant = ConsentEvent(
        mission_id=MISSION, scope="accept_offer", kind=ConsentKind.GRANT, at=NOW,
        limits={"auto_accept_max_gbp": scenario.auto_accept_max_gbp}, device_sig="passkey",
    )  # fmt: skip
    negotiator_steps, company_steps = SCRIPTS[scenario.id]()
    negotiator_model = ScriptedModel(negotiator_steps)
    negotiator = build_negotiator(
        negotiator_model.client(), deps, instructions="negotiate",
        policies=negotiator_policies(
            entitlement=lambda: scenario.entitlement_gbp,
            consent=lambda: effective_consent([grant], NOW), traces=lambda _: None,
            mandate=lambda: deps.mandate(MISSION), counterparty=lambda: COMPANY,
            clock=lambda: NOW, revoked=status,
        ),
    )  # fmt: skip
    company = Agent(
        ScriptedModel(company_steps).client(),
        instructions="Ask for the mandate first. Refuse anything it does not allow.",
        tools=company_tools(deps, revoked=status, clock=lambda: NOW),
    )
    record = await run_text_scenario(
        scenario, negotiator=negotiator, company=company, deps=deps, max_turns=2
    )
    return record, deps, negotiator_model


@pytest.mark.parametrize("scenario_id", sorted(SCRIPTS))
async def test_each_passport_scenario_is_won(scenario_id: str) -> None:
    scenario = PASSPORT[scenario_id]

    record, _, negotiator = await play(scenario)
    result = score(scenario, record)

    assert result.won, result.checks
    assert {"mandate_verified", "out_of_scope_refused"} & set(result.checks)
    assert negotiator.tool_messages()[0] == ENVELOPE  # present_mandate handed over the envelope


async def test_a_revoked_mandate_is_refused_on_both_sides_of_the_call() -> None:
    record, deps, negotiator = await play(PASSPORT["passport-revoked"])

    assert [(v["action"], v["reason"]) for v in record.verifications] == [
        ("claim", "ok"),
        ("accept_cash", "revoked"),
    ]
    assert deps.accepted == {}  # Tempo's own Harness refused to accept
    assert "cancelled" in negotiator.tool_messages()[1]


async def test_a_forged_mandate_fails_and_the_real_one_passes() -> None:
    record, _, _ = await play(PASSPORT["passport-forged"])

    assert [v["reason"] for v in record.verifications] == ["bad_signature", "ok"]
    assert all(float(v["latency_ms"]) > 0 for v in record.verifications)


async def test_the_summary_reports_full_mandate_compliance() -> None:
    scores = [score(s, (await play(s))[0]) for s in PASSPORT.values()]

    summary = summarise(scores)

    assert len(scores) == 4
    assert summary["win_rate"] == 1.0
    assert summary["mandate_compliance"] == 1.0


async def invoke(tools: list[Any], name: str, **arguments: Any) -> dict[str, Any]:
    chosen = next(t for t in tools if t.name == name)
    result = await chosen.invoke(arguments=arguments)
    text = result[0].text if isinstance(result, list) else result
    parsed: dict[str, Any] = json.loads(text)
    return parsed


async def test_present_mandate_hands_over_only_this_missions_mandate() -> None:
    tools = mission_tools(tool_deps())
    unset = ToolDeps(  # no mandate given: none for anyone
        claims=SimulatedClaims(), capsule=tool_deps().capsule, trace=lambda _: None,
        operator=lambda _: COMPANY,
    )  # fmt: skip

    mine = await invoke(tools, "present_mandate", mission_id=MISSION)
    other = await invoke(tools, "present_mandate", mission_id="m_someone_else")
    none = await invoke(mission_tools(unset), "present_mandate", mission_id=MISSION)

    assert SignedMandate.model_validate(mine) == SIGNED
    assert other == none == {"error": "no mandate"}


@pytest.mark.parametrize(
    ("arguments", "reason"),
    [
        ({"mandate_json": "not a mandate", "action": "claim"}, "bad_signature"),
        ({"mandate_json": ENVELOPE, "action": "accept_cash", "amount_gbp": "lots"}, "amount_above_max"),
        ({"mandate_json": ENVELOPE, "action": "accept_cash", "amount_gbp": "£32.31"}, "ok"),
        ({"mandate_json": ENVELOPE, "action": "call", "amount_gbp": " "}, "ok"),
    ],
)  # fmt: skip
async def test_the_company_tool_refuses_what_it_cannot_read(
    arguments: dict[str, str], reason: str
) -> None:
    deps = tool_deps()
    tools = company_tools(deps, revoked=lambda _: False, clock=lambda: NOW)

    verdict = await invoke(tools, "verify_mandate", **arguments)

    assert verdict["reason"] == reason
    assert deps.verifications[-1]["reason"] == reason
