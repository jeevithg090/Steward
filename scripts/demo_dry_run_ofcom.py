"""`make demo-rehearsal` (beat 2): Rights Decay in text, replay mode, with a restart mid-wait.

Margaret's broadband engineer didn't come six days ago. Tempo prices Ofcom's automatic
compensation, plans to wait for the credit (the complaint only opens after the payment window),
asks once, and sleeps in its checkpoint. The Gateway is "killed" and restarted; the wait survives.
The demo clock jumps 31 days, the credit hasn't come, so Tempo complains once and waits for the
money. Exits 1 if any beat goes wrong.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from tempo_adapters.settings import Settings
from tempo_gateway.clock import DemoClock
from tempo_gateway.main import build_service
from tempo_gateway.missions import MissionService, StartOfcom
from tempo_missions.clawback_rail import SignedApproval

MISSED = (datetime.now(UTC) - timedelta(days=6)).date().isoformat()
MARGARET = StartOfcom(
    user_id="u_margaret", display_name="Margaret", operator="Broadbandly", event_date=MISSED,
    account_ref="BB-4417", time_value_gbp_h=Decimal("18"),
)  # fmt: skip

Check = tuple[str, bool]


async def beat(
    name: str, work: Callable[[], Awaitable[Any]], timings: list[tuple[str, float]]
) -> Any:
    start = time.perf_counter()
    result = await work()
    timings.append((name, (time.perf_counter() - start) * 1000))
    return result


async def main(checkpoints: Path) -> list[Check]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True, checkpoint_dir=str(checkpoints),
        payment_check_after_s=0,
    )  # fmt: skip
    service, _ = build_service(settings)
    clock = service.deps.clock
    if not isinstance(clock, DemoClock):
        raise SystemExit("the Gateway's clock should be the demo clock")
    timings: list[tuple[str, float]] = []

    view = await beat("start: price + plan", lambda: service.start_ofcom(MARGARET), timings)
    plan = view.plan or {}
    print(f"\nTempo: {view.message}\n")
    yes = SignedApproval(approved=True, scopes=("file_claim",), device_sig="demo:passkey")
    request_id = view.ask.request_id if view.ask else ""
    waiting = await beat(
        "approve: start the wait", lambda: service.answer(request_id, yes), timings
    )
    print(f"Tempo: {waiting.message}\n")

    restarted = MissionService(service.deps, checkpoints, service._bus)  # the Gateway died
    recovered = await beat("restart + recover", restarted.recover, timings)
    clock.advance(31)
    await beat("31 days on: re-plan, act", restarted.tick, timings)
    acted = await restarted.view(view.id)
    print(f"Tempo (day 37): {acted.message}\n")
    await beat("watchdog: paid?", restarted.tick, timings)
    done = await restarted.view(view.id)
    print(f"Tempo: {done.message}\n")

    for name, ms in timings:
        print(f"  {name:<26} {ms:7.1f} ms")
    print("  timeline: " + " → ".join(t["to"] for t in done.timeline))
    claims = service.deps.claims
    acted_plan, ask = acted.plan or {}, view.ask
    return [
        ("priced at £32.31 from the Ofcom rule", ask is not None and ask.amount_gbp == "32.31"),
        ("the plan is to wait, with a date",
         plan.get("action_today") == "wait" and bool(plan.get("next_decision_on"))),
        ("the yes starts a durable wait", waiting.state.value == "waiting"),
        ("the wait survived the restart", recovered == [view.id]),
        ("31 days on, the plan says act", acted_plan.get("action_today") == "ofcom.complaint"),
        ("complained exactly once", getattr(claims, "calls", None) == 1),
        ("verified once it was paid", done.state.value == "verified"),
        ("whole run under 2 s", sum(ms for _, ms in timings) < 2000),
    ]  # fmt: skip


def run() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        checks = asyncio.run(main(Path(tmp)))
    print()
    for name, ok in checks:
        print(f"{'✅' if ok else '❌'} {name}")
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(run())
