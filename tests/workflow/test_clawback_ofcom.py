"""The Ofcom mission with Rights Decay (R4): ask once, wait while waiting pays, act on the day the
plan names, and survive a restart in the middle of the wait."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tempo_adapters.rail import ReplayRail
from tempo_core.hazard import Hazard
from tempo_core.models import Mission
from tempo_core.models import MissionState as S
from tempo_core.rules import RulePackRegistry
from tempo_missions.clawback_ofcom import (
    OfcomRequest,
    build_ofcom_workflow,
    checkpoint_storage,
    resume,
    start,
)
from tempo_missions.clawback_rail import ClawbackDeps, RunResult, SignedApproval, TimerFired
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo

ROOT = Path(__file__).resolve().parents[2]
MISSED = date(2026, 10, 18)
YES = SignedApproval(approved=True, scopes=("file_claim",), device_sig="passkey:iphone")
CURVE = Hazard(
    id="test.curve", source="test curve", n=1000, demo_values=True, pays_share=Decimal("0.55"),
    resolved_by=((0, Decimal(0)), (14, Decimal("0.59")), (30, Decimal("0.78")),
                 (60, Decimal("0.88")), (180, Decimal("0.98"))),
)  # fmt: skip


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 25, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


class Fakes:
    def __init__(self, *, pays_after: timedelta | None = timedelta(0)) -> None:
        self.clock = Clock()
        self.repo = InMemoryRepo()
        self.claims = SimulatedClaims(pays_after=pays_after, clock=self.clock)
        self.credited: set[str] = set()

        async def credit_arrived(mission_id: str) -> bool:
            return mission_id in self.credited

        self.deps = ClawbackDeps(
            repo=self.repo, rail=ReplayRail.from_directory(ROOT / "fixtures/rail/replay"),
            rules=RulePackRegistry.from_directory(ROOT / "skills"), claims=self.claims,
            clock=self.clock, hazards={CURVE.id: CURVE}, credit_arrived=credit_arrived,
            max_payment_checks=2,
        )  # fmt: skip

    async def mission(self, notice_hours: str | None = None) -> OfcomRequest:
        await self.repo.upsert_user("u_1", display_name="Margaret", time_value_gbp_h=Decimal(18))
        await self.repo.create_mission(Mission(
            id="m_1", user_id="u_1", skill_id="clawback.ofcom-missed-appointment",
            goal="Missed engineer visit", entered_state_at=self.clock.now,
        ))  # fmt: skip
        return OfcomRequest(
            mission_id="m_1", user_id="u_1", display_name="Margaret", operator="Broadbandly",
            event_date=MISSED.isoformat(), notice_hours=notice_hours, time_value_gbp_h="18",
            hazard_id=CURVE.id,
        )  # fmt: skip

    def states(self) -> list[str]:
        return [e.to_state.value for e, _ in self.repo.case_events_log]


@pytest.fixture
def storage(tmp_path: Path) -> Any:
    return checkpoint_storage(tmp_path / "checkpoints")


async def fire(fakes: Fakes, storage: Any, result: RunResult) -> RunResult:
    """Play the scheduler: move the clock to the timer and answer it."""
    [(timer_id, timer)] = result.timers
    fakes.clock.now = datetime.fromisoformat(timer.wake_at)
    fired = TimerFired(at=fakes.clock.now.isoformat())
    return await resume(build_ofcom_workflow(fakes.deps, storage), storage, {timer_id: fired})


async def asked_and_approved(fakes: Fakes, storage: Any) -> RunResult:
    first = await start(build_ofcom_workflow(fakes.deps, storage), await fakes.mission())
    [(request_id, _)] = first.pending
    return await resume(build_ofcom_workflow(fakes.deps, storage), storage, {request_id: YES})


async def test_a_week_after_the_visit_tempo_asks_once_and_plans_to_wait(storage: Any) -> None:
    fakes = Fakes()

    first = await start(build_ofcom_workflow(fakes.deps, storage), await fakes.mission())

    [(_, ask)] = first.pending
    assert ask.amount_gbp == "32.31"
    assert ask.summary.startswith("Engineer appointment missed with no notice → £32.31")
    assert "I'll wait for now. You can complain to Broadbandly from 18 November." in ask.summary
    assert ask.summary.endswith("Shall I handle this for you?")
    plan = json.loads(ask.plan_json)
    assert (plan["action_today"], plan["next_decision_on"]) == ("wait", "2026-11-18")
    assert [r["status"] for r in plan["rights"]] == ["opens_later", "locked"]
    assert ask.court_json == ""  # no court in these fakes; the Gateway test sits one


async def test_yes_starts_a_durable_wait_until_the_plans_day(storage: Any) -> None:
    fakes = Fakes()

    waiting = await asked_and_approved(fakes, storage)

    [(_, timer)] = waiting.timers
    assert (timer.reason, timer.attempt) == ("re-plan", 1)
    assert timer.wake_at == "2026-11-18T09:00:00+00:00"  # 09:00 in London, GMT by then
    assert fakes.claims.calls == 0
    assert (await fakes.repo.get_mission("m_1")).state is S.WAITING
    [consent] = fakes.repo.consent_events
    assert consent.expires_at is None  # complaining to the provider has no deadline


async def test_when_the_credit_is_late_tempo_complains_once_and_waits_for_the_money(
    storage: Any,
) -> None:
    fakes = Fakes()
    waiting = await asked_and_approved(fakes, storage)

    filed = await fire(fakes, storage, waiting)  # 18 November, and still no credit

    assert fakes.claims.calls == 1
    [(_, check)] = filed.timers
    assert check.reason == "check Broadbandly has paid"
    paid = await fire(fakes, storage, filed)
    outcome = paid.outcome
    assert outcome is not None and outcome.state == "verified"
    assert outcome.message.startswith("Broadbandly (a simulated company) has paid you £32.31")
    assert "25 minutes of your time back" in outcome.message
    assert json.loads(outcome.plan_json)["action_today"] == "ofcom.complaint"
    assert fakes.states() == [
        "understood", "planned", "appraised", "awaiting_consent", "running", "waiting",
        "running", "waiting", "running", "completed", "verified",
    ]  # fmt: skip


async def test_if_the_credit_comes_on_its_own_nobody_calls(storage: Any) -> None:
    fakes = Fakes()
    waiting = await asked_and_approved(fakes, storage)
    fakes.credited.add("m_1")

    done = await fire(fakes, storage, waiting)

    assert done.outcome is not None and done.outcome.state == "verified"
    assert done.outcome.message.startswith("Broadbandly paid the £32.31 on its own")
    assert fakes.claims.calls == 0
    [(paid, _, _)] = fakes.repo.ledger  # money counted; no minutes claimed for doing nothing
    assert paid.gbp_recovered == Decimal("32.31")


async def test_a_restart_in_the_middle_of_the_wait_loses_nothing(storage: Any) -> None:
    fakes = Fakes()
    await asked_and_approved(fakes, storage)

    again = await resume(build_ofcom_workflow(fakes.deps, storage), storage)  # a new process

    [(_, timer)] = again.timers
    assert timer.wake_at == "2026-11-18T09:00:00+00:00"
    await fire(fakes, storage, again)
    assert fakes.claims.calls == 1


async def test_if_the_company_never_pays_tempo_names_the_ombudsman_day(storage: Any) -> None:
    fakes = Fakes(pays_after=None)
    filed = await fire(fakes, storage, await asked_and_approved(fakes, storage))

    first_check = await fire(fakes, storage, filed)
    done = await fire(fakes, storage, first_check)

    assert done.outcome is not None and done.outcome.state == "completed"
    # Complained on 18 November; the ombudsman opens after the provider's 8 weeks.
    assert "hasn't paid after 2 checks. You can go to the ombudsman from 14 January." in (
        done.outcome.message
    )


async def test_enough_notice_means_nothing_to_claim(storage: Any) -> None:
    fakes = Fakes()

    result = await start(build_ofcom_workflow(fakes.deps, storage), await fakes.mission("48"))

    assert result.pending == () and result.outcome is not None
    assert result.outcome.state == "declined"
    assert "cancelled with 48 h notice" in result.outcome.message
    assert fakes.states() == ["understood", "planned", "appraised", "declined"]


async def test_no_means_nothing_is_sent(storage: Any) -> None:
    fakes = Fakes()
    first = await start(build_ofcom_workflow(fakes.deps, storage), await fakes.mission())
    [(request_id, _)] = first.pending
    no = SignedApproval(approved=False, scopes=("file_claim",), device_sig="sms:NO")

    done = await resume(build_ofcom_workflow(fakes.deps, storage), storage, {request_id: no})

    assert done.outcome is not None and done.outcome.state == "declined"
    assert done.timers == () and fakes.claims.calls == 0
