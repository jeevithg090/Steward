"""The Clawback Rail mission end to end, with replay rail data, fakes and real checkpoints (S3.3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tempo_adapters.rail import ReplayRail
from tempo_core.models import Mission
from tempo_core.models import MissionState as S
from tempo_core.rules import RulePackRegistry
from tempo_missions.clawback_rail import (
    ClaimRequest,
    ClawbackDeps,
    RunResult,
    SignedApproval,
    TimerFired,
    build_clawback_workflow,
    checkpoint_storage,
    resume,
    start,
)
from tempo_missions.court import ConsensusCourt
from tempo_ports.claims import SimulatedClaims
from tempo_ports.court import CaseQuestion, JurorVerdict
from tempo_ports.memory_repo import InMemoryRepo

REPO_ROOT = Path(__file__).resolve().parents[2]
T0 = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
YES = SignedApproval(approved=True, scopes=("file_claim",), device_sig="passkey:iphone")
NO = SignedApproval(approved=False, scopes=("file_claim",), device_sig="sms:NO")


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        self.now += timedelta(milliseconds=250)
        return self.now


class Fakes:
    def __init__(self, court: ConsensusCourt | None = None) -> None:
        self.clock = Clock()
        self.repo = InMemoryRepo()
        self.claims = SimulatedClaims(clock=self.clock)
        self.deps = ClawbackDeps(
            repo=self.repo,
            rail=ReplayRail.from_directory(REPO_ROOT / "fixtures" / "rail" / "replay"),
            rules=RulePackRegistry.from_directory(REPO_ROOT / "skills" / "clawback-uk-rail"),
            claims=self.claims,
            court=court,
            clock=self.clock,
        )

    async def mission(self, departure: str = "08:12", mission_id: str = "m_1") -> ClaimRequest:
        await self.repo.upsert_user("u_1", display_name="Margaret", time_value_gbp_h=Decimal("18"))
        await self.repo.create_mission(
            Mission(id=mission_id, user_id="u_1", skill_id="clawback.uk-rail-delay-repay",
                    goal="Delay Repay", entered_state_at=T0)
        )  # fmt: skip
        return ClaimRequest(
            mission_id=mission_id, user_id="u_1", display_name="Margaret", origin_crs="OXF",
            destination_crs="PAD", travel_date="2026-10-23", departure=departure,
            fare_gbp="28.40", time_value_gbp_h="18",
        )  # fmt: skip

    def states(self) -> list[str]:
        return [e.to_state.value for e, _ in self.repo.case_events_log]


async def fire(fakes: Fakes, storage: Any, result: RunResult) -> RunResult:
    """Play the scheduler: answer the mission's pending timer."""
    [(timer_id, timer)] = result.timers
    fakes.clock.now = datetime.fromisoformat(timer.wake_at)
    fired = TimerFired(at=fakes.clock.now.isoformat())
    return await resume(build_clawback_workflow(fakes.deps, storage), storage, {timer_id: fired})


@pytest.fixture
def storage(tmp_path: Path) -> Any:
    return checkpoint_storage(tmp_path / "checkpoints")


async def test_happy_path_asks_once_then_claims_and_records_the_time(storage: Any) -> None:
    fakes = Fakes()
    request = await fakes.mission()

    first = await start(build_clawback_workflow(fakes.deps, storage), request)

    [(request_id, ask)] = first.pending
    assert first.outcomes == ()
    assert ask.amount_gbp == "14.20"
    assert ask.summary.startswith("38 min late → 50% of £28.40 under GWR DR15")
    assert "Shall I claim £14.20 for you?" in ask.summary
    assert fakes.claims.calls == 0
    assert (await fakes.repo.get_mission("m_1")).state is S.AWAITING_CONSENT

    filed = await resume(build_clawback_workflow(fakes.deps, storage), storage, {request_id: YES})

    assert filed.outcome is None  # the claim is in, the money isn't yet
    [(_, timer)] = filed.timers
    assert timer.attempt == 1
    assert fakes.claims.calls == 1
    assert (await fakes.repo.get_mission("m_1")).state is S.WAITING

    done = await fire(fakes, storage, filed)

    outcome = done.outcome
    assert outcome is not None
    assert (outcome.state, outcome.amount) == ("verified", Decimal("14.20"))
    assert outcome.reference is not None and outcome.reference.startswith("GW-")
    assert outcome.message.startswith("GW (a simulated company) has paid you £14.20")
    assert fakes.claims.calls == 1
    assert fakes.states() == [
        "understood", "planned", "appraised", "awaiting_consent", "running", "waiting",
        "running", "completed", "verified",
    ]  # fmt: skip
    claimed, paid = (entry for entry, _, _ in fakes.repo.ledger)
    assert (claimed.minutes_returned, paid.gbp_recovered) == (Decimal(20), Decimal("14.20"))
    [consent] = fakes.repo.consent_events
    assert (consent.scope, consent.kind.value, consent.device_sig) == (
        "file_claim", "grant", "passkey:iphone",
    )  # fmt: skip


async def test_consent_denied_stops_without_side_effects(storage: Any) -> None:
    fakes = Fakes()
    first = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission())
    [(request_id, _)] = first.pending

    done = await resume(build_clawback_workflow(fakes.deps, storage), storage, {request_id: NO})

    assert done.outcome is not None
    assert done.outcome.message == "Stopped: you said no. Nothing was sent."
    assert fakes.claims.calls == 0
    assert fakes.repo.ledger == []
    assert fakes.states()[-1] == "declined"
    assert [e.kind.value for e in fakes.repo.consent_events] == ["revoke"]


