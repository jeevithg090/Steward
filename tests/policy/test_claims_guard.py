"""The profile guards on the Clawback workflows' own claim path (plan.md §12.1, finding 1).

`GuardedClaims` runs CapabilityGuard and BudgetGuard on the claims port, so a profile is enforced
at the tool even when a mission skips the Gateway's refusal and starts through MissionService
directly: under "Read It To Me" the claim is denied, nothing reaches the company, and the mission
fails safe in plain words. A claim above the profile's limit is asked about first, and the ask
says so.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tempo_adapters.rail import ReplayRail
from tempo_core.profiles import ProfileCatalog
from tempo_core.readability import flesch_reading_ease
from tempo_core.rules import RulePackRegistry
from tempo_gateway.events import EventBus
from tempo_gateway.missions import MissionService, StartMission
from tempo_harness import ClaimRefused, GuardedClaims
from tempo_harness.claims_guard import UNKNOWN_PROFILE
from tempo_missions.clawback_rail import ClawbackDeps, SignedApproval
from tempo_ports.claims import SimulatedClaims
from tempo_ports.memory_repo import InMemoryRepo

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ProfileCatalog.load(ROOT / "profiles", ROOT / "skills")
YES = SignedApproval(approved=True, scopes=("file_claim",), device_sig="passkey:iphone")
NOW = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
REFUSED = "This profile doesn't let me file a claim, so I stopped."
ASKED = "This is above your profile's limit of £250.00, so I'm asking you first."


def margaret(profile_id: str | None, fare: str = "28.40") -> StartMission:
    return StartMission(
        user_id="u_1", display_name="Margaret", origin_crs="OXF", destination_crs="PAD",
        travel_date="2026-10-23", departure="08:12", fare_gbp=Decimal(fare), profile_id=profile_id,
    )  # fmt: skip


def guarded(
    profile_id: str | None, *, asked: bool = False
) -> tuple[GuardedClaims, SimulatedClaims]:
    inner = SimulatedClaims(clock=lambda: NOW)
    profile = CATALOG.get(profile_id) if profile_id else None
    return GuardedClaims(inner, lambda _: profile, lambda _: asked), inner


async def file(claims: GuardedClaims, amount: str) -> Any:
    return await claims.file_claim(
        operator="GWR", mission_id="m_1", proof_trace_id="pt_1", amount_gbp=Decimal(amount),
        idempotency_key="m_1:pt_1",
    )  # fmt: skip


# --- the wrapper, table-driven -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("profile_id", "amount", "asked", "files", "reason"),
    [
        (None, "14.20", False, True, None),  # no profile: nothing to enforce
        ("commuter", "14.20", False, True, None),  # within the limit
        ("commuter", "300.00", True, True, None),  # above it, and the ask named the limit
        ("commuter", "300.00", False, False, "budget_not_asked"),  # above it, never asked
        ("read-it-to-me", "14.20", True, False, "capability_refused"),  # may_not: claim
        ("am-i-owed", "0.01", True, False, "capability_refused"),
        ("carer", "500.00", False, True, None),  # exactly the limit is within it
    ],
)
async def test_the_guard_decides_before_anything_reaches_the_company(
    profile_id: str | None, amount: str, asked: bool, files: bool, reason: str | None
) -> None:
    claims, inner = guarded(profile_id, asked=asked)

    if files:
        receipt = await file(claims, amount)
        assert receipt.amount_gbp == Decimal(amount) and inner.calls == 1
    else:
        with pytest.raises(ClaimRefused) as refused:
            await file(claims, amount)
        assert refused.value.reason == reason and inner.calls == 0


async def test_a_profile_nobody_can_find_is_refused_not_ignored() -> None:
    def lost(mission_id: str) -> None:
        raise LookupError("profile 'gone' is not installed")

    inner = SimulatedClaims(clock=lambda: NOW)
    with pytest.raises(ClaimRefused) as refused:
        await file(GuardedClaims(inner, lost), "14.20")

    assert str(refused.value) == UNKNOWN_PROFILE and inner.calls == 0


def test_the_ask_names_the_limit_only_when_the_limit_is_the_reason() -> None:
    commuter, _ = guarded("commuter")
    nobody, _ = guarded(None)
    read_it, _ = guarded("read-it-to-me")

    assert commuter.ask_note("m_1", Decimal("300.00")) == ASKED
    assert commuter.ask_note("m_1", Decimal("250.00")) is None
    assert nobody.ask_note("m_1", Decimal("9999")) is None
    assert read_it.ask_note("m_1", Decimal("14.20")) is None  # refused outright, not over a limit


@pytest.mark.parametrize(
    "said",
    [
        REFUSED,
        ASKED,
        UNKNOWN_PROFILE,
        "This is above your profile's limit of £250.00, so I stopped.",
    ],
)
def test_what_the_guard_says_reads_plainly(said: str) -> None:
    assert flesch_reading_ease(said) >= 60, said


# --- through MissionService, skipping the Gateway's refusal --------------------------------------


def service(tmp: Path, claims: SimulatedClaims, bus: EventBus | None = None) -> MissionService:
    deps = ClawbackDeps(
        repo=InMemoryRepo(),
        rail=ReplayRail.from_directory(ROOT / "fixtures" / "rail" / "replay"),
        rules=RulePackRegistry.from_directory(ROOT / "skills" / "clawback-uk-rail"),
        claims=claims, clock=lambda: NOW,
    )  # fmt: skip
    return MissionService(deps, tmp / "checkpoints", bus or EventBus(), profiles=CATALOG)


async def test_read_it_to_me_is_denied_at_the_claim_tool_even_when_started_directly(
    tmp_path: Path,
) -> None:
    claims = SimulatedClaims(clock=lambda: NOW)
    bus = EventBus()
    svc = service(tmp_path, claims, bus)

    async with bus.subscribe() as heard:
        view = await svc.start(margaret("read-it-to-me"))  # no route in the way: straight in
        assert view.ask is not None and view.state.value == "awaiting_consent"
        answered = await svc.answer(view.ask.request_id, YES)
        events = [heard.get_nowait() for _ in range(heard.qsize())]

    assert claims.calls == 0  # nothing reached the company
    assert answered.state.value == "failed_safe"
    assert answered.message == REFUSED
    assert answered.outcome is not None and answered.outcome["reference"] is None
    assert {"type": "outcome", "mission_id": view.id, "state": "failed_safe", "message": REFUSED,
            "amount_gbp": None, "reference": None} in events  # fmt: skip


async def test_above_the_limit_the_ask_says_so_and_a_yes_files_it(tmp_path: Path) -> None:
    claims = SimulatedClaims(clock=lambda: NOW)
    svc = service(tmp_path, claims)

    view = await svc.start(margaret("commuter", fare="600.00"))  # half of £600 is over £250
    assert view.ask is not None and view.ask.amount_gbp == "300.00"
    assert view.ask.summary.endswith(ASKED)
    answered = await svc.answer(view.ask.request_id, YES)

    assert claims.calls == 1 and answered.state.value == "waiting"


async def test_within_the_limit_the_ask_is_unchanged(tmp_path: Path) -> None:
    svc = service(tmp_path, SimulatedClaims(clock=lambda: NOW))

    view = await svc.start(margaret("commuter"))

    assert view.ask is not None and "limit" not in view.ask.summary
    assert view.ask.summary.endswith("Shall I claim £14.20 for you?")
