"""Durable Watchdog timers through the Gateway's MissionService and scheduler (S3.4)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from tempo_adapters.rail import ReplayRail
from tempo_core.delays import LONDON
from tempo_core.rules import RulePackRegistry
from tempo_gateway.events import EventBus
from tempo_gateway.missions import MissionService, StartMission
from tempo_missions.clawback_rail import ClawbackDeps, SignedApproval
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo

REPO_ROOT = Path(__file__).resolve().parents[2]
YES = SignedApproval(approved=True, scopes=("file_claim",), device_sig="passkey:iphone")
MARGARET = StartMission(
    user_id="u_1", display_name="Margaret", origin_crs="OXF", destination_crs="PAD",
    travel_date="2026-10-23", departure="08:12", fare_gbp=Decimal("28.40"),
)  # fmt: skip


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def service(
    tmp: Path,
    clock: Clock,
    *,
    pays_after: timedelta | None = timedelta(0),
    check_after: timedelta = timedelta(days=7),
    max_checks: int = 4,
    repo: InMemoryRepo | None = None,
    claims: SimulatedClaims | None = None,
) -> MissionService:
    deps = ClawbackDeps(
        repo=repo or InMemoryRepo(),
        rail=ReplayRail.from_directory(REPO_ROOT / "fixtures" / "rail" / "replay"),
        rules=RulePackRegistry.from_directory(REPO_ROOT / "skills" / "clawback-uk-rail"),
        claims=claims or SimulatedClaims(pays_after=pays_after, clock=clock),
        clock=clock,
        payment_check_after=check_after,
        max_payment_checks=max_checks,
    )
    return MissionService(deps, tmp / "checkpoints", EventBus())


async def approved(svc: MissionService) -> str:
    view = await svc.start(MARGARET)
    assert view.ask is not None
    await svc.answer(view.ask.request_id, YES)
    return view.id


async def test_timer_request_persisted_and_the_view_says_when(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    svc = service(tmp_path, clock)

    mission_id = await approved(svc)
    view = await svc.view(mission_id)

    assert view.state.value == "waiting"
    assert view.message == "Claim filed. I'll check the payment has arrived on 31 Oct at 09:00."


async def test_scheduler_resumes_at_wake_time(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    svc = service(tmp_path, clock)
    mission_id = await approved(svc)

    early = await svc.tick(clock.now + timedelta(days=6, hours=23))
    clock.now += timedelta(days=7)
    due = await svc.tick()

    assert early == []
    assert due == [mission_id]
    view = await svc.view(mission_id)
    assert view.state.value == "verified"
    assert view.outcome is not None and view.outcome["state"] == "verified"


async def test_timer_survives_restart(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    repo, claims = InMemoryRepo(), SimulatedClaims(clock=clock)
    mission_id = await approved(service(tmp_path, clock, repo=repo, claims=claims))

    restarted = service(tmp_path, clock, repo=repo, claims=claims)  # memory lost, data kept
    assert await restarted.recover() == [mission_id]
    clock.now += timedelta(days=7)

    assert await restarted.tick() == [mission_id]
    assert (await restarted.view(mission_id)).state.value == "verified"
    assert claims.calls == 1


async def test_clock_change_does_not_double_fire(tmp_path: Path) -> None:
    # Approved at 00:30 BST, checked an hour later: 01:30, the hour that happens twice tonight.
    clock = Clock(datetime(2026, 10, 24, 23, 30, tzinfo=UTC))
    svc = service(tmp_path, clock, check_after=timedelta(hours=1), pays_after=None, max_checks=1)
    mission_id = await approved(svc)
    first_reading = datetime(2026, 10, 25, 1, 30, tzinfo=LONDON, fold=0)  # 01:30 BST
    second_reading = datetime(2026, 10, 25, 1, 30, tzinfo=LONDON, fold=1)  # 01:30 GMT

    fired_first = await svc.tick(first_reading)
    fired_second = await svc.tick(second_reading)

    assert first_reading.astimezone(UTC) == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)
    assert (fired_first, fired_second) == ([mission_id], [])


async def test_the_watchdog_checks_again_until_paid(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    svc = service(tmp_path, clock, pays_after=timedelta(days=10))
    mission_id = await approved(svc)

    clock.now += timedelta(days=7)
    await svc.tick()
    after_first = await svc.view(mission_id)
    clock.now += timedelta(days=7)
    await svc.tick()

    assert after_first.state.value == "waiting"  # not paid at day 7: re-armed
    assert (await svc.view(mission_id)).state.value == "verified"  # paid by day 14


async def test_the_watchdog_gives_up_honestly(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    svc = service(tmp_path, clock, pays_after=None, max_checks=2)
    mission_id = await approved(svc)

    for _ in range(2):
        clock.now += timedelta(days=7)
        await svc.tick()

    view = await svc.view(mission_id)
    assert view.state.value == "completed"
    assert view.message is not None
    assert "hasn't paid after 2 checks. I'll chase it." in view.message


async def test_stop_while_waiting_cancels_the_timer(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    svc = service(tmp_path, clock)
    mission_id = await approved(svc)

    stopped = await svc.stop(mission_id, device_sig="sms:STOP")
    clock.now += timedelta(days=7)

    assert stopped.state.value == "failed_safe"
    assert await svc.tick() == []


async def test_recover_skips_checkpoints_whose_mission_was_lost(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    await approved(service(tmp_path, clock))

    fresh_store = service(tmp_path, clock)  # an in-memory store after a restart: empty

    assert await fresh_store.recover() == []


async def test_recover_lists_finished_missions_too(tmp_path: Path) -> None:
    clock = Clock(datetime(2026, 10, 24, 9, 0, tzinfo=UTC))
    repo, claims = InMemoryRepo(), SimulatedClaims(clock=clock)
    first = service(tmp_path, clock, repo=repo, claims=claims, check_after=timedelta(0))
    mission_id = await approved(first)
    await first.tick()

    restarted = service(tmp_path, clock, repo=repo, claims=claims)

    assert await restarted.recover() == []  # nothing is waiting
    assert restarted.mission_ids == [mission_id]  # but the finished mission is still listed