async def test_not_eligible_declines_with_explanation(storage: Any) -> None:
    fakes = Fakes()

    result = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission("09:12"))

    assert result.pending == ()
    assert result.outcome is not None
    assert result.outcome.state == "declined"
    assert "9 min late is below the DR15 threshold of 15 min" in result.outcome.message
    assert fakes.states() == ["understood", "planned", "appraised", "declined"]


async def test_a_cancelled_train_claims_the_top_band(storage: Any) -> None:
    fakes = Fakes()

    result = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission("17:42"))

    [(_, ask)] = result.pending
    assert ask.amount_gbp == "28.40"  # 100% of the fare


async def test_a_train_that_cannot_be_found_declines(storage: Any) -> None:
    fakes = Fakes()

    result = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission("05:55"))

    assert result.outcome is not None
    assert result.outcome.message.startswith("I couldn't find that train")


async def test_an_unverified_approval_fails_safe(storage: Any) -> None:
    fakes = Fakes()
    first = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission())
    [(request_id, _)] = first.pending
    forged = SignedApproval(approved=True, scopes=("file_claim",), device_sig="")

    done = await resume(build_clawback_workflow(fakes.deps, storage), storage, {request_id: forged})

    assert done.outcome is not None
    assert done.outcome.state == "failed_safe"
    assert fakes.claims.calls == 0
    assert fakes.repo.consent_events == []


async def test_mission_resumes_after_crash(storage: Any) -> None:
    fakes = Fakes()
    first = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission())
    [(request_id, _)] = first.pending
    del first  # the process dies; only the checkpoint files and the database survive

    fresh = build_clawback_workflow(fakes.deps, storage)  # a new process
    filed = await resume(fresh, storage, {request_id: YES})
    done = await fire(fakes, storage, filed)

    assert done.outcome is not None
    assert done.outcome.state == "verified"
    assert fakes.claims.calls == 1


async def test_pending_request_reemitted_after_restore(storage: Any) -> None:
    fakes = Fakes()
    first = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission())

    again = await resume(build_clawback_workflow(fakes.deps, storage), storage)

    assert [rid for rid, _ in again.pending] == [rid for rid, _ in first.pending]
    assert fakes.claims.calls == 0


async def test_resume_is_idempotent_no_double_claim(storage: Any) -> None:
    fakes = Fakes()
    first = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission())
    [(request_id, _)] = first.pending
    waiting = await storage.get_latest(workflow_name="clawback-rail")

    results = [
        await resume(
            build_clawback_workflow(fakes.deps, storage),
            storage,
            {request_id: YES},
            checkpoint_id=waiting.checkpoint_id,
        )
        for _ in range(2)  # e.g. the approval webhook is delivered twice
    ]
    await fire(fakes, storage, results[-1])

    assert fakes.claims.calls == 1
    assert len(fakes.repo.ledger) == 2  # minutes once, pounds once
    assert fakes.states().count("verified") == 1


class Juror:
    def __init__(self, name: str, eligible: bool) -> None:
        self.name = name
        self._eligible = eligible

    async def deliberate(self, question: CaseQuestion) -> JurorVerdict:
        return JurorVerdict(eligible=self._eligible, rule_id=question.rule_id, confidence=0.9)


async def test_the_court_can_say_no_but_never_changes_the_amount(storage: Any) -> None:
    agrees = Fakes(ConsensusCourt([Juror("a", True), Juror("b", True), Juror("c", False)]))
    refuses = Fakes(ConsensusCourt([Juror("a", False), Juror("b", False), Juror("c", True)]))

    yes = await start(build_clawback_workflow(agrees.deps, storage), await agrees.mission())
    no = await start(
        build_clawback_workflow(refuses.deps, checkpoint_storage(Path(storage.storage_path) / "x")),
        await refuses.mission(),
    )

    [(_, ask)] = yes.pending
    assert ask.amount_gbp == "14.20"
    assert no.outcome is not None
    assert no.outcome.message == "The Consensus Court found this isn't covered (2/3 jurors agreed)"


class Recorder(Juror):
    """A juror that keeps the question it was asked."""

    def __init__(self, name: str) -> None:
        super().__init__(name, True)
        self.asked: list[CaseQuestion] = []

    async def deliberate(self, question: CaseQuestion) -> JurorVerdict:
        self.asked.append(question)
        return await super().deliberate(question)


async def test_the_jurors_of_a_cancelled_train_read_the_cancellation_rule_not_zero_minutes(
    storage: Any,
) -> None:
    # Live, three real models said a cancelled 17:42 "isn't covered": they were told it arrived 0
    # minutes late and read a rule that never mentioned cancellations.
    jurors = [Recorder("a"), Recorder("b"), Recorder("c")]
    fakes = Fakes(ConsensusCourt(jurors))

    result = await start(build_clawback_workflow(fakes.deps, storage), await fakes.mission("17:42"))

    [(_, ask)] = result.pending
    assert ask.amount_gbp == "28.40"
    [question] = jurors[0].asked
    facts = {f.key: f.value for f in question.facts}
    assert facts["cancelled"] == "yes"
    assert "arrival_delay_min" not in facts
    assert "A cancelled train is paid as the top band: 100% of the fare." in question.rule_text
